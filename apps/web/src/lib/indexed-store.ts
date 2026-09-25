export async function saveLocalJson(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('pdf-complianttools', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

export async function loadLocalJson<T>(key: string): Promise<T | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  return new Promise<T | undefined>((resolve, reject) => {
    const request = indexedDB.open('pdf-complianttools', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('settings', 'readonly');
      const read = transaction.objectStore('settings').get(key);
      read.onsuccess = () => resolve(read.result as T | undefined);
      read.onerror = () => reject(read.error);
    };
  });
}
