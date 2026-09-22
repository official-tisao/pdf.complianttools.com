export type WorkerReply<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run one typed message through a browser module worker and terminate it after completion. */
export function runInModuleWorker<TInput, TOutput>(
  workerUrl: URL,
  payload: TInput,
  transfer: Transferable[] = [],
  signal?: AbortSignal,
): Promise<TOutput> {
  const worker = new Worker(workerUrl, { type: 'module' });
  return new Promise<TOutput>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('The task was aborted.', 'AbortError'));
    };

    worker.onmessage = (event: MessageEvent<WorkerReply<TOutput>>) => {
      cleanup();
      if (event.data.ok) resolve(event.data.value);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(event.error ?? new Error(event.message));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage(payload, transfer);
  });
}
