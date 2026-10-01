import { PdfEngineError } from './errors.js';

/**
 * Camera capture primitives, deliberately split out of `scan.ts`.
 *
 * These two functions and the two types around them are the only part of the
 * scan surface that a page can legitimately hold on page load: `stopScanCamera`
 * has to be callable from an unmount effect, so it cannot sit behind a dynamic
 * import, and a component that imports it statically would otherwise pull in
 * everything `scan.ts` reaches.
 *
 * `scan.ts` is not a light module. It reaches `conversion/images.ts` (pdf-lib,
 * ~410 KB) for `assembleScans`, and `scan-deskew.ts` for `estimateDocumentSkew`,
 * so importing a one-line camera helper from it drags both onto the critical
 * path of every route that renders a capture UI — including routes such as
 * `/invoice-creator` that never assemble a scan and never open a camera.
 *
 * The split keeps this module a leaf: its only import is `errors.js`, which has
 * no imports of its own, so a static import here costs a couple of kilobytes
 * rather than half a megabyte. The scan capability is still loaded lazily, by
 * the gesture that needs it.
 */
export type ScanMediaStream = { getTracks: () => readonly { stop: () => void }[] };
export type ScanFrame = {
  bytes: Uint8Array;
  format: 'jpg' | 'png';
  width?: number;
  height?: number;
};

/** The `DOMException` names getUserMedia uses when a device simply is not there. */
const NO_DEVICE_ERRORS = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']);

/** The names that mean the user or the page is not allowed to use the camera. */
const PERMISSION_ERRORS = new Set([
  'NotAllowedError',
  'PermissionDeniedError',
  'SecurityError',
  'PermissionDismissedError',
]);

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

/**
 * Requests the camera. Always explicit: this is only ever reached from a user
 * gesture, and calling it never starts a stream on module import.
 *
 * A refusal and a missing camera are reported as different failures, because
 * they need different actions from the user. Telling someone to grant
 * permission on a device that has no camera (or whose permission is permanently
 * blocked) sends them somewhere they cannot succeed (P8).
 */
export async function requestScanCamera(): Promise<ScanMediaStream> {
  const browser = (
    globalThis as {
      navigator?: {
        mediaDevices?: { getUserMedia: (constraints: unknown) => Promise<ScanMediaStream> };
      };
    }
  ).navigator;
  if (!browser?.mediaDevices?.getUserMedia)
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'camera capture',
      remedy: 'Use a browser with getUserMedia support or import scanned image files instead.',
    });
  try {
    return await browser.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (error) {
    const name = errorName(error);
    if (PERMISSION_ERRORS.has(name))
      throw new PdfEngineError({
        kind: 'permission-denied',
        resource: 'camera',
        remedy: 'Allow camera access in the browser, or choose image files for a local scan.',
      });
    if (NO_DEVICE_ERRORS.has(name))
      throw new PdfEngineError({
        kind: 'camera-unavailable',
        remedy:
          'No camera was found on this device. Import scanned image files instead, or capture one on a device with a camera.',
      });
    // An unrecognised rejection (a platform string, or a non-Error) must still
    // arrive as a typed, actionable failure rather than an opaque one.
    throw new PdfEngineError({
      kind: 'camera-unavailable',
      remedy: `The camera could not be started${name ? ` (${name})` : ''}. Import scanned image files instead.`,
    });
  }
}

/** Releases the camera. Safe to call with a stream that has already stopped. */
export function stopScanCamera(stream: ScanMediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}
