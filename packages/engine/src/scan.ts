import { imageToPdf } from './conversion/images.js';
import { PdfEngineError } from './errors.js';

export type ScanMediaStream = { getTracks: () => readonly { stop: () => void }[] };
export type ScanFrame = {
  bytes: Uint8Array;
  format: 'jpg' | 'png';
  width?: number;
  height?: number;
};
export type DeskewEstimate = { angleDegrees: number; confidence: number; applied: boolean };

/** Camera access is always explicit; this helper never starts a stream on module import. */
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
  } catch {
    throw new PdfEngineError({
      kind: 'permission-denied',
      resource: 'camera',
      remedy: 'Allow camera access in the browser, or choose image files for a local scan.',
    });
  }
}

/** Classical scan seam: callers can provide a measured angle from a CV worker; no remote OCR is implied. */
export function estimateDocumentSkew(edgeAngles: readonly number[]): DeskewEstimate {
  if (edgeAngles.length === 0) return { angleDegrees: 0, confidence: 0, applied: false };
  const angle = edgeAngles.reduce((sum, value) => sum + value, 0) / edgeAngles.length;
  const bounded = Math.max(-15, Math.min(15, angle));
  return {
    angleDegrees: Number(bounded.toFixed(3)),
    confidence: Math.min(1, edgeAngles.length / 4),
    applied: Math.abs(bounded) >= 0.25,
  };
}

export async function assembleScans(frames: readonly ScanFrame[]): Promise<Uint8Array> {
  if (frames.length === 0)
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'scan-to-pdf',
      remedy: 'Capture or select at least one page before exporting.',
    });
  const pages = await Promise.all(frames.map((frame) => imageToPdf(frame.bytes, frame.format)));
  if (pages.length === 1) return pages[0]!;
  const { mergePdfBuffers } = await import('./pdf/merge.js');
  return mergePdfBuffers(pages);
}

export function stopScanCamera(stream: ScanMediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}
