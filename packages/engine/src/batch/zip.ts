// P7-07 — Batch result packaging (CTO decision: separate from the pipeline).
// Constraint: individual BatchItemResult outputs remain available (batch.ts), so a failed
// item can be retried without reprocessing the successes. This module only packs completed
// outputs; it never touches retry or concurrency.

import { zipSync } from 'fflate';
import type { BatchItemResult } from '../types';

export interface ZipOptions {
  includeFailed?: boolean; // include items with status !== 'succeeded' for audit
}

export interface BatchManifest {
  total: number;
  completed: number;
  failed: number;
  zipEntries: number;
}

/**
 * Packs finished batch results into a single archive the user can download.
 *
 * Returns a plain `Uint8Array` rather than a Node `Buffer`: this runs in the browser, where
 * `Buffer` does not exist. It uses fflate (already a direct engine dependency, with a native
 * ESM build) rather than jszip, which is CommonJS-only and would drag CJS interop into a
 * shared engine module.
 */
export function zipBatchResults(
  results: readonly BatchItemResult[],
  options: ZipOptions = {},
): { zipBytes: Uint8Array; manifest: BatchManifest } {
  const manifest: BatchManifest = { total: results.length, completed: 0, failed: 0, zipEntries: 0 };
  const entries: Record<string, Uint8Array> = {};
  const encoder = new TextEncoder();

  for (const r of results) {
    const isFailed = r.status === 'failed';
    if (isFailed) manifest.failed++;
    else if (r.status === 'succeeded') manifest.completed++;

    const shouldPack = r.status === 'succeeded' || (options.includeFailed && isFailed);
    if (!shouldPack) continue;

    // A succeeded item with no bytes cannot be packed. Skipping it here is correct and needs
    // no counter adjustment: `zipEntries` only ever counts entries actually written, so the
    // manifest can never claim an entry the archive does not contain.
    if (r.status === 'succeeded' && !r.output) continue;

    const name = `batch_${r.index}_${r.status}.pdf`;
    entries[name] =
      r.status === 'succeeded'
        ? r.output!
        : encoder.encode(
            JSON.stringify({
              index: r.index,
              status: r.status,
              attempts: r.attempts,
              error: r.error,
            }),
          );
    manifest.zipEntries++;
  }

  // The manifest travels with the results so a download is self-describing: a user can see
  // which inputs succeeded and which failed without re-running the batch.
  manifest.zipEntries++;
  entries['manifest.json'] = encoder.encode(JSON.stringify(manifest, null, 2));

  // level 0 (store, no re-compression): the entries are already-compressed PDFs, so deflating
  // them again costs CPU and saves nothing.
  const zipBytes = zipSync(entries, { level: 0 });
  return { zipBytes, manifest };
}
