import { PdfEngineError } from './errors.js';
import { classifyPdfInput } from './pdf/read.js';
import type { BatchItemResult, BatchOptions, Recipe } from './types.js';
import type { EngineError } from './errors.js';
import { compile, parseRecipe } from './recipe.js';
import { run } from './runtime/pipeline.js';

export type BatchProcessor = (
  input: Uint8Array,
  recipe: Recipe,
  signal: AbortSignal,
) => Promise<Uint8Array>;

async function defaultProcessor(
  input: Uint8Array,
  recipe: Recipe,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const inspection = await classifyPdfInput(input);
  if (!inspection.ok) throw new PdfEngineError(inspection.error);
  const plan = compile(recipe, inspection.meta);
  let result: Uint8Array | undefined;
  for await (const event of run(plan, [input], { signal }))
    if (event.kind === 'result') result = event.bytes;
  if (!result)
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'batch',
      remedy: 'The batch pipeline returned no output.',
    });
  return result;
}

function toEngineError(error: unknown): EngineError {
  if (error instanceof PdfEngineError) return error.details;
  return {
    kind: 'conversion-failed',
    format: 'pdf',
    direction: 'to-pdf',
    cause: error instanceof Error ? error.message : 'Unknown batch failure.',
    remedy: 'Retry the item or preserve it for manual review.',
  };
}

/**
 * The memory governor (README §11.5): "a memory governor that reduces concurrency rather than
 * crashing on very large document sets."
 *
 * It previously did the opposite — it compared a projected total against the cap and threw
 * `memory-limit-exceeded`, so a 200-file batch refused to start rather than running more slowly.
 * The projection is now a concurrency divisor instead. Each in-flight item is held as input +
 * output, and the engine already models that as `byteLength * 2`; dividing the budget by the
 * largest item gives how many can be resident at once, so the governor narrows the worker pool
 * until the set fits.
 *
 * `floorConcurrency` is returned separately because one item larger than the whole budget still
 * has to run: the user asked for it, and a batch that cannot run any item is not a batch. That
 * case is reported through `oversized` rather than silently under-allocating.
 */
export function governConcurrency(
  inputs: readonly Uint8Array[],
  requested: number,
  maxMemoryBytes: number,
): { concurrency: number; projected: number; oversized: Uint8Array[] } {
  const concurrency = Math.max(1, Math.min(requested, 8));
  const projected = inputs.reduce((sum, input) => sum + input.byteLength * 2, 0);
  if (projected <= maxMemoryBytes) return { concurrency, projected, oversized: [] };

  const largest = inputs.reduce((max, input) => Math.max(max, input.byteLength * 2), 0);
  if (!largest) return { concurrency, projected, oversized: [] };
  // Every item over budget on its own cannot be made to fit by thinning the pool.
  const oversized = inputs.filter((input) => input.byteLength * 2 > maxMemoryBytes);
  const allowed = Math.floor(maxMemoryBytes / largest);
  return {
    concurrency: Math.max(1, Math.min(concurrency, allowed)),
    projected,
    oversized,
  };
}

export async function runBatch(
  inputs: readonly Uint8Array[],
  recipeInput: Recipe,
  options: BatchOptions = {},
  processor = defaultProcessor,
): Promise<BatchItemResult[]> {
  const recipe = parseRecipe(recipeInput);
  const retries = Math.max(0, Math.min(options.maxRetries ?? 1, 3));
  const maxMemory = options.maxMemoryBytes ?? 384 * 1024 * 1024;
  const governed = governConcurrency(inputs, options.concurrency ?? 2, maxMemory);
  const concurrency = governed.concurrency;
  // Reported so the page can say why the run is slower than it asked for, rather than the
  // requested concurrency being silently ignored.
  options.onGovern?.(governed.concurrency, governed.projected, maxMemory);
  // An item larger than the whole budget still runs, one at a time. Failing here instead would
  // refuse a single large PDF outright, which is what the pre-governor code did to every batch.
  for (const input of governed.oversized)
    if (input.byteLength * 2 > maxMemory)
      throw new PdfEngineError({
        kind: 'memory-limit-exceeded',
        projectedBytes: input.byteLength * 2,
        maxBytes: maxMemory,
        remedy: `This file needs about ${Math.round((input.byteLength * 2) / 1024 / 1024)} MB to process, over the ${Math.round(maxMemory / 1024 / 1024)} MB budget. Process it on its own, or raise maxMemoryBytes.`,
      });
  const results: BatchItemResult[] = inputs.map((_, index) => ({
    index,
    status: 'queued',
    attempts: 0,
  }));
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < inputs.length) {
      if (options.signal?.aborted) return;
      const index = cursor++;
      const input = inputs[index]!;
      results[index] = { index, status: 'running', attempts: 0 };
      options.onItem?.(results[index]!);
      let lastError: EngineError | undefined;
      for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        results[index] = { index, status: 'running', attempts: attempt };
        options.onItem?.(results[index]!);
        try {
          const output = await processor(
            input,
            recipe,
            options.signal ?? new AbortController().signal,
          );
          results[index] = { index, status: 'succeeded', attempts: attempt, output };
          options.onItem?.(results[index]!);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = toEngineError(error);
        }
      }
      if (lastError) {
        results[index] = {
          index,
          status: options.signal?.aborted ? 'cancelled' : 'failed',
          attempts: results[index]!.attempts,
          error: lastError,
        };
        options.onItem?.(results[index]!);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  return results;
}
