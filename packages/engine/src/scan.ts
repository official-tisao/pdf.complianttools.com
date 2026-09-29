import { imageToPdf } from './conversion/images.js';
import { PdfEngineError } from './errors.js';
import { estimateSkew, type GrayscaleImage } from './scan-deskew.js';

export type ScanMediaStream = { getTracks: () => readonly { stop: () => void }[] };
export type ScanFrame = {
  bytes: Uint8Array;
  format: 'jpg' | 'png';
  width?: number;
  height?: number;
};
export type DeskewEstimate = { angleDegrees: number; confidence: number; applied: boolean };

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

/**
 * Rotation deskew measured from pixels. Delegates to `scan-deskew.ts`, which
 * implements the classical projection-profile estimator; this name is kept
 * because it is the one the capture UI reaches for.
 *
 * Perspective (four-point) correction is NOT performed here — it is a separate
 * capability, recorded as a follow-up in PLAN.md P7-04.
 */
export function estimateDocumentSkew(image: GrayscaleImage): DeskewEstimate {
  const { angleDegrees, confidence, applied } = estimateSkew(image);
  return { angleDegrees, confidence, applied };
}

export async function assembleScans(frames: readonly ScanFrame[]): Promise<Uint8Array> {
  if (frames.length === 0)
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'scan-to-pdf',
      remedy: 'Capture or select at least one page before exporting.',
    });
  // A malformed page must fail as a typed, actionable error. The underlying
  // decoders throw bare library errors — and for a truncated PNG, a non-Error
  // with no message at all — so an uncaught failure here would reach the user as
  // an empty status line with nothing to act on.
  const pages = await Promise.all(
    frames.map(async (frame, index) => {
      try {
        return await imageToPdf(frame.bytes, frame.format);
      } catch (cause) {
        if (cause instanceof PdfEngineError) throw cause;
        const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : '';
        throw new PdfEngineError({
          kind: 'unsupported-format',
          format: frame.format,
          direction: 'to-pdf',
          remedy: `Page ${index + 1} could not be read as ${frame.format.toUpperCase()}${detail}. Re-capture that page, or import a PNG or JPEG file.`,
        });
      }
    }),
  );
  if (pages.length === 1) return pages[0]!;
  const { mergePdfBuffers } = await import('./pdf/merge.js');
  return mergePdfBuffers(pages);
}

export function stopScanCamera(stream: ScanMediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}
