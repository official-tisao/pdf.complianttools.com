export type WorkerTask<T> = (signal: AbortSignal) => Promise<T> | T;

export class WorkerPool {
  readonly #concurrency: number;
  #active = 0;
  readonly #queue: Array<{
    task: WorkerTask<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    controller: AbortController;
  }> = [];

  constructor(concurrency = 1) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError('WorkerPool concurrency must be a positive integer.');
    }
    this.#concurrency = concurrency;
  }

  run<T>(task: WorkerTask<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted)
      return Promise.reject(new DOMException('The task was aborted.', 'AbortError'));
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    return new Promise<T>((resolve, reject) => {
      this.#queue.push({
        task: async (taskSignal) => task(taskSignal),
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value as T);
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', onAbort);
          reject(reason);
        },
        controller,
      });
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#active < this.#concurrency && this.#queue.length > 0) {
      const item = this.#queue.shift();
      if (!item) return;
      this.#active += 1;
      void Promise.resolve()
        .then(() => item.task(item.controller.signal))
        .then(item.resolve, item.reject)
        .finally(() => {
          this.#active -= 1;
          this.#drain();
        });
    }
  }
}
