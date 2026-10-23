/** Browser-only storage. No server, account, cookies or network requests. */
const DB_NAME = 'charcoal-crocs-school-demo-v1';
let database, memory, pending = Promise.resolve(), warning = null;
const fresh = () => ({ version: 1, state: null, cat: null, generations: {}, variation: {} });
const clone = value => structuredClone(value);
async function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('design');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Browser storage is blocked.'));
  });
  return database;
}
async function load() {
  if (memory) return;
  try {
    const database = await db();
    memory = await new Promise((resolve, reject) => {
      const request = database.transaction('design').objectStore('design').get('current');
      request.onsuccess = () => resolve(request.result?.version === 1 ? request.result : fresh());
      request.onerror = () => reject(request.error);
    });
  } catch { memory = fresh(); warning = 'Browser storage is unavailable. Keep this tab open and download your design before leaving.'; }
}
async function persist(value) {
  try {
    const database = await db();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('design', 'readwrite');
      transaction.objectStore('design').put(value, 'current');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    warning = null;
  } catch { warning = 'This browser could not save the design locally. Keep the tab open or download the design JSON.'; }
}
export async function readLocal() { await pending.catch(() => {}); await load(); return clone(memory); }
export function updateLocal(change) {
  const operation = pending.catch(() => {}).then(async () => {
    await load(); const next = clone(memory);
    const result = await change(next); memory = next; await persist(next);
    return clone(result === undefined ? next : result);
  });
  pending = operation; return operation;
}
export const storageWarning = () => warning;
