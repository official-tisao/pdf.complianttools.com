import { PdfEngineError, type EngineError } from '../errors.js';

export type WorkerReply<T> =
  { ok: true; value: T } | { ok: false; error: string; details?: EngineError };

/**
 * Rebuilds a typed engine error from a worker failure.
 *
 * `details` is what preserves the remedy. A worker that only returns a message
 * string collapses, say, `permission-denied` and `unsupported-format` into one
 * indistinguishable failure, and the user gets a message with no action
 * attached (P8). Workers that predate `details` still work — they just yield a
 * plain `Error`, which is why the field is optional.
 */
function toEngineError(reply: { error: string; details?: EngineError }): Error {
  return reply.details ? new PdfEngineError(reply.details) : new Error(reply.error);
}

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
      else reject(toEngineError(event.data));
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
