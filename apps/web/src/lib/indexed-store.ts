/**
 * Local persistence. Every record is stored under a versioned envelope so a
 * later shape change can be migrated rather than silently misread. The store
 * version is bumped together with a migration step below — never on its own,
 * or an existing user's records become unreadable.
 */

const DB_NAME = 'pdf-complianttools';
const DB_VERSION = 2;
const SETTINGS = 'settings';
const TEMPLATES = 'templates';

/** v1 stored bare values with no envelope; v2 wraps every record. */
export type StoredRecord<T> = { v: number; value: T };
const CURRENT_RECORD_VERSION = 1;

type Migration = { to: number; run: (db: IDBDatabase, from: number) => void };

/**
 * Ordered by `to`, applied in sequence from whatever version the browser
 * reports. Adding v3 means appending `{ to: 3, run }` here — the ladder walks
 * it automatically.
 */
const MIGRATIONS: Migration[] = [
  {
    to: 2,
    run: (db) => {
      if (!db.objectStoreNames.contains(TEMPLATES)) {
        db.createObjectStore(TEMPLATES, { keyPath: 'id' });
      }
    },
  },
];

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // lib.dom types `oldVersion` on IDBVersionChangeEvent, but types the
      // handler's parameter as the request, so narrow explicitly.
      const from = (event as IDBVersionChangeEvent).oldVersion ?? 0;
      for (const migration of MIGRATIONS) {
        if (from < migration.to) migration.run(db, from);
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Another tab is holding an older database version; close it and retry.'));
    request.onsuccess = () => resolve(request.result);
  });
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (objectStore: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        let result: T | undefined;
        const request = work(transaction.objectStore(store));
        if (request) request.onsuccess = () => (result = request.result as T);
        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      }),
  );
}

/** Unwraps a stored envelope, tolerating a legacy bare value. */
function unwrap<T>(raw: unknown): T | undefined {
  if (raw && typeof raw === 'object' && 'v' in raw && 'value' in raw) {
    return (raw as StoredRecord<T>).value;
  }
  return raw as T | undefined;
}

export async function saveLocalJson(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await run(SETTINGS, 'readwrite', (store) =>
    store.put({ v: CURRENT_RECORD_VERSION, value } satisfies StoredRecord<unknown>, key),
  );
}

export async function loadLocalJson<T>(key: string): Promise<T | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  return unwrap<T>(await run<StoredRecord<T>>(SETTINGS, 'readonly', (store) => store.get(key)));
}

export async function removeLocalJson(key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await run(SETTINGS, 'readwrite', (store) => store.delete(key));
}

export type NamedTemplate = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  value: unknown;
};

function asTemplate(raw: unknown): NamedTemplate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Partial<NamedTemplate> & { v?: number };
  // Template records are stored FLATTENED (the id doubles as the in-line
  // keyPath) with `v` marking the record version, so `value` here is the
  // saved payload, not an envelope to unwrap. Only a v1 settings-style
  // nested envelope needs unwrapping.
  const body =
    typeof record.id === 'string' && typeof record.name === 'string'
      ? record
      : ((raw as { value?: unknown }).value as Partial<NamedTemplate> | undefined);
  if (!body || typeof body !== 'object') return undefined;
  const template = body as Partial<NamedTemplate>;
  if (typeof template.id !== 'string' || typeof template.name !== 'string') return undefined;
  return {
    id: template.id,
    name: template.name,
    createdAt: typeof template.createdAt === 'number' ? template.createdAt : 0,
    updatedAt: typeof template.updatedAt === 'number' ? template.updatedAt : 0,
    value: 'value' in template ? template.value : undefined,
  };
}

export async function listTemplates(): Promise<NamedTemplate[]> {
  if (typeof indexedDB === 'undefined') return [];
  const all = await run<unknown[]>(TEMPLATES, 'readonly', (store) => store.getAll());
  return (all ?? [])
    .map(asTemplate)
    .filter((template): template is NamedTemplate => template !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadTemplate(id: string): Promise<NamedTemplate | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  return asTemplate(await run(TEMPLATES, 'readonly', (store) => store.get(id)));
}

export async function saveTemplate(name: string, value: unknown): Promise<NamedTemplate> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('Templates need IndexedDB, which this browser did not provide.');
  }
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give the template a name before saving.');
  const existing = await listTemplates();
  const now = Date.now();
  const prior = existing.find((template) => template.name.toLowerCase() === trimmed.toLowerCase());
  const record: NamedTemplate = {
    id: prior?.id ?? `tpl_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
    value,
  };
  // The templates store is keyed in-line on `id`, so the key travels inside the
  // value. Passing a separate key argument is a ConstraintError.
  await run(TEMPLATES, 'readwrite', (store) =>
    store.put({ ...record, v: CURRENT_RECORD_VERSION } as unknown as NamedTemplate),
  );
  return record;
}

export async function deleteTemplate(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await run(TEMPLATES, 'readwrite', (store) => store.delete(id));
}
