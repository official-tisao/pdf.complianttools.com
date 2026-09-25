import { AiError } from './errors.js';
import { assertSafeEndpoint } from './transport.js';
import type { AiKeyMetadata, AiKeyStore, ProviderConnection } from './types.js';

const DATABASE_NAME = 'pdf-complianttools-ai';
const DATABASE_VERSION = 1;
const STORE_NAME = 'connections';

type StoredConnection = Readonly<{
  providerId: string;
  connection: ProviderConnection;
  secret: string;
  updatedAt: number;
}>;

export function createIndexedDbKeyStore(
  indexedDb: IDBFactory | undefined = globalThis.indexedDB,
): AiKeyStore {
  if (!indexedDb) {
    return unavailableStore();
  }
  return {
    async save(connection, secret) {
      assertSecret(secret);
      assertSafeEndpoint(connection.endpoint);
      await withStore(indexedDb, 'readwrite', (store) => {
        store.put({
          providerId: connection.id,
          connection,
          secret,
          updatedAt: Date.now(),
        } satisfies StoredConnection);
      });
    },
    async get(providerId) {
      const value = await withStore(indexedDb, 'readonly', (store) => store.get(providerId));
      if (!value) return undefined;
      const stored = value as StoredConnection;
      return { connection: stored.connection, secret: stored.secret };
    },
    async listMetadata() {
      const values = (await withStore(indexedDb, 'readonly', (store) =>
        store.getAll(),
      )) as StoredConnection[];
      return values.map((value) => toMetadata(value));
    },
    async remove(providerId) {
      await withStore(indexedDb, 'readwrite', (store) => store.delete(providerId));
    },
  };
}

export function sanitizeAiDiagnostic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeAiDiagnostic(item));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/secret|key|token|authorization|credential/iu.test(key)) output[key] = '[redacted]';
    else output[key] = sanitizeAiDiagnostic(item);
  }
  return output;
}

function toMetadata(value: StoredConnection): AiKeyMetadata {
  return {
    providerId: value.connection.id,
    label: value.connection.label,
    family: value.connection.family,
    endpoint: value.connection.endpoint,
    capabilities: value.connection.capabilities,
    updatedAt: value.updatedAt,
  };
}

function assertSecret(secret: string): void {
  if (!secret.trim())
    throw new AiError({
      kind: 'ai-key-not-configured',
      providerId: 'unknown',
      remedy: 'Enter a provider key before saving the connection.',
    });
}

function unavailableStore(): AiKeyStore {
  const fail = async (): Promise<never> => {
    throw new AiError({
      kind: 'ai-key-storage-unavailable',
      remedy:
        'This browser does not expose IndexedDB. Use a browser profile with site storage enabled.',
    });
  };
  return { save: fail, get: fail, listMetadata: fail, remove: fail };
}

function openDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME, { keyPath: 'providerId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
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
        reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    }).finally(() => database.close()),
  );
}
