import { WorkerPool, type WorkerTask } from './worker-pool.js';

export function createScheduler(concurrency = 1): {
  run<T>(task: WorkerTask<T>, signal?: AbortSignal): Promise<T>;
} {
  const pool = new WorkerPool(concurrency);
  return { run: (task, signal) => pool.run(task, signal) };
}
