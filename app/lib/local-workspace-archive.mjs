// Permanent device copies are separate from the retry queue. Confirming a
// server save may clear a pending draft, but never removes this local archive.
export function businessDay(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export async function keepLocalWorkspace(userId, snapshot, { storage = globalThis.localStorage, database = globalThis.indexedDB } = {}) {
  if (!Number.isSafeInteger(userId) || userId < 1 || !snapshot?.state) return false;
  const updatedAt = snapshot.updatedAt ?? new Date().toISOString();
  const day = businessDay(updatedAt);
  const value = { ...snapshot, userId, day, updatedAt };
  const latestKey = `mult-portas-shared-user-${userId}-workspace-copy-v1`;
  // A small-storage fallback also keeps the latest copy if IndexedDB is blocked.
  let stored = false;
  try {
    const previous = JSON.parse(storage?.getItem(latestKey) ?? "null");
    if (!previous || previous.updatedAt <= updatedAt) storage?.setItem(latestKey, JSON.stringify(value));
    stored = Boolean(storage);
  } catch { /* IndexedDB has an independent, larger quota. */ }
  if (!database) return stored;
  try {
    await new Promise((resolve, reject) => {
      const opening = database.open("mult-portas-local-archive-v1", 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore("days", { keyPath: ["userId", "day"] });
        opening.result.createObjectStore("quotes", { keyPath: ["userId", "id", "day"] });
      };
      opening.onerror = () => reject(opening.error);
      opening.onblocked = () => reject(new Error("Local archive blocked"));
      opening.onsuccess = () => {
        const db = opening.result;
        const transaction = db.transaction("days", "readwrite");
        const days = transaction.objectStore("days");
        const reading = days.get([userId, day]);
        reading.onsuccess = () => {
          if (!reading.result || reading.result.updatedAt <= updatedAt) days.put(value);
        };
        transaction.oncomplete = () => { db.close(); resolve(true); };
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
    return true;
  } catch { return stored; }
}

export async function keepLocalQuotes(userId, records, database = globalThis.indexedDB) {
  if (!database || !Number.isSafeInteger(userId) || userId < 1 || !records.length) return false;
  try {
    await new Promise((resolve, reject) => {
      const opening = database.open("mult-portas-local-archive-v1", 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore("days", { keyPath: ["userId", "day"] });
        opening.result.createObjectStore("quotes", { keyPath: ["userId", "id", "day"] });
      };
      opening.onerror = () => reject(opening.error);
      opening.onblocked = () => reject(new Error("Local archive blocked"));
      opening.onsuccess = () => {
        const db = opening.result;
        const transaction = db.transaction("quotes", "readwrite");
        const quotes = transaction.objectStore("quotes");
        const day = businessDay();
        for (const record of records) {
          const reading = quotes.get([userId, record.id, day]);
          reading.onsuccess = () => {
            if (!reading.result || reading.result.record.revision <= record.revision) quotes.put({ userId, id: record.id, day, record });
          };
        }
        transaction.oncomplete = () => { db.close(); resolve(true); };
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
    return true;
  } catch { return false; }
}
