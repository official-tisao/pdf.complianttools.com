import { inspectWithPdfJs } from './read.js';
import type { DocMeta } from '../types.js';
import type { WorkerReply } from '../runtime/module-worker.js';

type InspectRequest = { bytes: ArrayBuffer };
type WorkerScope = {
  onmessage: ((event: MessageEvent<InspectRequest>) => void) | null;
  postMessage(message: WorkerReply<DocMeta>): void;
};

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = async (event) => {
  try {
    const meta = await inspectWithPdfJs(new Uint8Array(event.data.bytes));
    scope.postMessage({ ok: true, value: meta });
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'PDF inspection failed.',
    });
  }
};
