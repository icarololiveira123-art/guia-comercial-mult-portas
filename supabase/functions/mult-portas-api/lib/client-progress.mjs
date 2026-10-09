// Portable per-user UI progress. Authentication, queued writes and business
// records deliberately have no representation in this contract.

export const CLIENT_PROGRESS_EVENT = "mp-client-progress";
export const MAX_CLIENT_PROGRESS_BYTES = 150_000;
export const CLIENT_PROGRESS_BRANDS = Object.freeze([
  "dalcomad", "destak", "casmavi", "aluan", "brimak", "brasil", "crv", "lucasa", "riobras",
]);

const sections = ["overview", "script", "seller", "training", "timing", "messages", "fair", "factory", "catalog", "control", "marketing", "management"];
const stages = ["basics", "materials", "measures", "quality", "practice"];
const studyFields = ["product", "use", "composition", "measure", "pending"];
const wizardFields = ["leafMeasure", "requadro", "line", "finish", "color", "filling", "priceWithoutLock", "priceWithLock"];
const documentAnswers = [
  "document:/catalogos/brimak-linha-elite.pdf",
  "document:/catalogos/brimak-linha-super-25.pdf",
  "document:/catalogos/brimak-linha-l25.pdf",
  "document:/catalogos/brimak-portas-janelas-pvc.pdf",
  "document:/catalogos/brimak-catalogo-2018.pdf",
];
const resumeFields = ["section", "brand", "messageView", "fairView", "salesStep", "timingStep", "trainingScenario", "factoryWizardStep", "factoryWizardDraft", "trainingStarted", "trainingMessages", "trainingInput"];

/** @typedef {'local' | 'shared'} ProgressScope */
/** @typedef {number | string} ProgressUserId */
/** @typedef {{getItem: (key: string) => string | null, setItem: (key: string, value: string) => void}} ProgressStorage */
/** @typedef {{role: 'customer' | 'seller', text: string}} ProgressMessage */
/** @typedef {{section?: string, brand?: string, messageView?: string, fairView?: string, salesStep?: number, timingStep?: number, trainingScenario?: number, factoryWizardStep?: number, factoryWizardDraft?: Record<string, string>, trainingStarted?: boolean, trainingMessages?: ProgressMessage[], trainingInput?: string}} ProgressResume */
/** @typedef {{stage?: string, answers?: Record<string, number>}} ProgressLearning */
/** @typedef {{learning?: ProgressLearning, studySheet?: Record<string, string>, view?: string}} ProgressBrand */
/** @typedef {{schemaVersion: 1, resume?: ProgressResume, brands?: Record<string, ProgressBrand>}} ClientProgress */
/** @typedef {{writtenKeys: string[], preservedKeys: string[]}} ProgressApplication */

function record(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Invalid ${label}.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Invalid ${label}.`);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || !descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError(`Unknown ${label} field.`);
  }
  return value;
}

function boundedText(value, limit, label) {
  if (typeof value !== "string" || value.length > limit) throw new TypeError(`Invalid ${label}.`);
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new TypeError(`Invalid ${label}.`);
  return value;
}

function boundedInteger(value, max, label) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new TypeError(`Invalid ${label}.`);
  return value;
}

function normalizeResume(value) {
  const source = record(value, resumeFields, "resume");
  /** @type {ProgressResume} */
  const result = {};
  if (Object.hasOwn(source, "section")) result.section = enumValue(source.section, sections, "section");
  if (Object.hasOwn(source, "brand")) result.brand = enumValue(source.brand, CLIENT_PROGRESS_BRANDS, "brand");
  for (const key of ["messageView", "fairView"]) {
    if (Object.hasOwn(source, key)) result[key] = enumValue(source[key], ["compose", "preview", "examples"], "message view");
  }
  for (const [key, max] of [["salesStep", 4], ["timingStep", 5], ["trainingScenario", 15], ["factoryWizardStep", 7]]) {
    if (Object.hasOwn(source, key)) result[key] = boundedInteger(source[key], max, "step");
  }
  if (Object.hasOwn(source, "factoryWizardDraft")) {
    const draft = record(source.factoryWizardDraft, wizardFields, "factory draft");
    result.factoryWizardDraft = Object.fromEntries(Object.entries(draft).map(([key, text]) => [key, boundedText(text, 300, "factory field")]));
  }
  if (Object.hasOwn(source, "trainingStarted")) {
    if (typeof source.trainingStarted !== "boolean") throw new TypeError("Invalid training status.");
    result.trainingStarted = source.trainingStarted;
  }
  if (Object.hasOwn(source, "trainingMessages")) {
    if (!Array.isArray(source.trainingMessages) || source.trainingMessages.length > 24) throw new TypeError("Invalid training messages.");
    result.trainingMessages = source.trainingMessages.map((message) => {
      const item = record(message, ["role", "text"], "training message");
      return { role: enumValue(item.role, ["customer", "seller"], "training role"), text: boundedText(item.text, 3000, "training text") };
    });
  }
  if (Object.hasOwn(source, "trainingInput")) result.trainingInput = boundedText(source.trainingInput, 3000, "training input");
  return result;
}

function normalizeLearning(value, brand) {
  const source = record(value, ["stage", "answers"], "learning");
  /** @type {ProgressLearning} */
  const result = {};
  if (Object.hasOwn(source, "stage")) result.stage = enumValue(source.stage, stages, "learning stage");
  if (Object.hasOwn(source, "answers")) {
    const allowedAnswers = ["measures", "brand", ...(brand === "brimak" ? documentAnswers : [])];
    const answers = record(source.answers, allowedAnswers, "learning answers");
    result.answers = Object.fromEntries(Object.entries(answers).map(([key, choice]) => [key, boundedInteger(choice, 2, "quiz answer")]));
  }
  return result;
}

function normalizeSheet(value) {
  const source = record(value, studyFields, "study sheet");
  return Object.fromEntries(Object.entries(source).map(([key, text]) => [key, boundedText(text, 1000, "study field")]));
}

/**
 * Validate the portable browser/server contract. Missing values are omissions,
 * never commands to remove another browser's existing progress.
 * @param {unknown} value
 * @returns {ClientProgress}
 */
export function normalizeClientProgress(value) {
  if (value === null || value === undefined) return { schemaVersion: 1 };
  const source = record(value, ["schemaVersion", "resume", "brands"], "client progress");
  if (source.schemaVersion !== 1) throw new TypeError("Unsupported client progress version.");
  /** @type {ClientProgress} */
  const result = { schemaVersion: 1 };
  if (Object.hasOwn(source, "resume")) result.resume = normalizeResume(source.resume);
  if (Object.hasOwn(source, "brands")) {
    const brands = record(source.brands, CLIENT_PROGRESS_BRANDS, "client progress brands");
    result.brands = {};
    for (const [brand, value] of Object.entries(brands)) {
      const sourceBrand = record(value, ["learning", "studySheet", "view"], "brand progress");
      /** @type {ProgressBrand} */
      const normalizedBrand = {};
      if (Object.hasOwn(sourceBrand, "learning")) normalizedBrand.learning = normalizeLearning(sourceBrand.learning, brand);
      if (Object.hasOwn(sourceBrand, "studySheet")) normalizedBrand.studySheet = normalizeSheet(sourceBrand.studySheet);
      if (Object.hasOwn(sourceBrand, "view")) normalizedBrand.view = enumValue(sourceBrand.view, ["learn", "fiches", "pdfs"], "catalog view");
      result.brands[brand] = normalizedBrand;
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_CLIENT_PROGRESS_BYTES) throw new RangeError("Client progress exceeds its storage limit.");
  return result;
}

/** Missing fields preserve the last verified server copy; answers are explicit resets. */
export function mergeClientProgress(previous, incoming) {
  const base = normalizeClientProgress(previous);
  const patch = normalizeClientProgress(incoming);
  const result = { ...base, ...patch };
  if (base.resume || patch.resume) result.resume = { ...base.resume, ...patch.resume };
  if (base.brands || patch.brands) {
    result.brands = { ...base.brands };
    for (const [brand, item] of Object.entries(patch.brands ?? {})) {
      const old = base.brands?.[brand] ?? {};
      const next = { ...old, ...item };
      if (old.learning || item.learning) next.learning = { ...old.learning, ...item.learning };
      if (old.studySheet || item.studySheet) next.studySheet = { ...old.studySheet, ...item.studySheet };
      result.brands[brand] = next;
    }
  }
  return normalizeClientProgress(result);
}

function scopeValue(scope) {
  if (scope !== "local" && scope !== "shared") throw new TypeError("Invalid progress scope.");
  return scope;
}

function userIdValue(userId) {
  if (typeof userId === "number" && Number.isSafeInteger(userId) && userId > 0) return String(userId);
  if (typeof userId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(userId)) return userId;
  throw new TypeError("Invalid progress user ID.");
}

function storageValue(storage) {
  try {
    const candidate = storage ?? globalThis.localStorage;
    return candidate && typeof candidate.getItem === "function" && typeof candidate.setItem === "function" ? candidate : null;
  } catch { return null; }
}

function storageEntries(userId, scope) {
  const id = userIdValue(userId);
  const prefix = scopeValue(scope) === "shared" ? "mult-portas-shared" : "mult-portas-guia";
  return [
    { key: `${prefix}-user-${id}-resume-v1`, kind: "resume", brand: null },
    ...CLIENT_PROGRESS_BRANDS.flatMap((brand) => [
      { key: `${prefix}-learning-v1-user-${id}-brand-${brand}`, kind: "learning", brand },
      { key: `${prefix}-study-sheet-v1-user-${id}-brand-${brand}`, kind: "studySheet", brand },
      { key: `${prefix}-catalog-view-v1-user-${id}-brand-${brand}`, kind: "view", brand },
    ]),
  ];
}

/** @param {ProgressUserId} userId @param {{scope?: ProgressScope}} [options] */
export function clientProgressStorageKeys(userId, { scope = "local" } = {}) {
  return storageEntries(userId, scope).map(({ key }) => key);
}

function readEntry(raw, entry) {
  if (new TextEncoder().encode(raw).byteLength > MAX_CLIENT_PROGRESS_BYTES) throw new RangeError("Stored progress exceeds its limit.");
  if (entry.kind === "view") return enumValue(raw, ["learn", "fiches", "pdfs"], "catalog view");
  const value = JSON.parse(raw);
  if (entry.kind === "resume") return normalizeResume(value);
  if (entry.kind === "learning") return normalizeLearning(value, entry.brand);
  return normalizeSheet(value);
}

/**
 * Reads exact keys only; damaged JSON is omitted without altering its original.
 * @param {ProgressUserId} userId
 * @param {ProgressStorage} [storage]
 * @param {{scope?: ProgressScope}} [options]
 * @returns {ClientProgress}
 */
export function collectClientProgress(userId, storage, { scope = "local" } = {}) {
  const entries = storageEntries(userId, scope);
  const currentStorage = storageValue(storage);
  /** @type {ClientProgress} */
  const result = { schemaVersion: 1 };
  if (!currentStorage) return result;
  for (const entry of entries) {
    try {
      const raw = currentStorage.getItem(entry.key);
      if (raw === null) continue;
      const value = readEntry(raw, entry);
      if (entry.kind === "resume") result.resume = value;
      else {
        result.brands ??= {};
        result.brands[entry.brand] ??= {};
        result.brands[entry.brand][entry.kind] = value;
      }
    } catch { /* Preserve inaccessible, oversized and damaged originals. */ }
  }
  return normalizeClientProgress(result);
}

/**
 * Applies only present remote records. Invalid preexisting values survive for
 * recovery. The caller must apply before mounting components that cache state.
 * @param {ProgressUserId} userId
 * @param {unknown} value
 * @param {ProgressStorage} [storage]
 * @param {{scope?: ProgressScope}} [options]
 * @returns {ProgressApplication}
 */
export function applyClientProgress(userId, value, storage, { scope = "local" } = {}) {
  const progress = normalizeClientProgress(value);
  const entries = storageEntries(userId, scope);
  const currentStorage = storageValue(storage);
  /** @type {ProgressApplication} */
  const result = { writtenKeys: [], preservedKeys: [] };
  for (const entry of entries) {
    const incoming = entry.kind === "resume" ? progress.resume : progress.brands?.[entry.brand]?.[entry.kind];
    if (incoming === undefined) continue;
    if (!currentStorage) { result.preservedKeys.push(entry.key); continue; }
    try {
      const original = currentStorage.getItem(entry.key);
      // Merge missing object fields; a provided answers map or empty string is
      // an explicit replacement, so resetting an exercise remains possible.
      const existing = original === null ? null : readEntry(original, entry);
      const next = entry.kind === "view" ? incoming : { ...(existing ?? {}), ...incoming };
      const serialized = entry.kind === "view" ? next : JSON.stringify(next);
      if (serialized !== original) {
        currentStorage.setItem(entry.key, serialized);
        result.writtenKeys.push(entry.key);
      }
    } catch { result.preservedKeys.push(entry.key); }
  }
  return result;
}

/**
 * Authenticated migration calls this explicitly. It never scans storage and
 * never removes a source or overwrites a destination, including damaged data.
 * @param {ProgressUserId} oldId
 * @param {ProgressUserId} newId
 * @param {ProgressStorage} [storage]
 * @param {{fromScope?: ProgressScope, toScope?: ProgressScope}} [options]
 * @returns {ProgressApplication}
 */
export function migrateClientProgress(oldId, newId, storage, { fromScope = "local", toScope = "shared" } = {}) {
  const source = storageEntries(oldId, fromScope);
  const destination = storageEntries(newId, toScope);
  const currentStorage = storageValue(storage);
  /** @type {ProgressApplication} */
  const result = { writtenKeys: [], preservedKeys: [] };
  if (!currentStorage) return result;
  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    const target = destination[index];
    try {
      const raw = currentStorage.getItem(entry.key);
      if (raw === null) continue;
      readEntry(raw, entry);
      if (currentStorage.getItem(target.key) !== null) { result.preservedKeys.push(target.key); continue; }
      currentStorage.setItem(target.key, raw);
      result.writtenKeys.push(target.key);
    } catch { result.preservedKeys.push(entry.key); }
  }
  return result;
}
