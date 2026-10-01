import { deskew, type DeskewResult, type GrayscaleImage } from './scan-deskew.js';
import type { WorkerReply } from './runtime/module-worker.js';
import { PdfEngineError, type EngineError } from './errors.js';

type DeskewRequest = {
  pixels: ArrayBuffer;
  width: number;
  height: number;
};
type WorkerScope = {
  onmessage: ((event: MessageEvent<DeskewRequest>) => void) | null;
  postMessage(message: WorkerReply<DeskewResult>): void;
};

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = (event) => {
  try {
    const image: GrayscaleImage = {
      pixels: new Uint8Array(event.data.pixels),
      width: event.data.width,
      height: event.data.height,
    };
    scope.postMessage({ ok: true, value: deskew(image) });
  } catch (error) {
    // `details` travels with the failure so the caller gets the remedy back,
    // not just a string it has to guess an action for.
    const details: EngineError | undefined =
      error instanceof PdfEngineError ? error.details : undefined;
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Deskew failed.',
      ...(details ? { details } : {}),
    });
  }
};
