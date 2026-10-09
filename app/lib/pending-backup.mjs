import { normalizeClientProgress } from "./client-progress.mjs";

export const MAX_PENDING_BACKUP_BYTES = 600_000;
export const MAX_PENDING_ARCHIVE_BYTES = 4_000_000;
export const MAX_PENDING_ARCHIVE_ENTRIES = 8;
const MAX_STATE_BYTES = 400_000;
const encoder = new TextEncoder();

/** @typedef {{getItem:(key:string)=>string|null,setItem:(key:string,value:string)=>void,removeItem:(key:string)=>void}} BackupStorage */
/** @typedef {{state:Record<string,unknown>,baseRevision:string|null,updatedAt:string,clientState?:unknown}} PendingBackup */
/** @typedef {{status:'absent'}|{status:'unavailable'}|{status:'damaged',raw:string}|{status:'valid',raw:string,pending:PendingBackup}} PendingBackupRead */

function bytes(value) { return encoder.encode(value).byteLength; }
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function key(value) { return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\u0000-\u001f\u007f]/.test(value); }
function timestamp(value) {
  if (typeof value !== "string" || value.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse normalizes impossible calendar dates and 24:00. Reject them.
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day
    && Number(value.slice(11, 13)) <= 23 && Number(value.slice(14, 16)) <= 59 && Number(value.slice(17, 19)) <= 59;
}
function revision(value) {
  return value === null || typeof value === "string" && value.length > 0 && value.length <= 200
    && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}
function validatePending(raw) {
  if (bytes(raw) > MAX_PENDING_BACKUP_BYTES) throw new Error("oversized backup");
  const source = JSON.parse(raw);
  if (!record(source) || !record(source.state) || !Object.hasOwn(source, "baseRevision") || !revision(source.baseRevision)
    || !timestamp(source.updatedAt) || Object.keys(source).some((field) => !["state", "baseRevision", "updatedAt", "clientState"].includes(field))
    || bytes(JSON.stringify(source.state)) > MAX_STATE_BYTES) throw new Error("invalid backup");
  const pending = { state: source.state, baseRevision: source.baseRevision, updatedAt: source.updatedAt };
  if (Object.hasOwn(source, "clientState")) {
    if (!record(source.clientState)) throw new Error("invalid client progress");
    normalizeClientProgress(source.clientState);
    pending.clientState = source.clientState;
  }
  return pending;
}

/**
 * A missing key, unavailable browser storage and damaged saved work have
 * different outcomes. Reading never alters the original, even malformed JSON.
 * @param {Pick<BackupStorage,'getItem'>|null|undefined} storage
 * @param {string} pendingKey
 * @returns {PendingBackupRead}
 */
export function readPendingBackup(storage, pendingKey) {
  let raw;
  try {
    if (!key(pendingKey) || !storage || typeof storage.getItem !== "function") return { status: "unavailable" };
    raw = storage.getItem(pendingKey);
  } catch { return { status: "unavailable" }; }
  if (raw === null) return { status: "absent" };
  if (typeof raw !== "string") return { status: "unavailable" };
  try { return { status: "valid", raw, pending: validatePending(raw) }; }
  catch { return { status: "damaged", raw }; }
}

function archiveEntries(raw) {
  if (raw === null) return [];
  if (typeof raw !== "string" || bytes(raw) > MAX_PENDING_ARCHIVE_BYTES) throw new Error("invalid archive");
  const source = JSON.parse(raw);
  if (!record(source) || source.schemaVersion !== 1 || !Array.isArray(source.entries)
    || source.entries.length > MAX_PENDING_ARCHIVE_ENTRIES
    || Object.keys(source).some((field) => !["schemaVersion", "entries"].includes(field))) throw new Error("invalid archive");
  for (const entry of source.entries) {
    if (!record(entry) || !timestamp(entry.capturedAt) || typeof entry.raw !== "string" || bytes(entry.raw) > MAX_PENDING_BACKUP_BYTES
      || Object.keys(entry).some((field) => !["capturedAt", "raw"].includes(field))) throw new Error("invalid archive entry");
  }
  return source.entries;
}

/**
 * Archive a user-reviewed damaged record before releasing its pending key.
 * Verify the complete archive and recheck the source immediately before removal.
 * @param {BackupStorage} storage
 * @param {string} pendingKey
 * @param {string} archiveKey
 * @param {string} expectedRaw
 * @returns {{archived:true,entries:number,archiveKey:string}}
 */
export function archiveDamagedPendingBackup(storage, pendingKey, archiveKey, expectedRaw) {
  if (!key(pendingKey) || !key(archiveKey) || pendingKey === archiveKey || typeof expectedRaw !== "string"
    || bytes(expectedRaw) > MAX_PENDING_BACKUP_BYTES) throw new Error("Não foi possível arquivar este backup com segurança. O original foi preservado.");
  const source = readPendingBackup(storage, pendingKey);
  if (source.status !== "damaged" || source.raw !== expectedRaw) throw new Error("O backup mudou ou não está disponível. Recarregue antes de continuar; nada foi removido.");
  if (!storage || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") throw new Error("O navegador não permite arquivar o backup. O original foi preservado.");
  let previous;
  let entries;
  try {
    previous = storage.getItem(archiveKey);
    entries = archiveEntries(previous);
  } catch { throw new Error("O arquivo de recuperação não pôde ser lido com segurança. Nenhum backup foi removido."); }
  entries = [...entries, { capturedAt: new Date().toISOString(), raw: expectedRaw }].slice(-MAX_PENDING_ARCHIVE_ENTRIES);
  let serialized = JSON.stringify({ schemaVersion: 1, entries });
  while (bytes(serialized) > MAX_PENDING_ARCHIVE_BYTES && entries.length > 1) {
    entries = entries.slice(1);
    serialized = JSON.stringify({ schemaVersion: 1, entries });
  }
  if (bytes(serialized) > MAX_PENDING_ARCHIVE_BYTES) throw new Error("Este backup excede o limite do arquivo de recuperação. O original foi preservado.");
  try {
    if (storage.getItem(archiveKey) !== previous || storage.getItem(pendingKey) !== expectedRaw) throw new Error("storage changed");
    storage.setItem(archiveKey, serialized);
    if (storage.getItem(archiveKey) !== serialized) throw new Error("archive not acknowledged");
    if (storage.getItem(pendingKey) !== expectedRaw) throw new Error("source changed");
  } catch { throw new Error("O navegador não confirmou o arquivo de recuperação ou os dados mudaram. Nenhum backup foi removido."); }
  try {
    storage.removeItem(pendingKey);
    if (storage.getItem(pendingKey) === expectedRaw) throw new Error("source retained");
  } catch { throw new Error("O backup foi arquivado, mas a pendência não pôde ser liberada. Os dados de recuperação foram preservados."); }
  return { archived: true, entries: entries.length, archiveKey };
}
