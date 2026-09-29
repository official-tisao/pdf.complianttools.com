// P7-07 — Partial ZIP packaging adapter (CTO decision: separate from pipeline)
// Constraint: individual BatchItemResult outputs remain available (batch.ts line 63-81).
// This module only packs completed outputs; never modifies retry/concurrency.

import JSZip from 'jszip';
import type { BatchItemResult } from '../types';

export interface ZipOptions {
  outDir?: string; // future: file-system write; current: in-memory / buffer
  includeFailed?: boolean; // include items with status !== 'succeeded' for audit
}

export async function zipBatchResults(
  results: readonly BatchItemResult[],
  options: ZipOptions = {},
): Promise<{
  zipBuffer: Buffer;
  manifest: { total: number; completed: number; failed: number; zipEntries: number };
}> {
  const zip = new JSZip();
  const manifest = { total: results.length, completed: 0, failed: 0, zipEntries: 0 };

  for (const r of results) {
    const isFailed = r.status === 'failed';
    if (isFailed) manifest.failed++;
    else if (r.status === 'succeeded') manifest.completed++;

    // Only pack if completed, or if includeFailed explicitly set
    const shouldPack = r.status === 'succeeded' || (options.includeFailed && isFailed);
    if (!shouldPack) continue;

    // Entry naming convention: batch_{index}_{status}.pdf (or .bin if raw bytes)
    // TODO(P7-07): wire real result.bytes when BatchItemResult gains byte payload.
    // For now this adapter validates the seam; actual byte ingestion comes from
    // consumer calling vendor-specific extraction before zipBatchResults.
    zip.file(
      `batch_${r.index}_${r.status}.txt`,
      JSON.stringify({ index: r.index, status: r.status, attempts: r.attempts }),
    );
    manifest.zipEntries++;
  }

  const zipBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
  return { zipBuffer, manifest };
}

// CTO extension — byte payload seam (P7-07 finish):
// When BatchItemResult carries .bytes (Uint8Array), zipBatchResults writes real file.
// Current adapter uses manifest + placeholder; real ingestion requires:
//   1) types.ts: add bytes?: Uint8Array to BatchItemResult
//   2) batch.ts: populate bytes on event.result (line ~26, result.bytes assigned)
//   3) zip.ts: replace placeholder with zip.file(name, r.bytes ?? placeholder)
// This is queued until BatchItemResult schema is updated; adapter is backward-compatible.
