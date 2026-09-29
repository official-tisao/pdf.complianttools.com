import { imageToPdf } from './conversion/images.js';
import { PdfEngineError } from './errors.js';
import { estimateSkew, type GrayscaleImage } from './scan-deskew.js';
import type { ScanFrame } from './scan-camera.js';

/**
 * The scan capability that actually does work: deskewing and PDF assembly.
 *
 * Both reach heavy modules — `conversion/images.ts` pulls pdf-lib, and
 * `scan-deskew.ts` is the estimator — so this module must only ever be reached
 * through a dynamic import, by the gesture that needs it. The camera
 * primitives a capture UI must hold statically live in `scan-camera.ts`, which
 * is a leaf; see that file for why the split exists.
 */
export type DeskewEstimate = { angleDegrees: number; confidence: number; applied: boolean };

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

// Re-exported so the established `engine/scan` entry point still offers the
// whole scan surface. Existing callers and tests keep working unchanged; new
// code that needs the camera on page load imports `engine/scan-camera`
// directly, because reaching these through `scan.ts` costs pdf-lib.
export { requestScanCamera, stopScanCamera } from './scan-camera.js';
export type { ScanFrame, ScanMediaStream } from './scan-camera.js';
