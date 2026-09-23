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

export async function runBatch(
  inputs: readonly Uint8Array[],
  recipeInput: Recipe,
  options: BatchOptions = {},
  processor = defaultProcessor,
): Promise<BatchItemResult[]> {
  const recipe = parseRecipe(recipeInput);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 8));
  const retries = Math.max(0, Math.min(options.maxRetries ?? 1, 3));
  const maxMemory = options.maxMemoryBytes ?? 384 * 1024 * 1024;
  const projected = inputs.reduce((sum, input) => sum + input.byteLength * 2, 0);
  if (projected > maxMemory)
    throw new PdfEngineError({
      kind: 'memory-limit-exceeded',
      projectedBytes: projected,
      maxBytes: maxMemory,
      remedy: 'Reduce the batch size or run it in smaller groups.',
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
