import { getOcrCacheKey, type OcrModelStore } from '@pdf-complianttools/engine';

// Tesseract.js 7 uses idb-keyval's keyval-store/keyval database for its browser cache.
// Sharing that exact store lets the verified download performed by the application be reused
// by the worker without a second unverified fetch from the model host.
const DATABASE_NAME = 'keyval-store';
const STORE_NAME = 'keyval';

/** IndexedDB-backed model cache; no model bytes are persisted outside the user's browser. */
export function createOcrModelStore(): OcrModelStore {
  const indexedDb = globalThis.indexedDB;
  if (!indexedDb) {
    return {
      has: async () => false,
      read: async () => {
        throw new Error('This browser does not expose IndexedDB for OCR model storage.');
      },
      put: async () => {
        throw new Error('This browser does not expose IndexedDB for OCR model storage.');
      },
      remove: async () => {},
    };
  }
  return {
    async has(language) {
      return Boolean(
        await withStore(indexedDb, 'readonly', (store) => store.get(getOcrCacheKey(language))),
      );
    },
    async read(language) {
      const value = await withStore(indexedDb, 'readonly', (store) =>
        store.get(getOcrCacheKey(language)),
      );
      if (!(value instanceof Uint8Array))
        throw new Error(`The cached ${language} OCR model is unavailable or corrupt.`);
      return value;
    },
    async put(language, model) {
      await withStore(indexedDb, 'readwrite', (store) =>
        store.put(model, getOcrCacheKey(language)),
      );
    },
    async remove(language) {
      await withStore(indexedDb, 'readwrite', (store) => store.delete(getOcrCacheKey(language)));
    },
  };
}

function openDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('OCR model database open failed.'));
  });
}

function withStore<T>(
  indexedDb: IDBFactory,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDatabase(indexedDb).then((database) =>
    new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request?.result as T | undefined);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('OCR model transaction failed.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('OCR model transaction aborted.'));
    }).finally(() => database.close()),
  );
}
