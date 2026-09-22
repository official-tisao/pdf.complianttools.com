import { PdfEngineError } from '../errors.js';
import { pdfaReport, repairPdf } from '../pdf/operations.js';
import { applyGraphStep, MutationGraph, splitGraph } from '../pdf/graph.js';
import type { Plan, Progress, Result, RunOptions, SplitOptions } from '../types.js';

function cancelled(): PdfEngineError {
  return new PdfEngineError({
    kind: 'cancelled',
    remedy: 'The operation was cancelled. Your original files were not changed.',
  });
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

function emit(
  onProgress: RunOptions['onProgress'],
  completed: number,
  total: number,
  message: string,
): Progress {
  const value = { kind: 'progress' as const, completed, total, message };
  onProgress?.(value);
  return value;
}

/** Execute a compiled recipe against local bytes. The graph is serialized exactly once at the end. */
export async function* run(
  plan: Plan,
  inputs: readonly Uint8Array[],
  options: RunOptions = {},
): AsyncGenerator<Progress | Result> {
  if (inputs.length === 0 || !inputs[0])
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'run',
      remedy: 'Provide at least one PDF input.',
    });
  const total = Math.max(1, plan.operationCount);
  yield emit(options.onProgress, 0, total, 'Preparing local PDF pipeline.');

  let seed = inputs[0];
  const firstStep = plan.recipe.steps[0];
  if (firstStep?.op === 'repair') seed = await repairPdf(seed);
  const graph = await MutationGraph.fromInputs([seed]);
  let outputs: readonly Uint8Array[] | undefined;
  let report: unknown;
  let pdfaProfile: '1b' | '2b' | '3b' | undefined;

  for (const [index, step] of plan.recipe.steps.entries()) {
    check(options.signal);
    if (step.op === 'repair') {
      // Recovery is isolated before the graph is opened; subsequent mutations share the graph.
    } else if (step.op === 'rasterize') {
      throw new PdfEngineError({
        kind: 'unsupported-feature',
        feature: 'rasterize without a configured renderer',
        remedy: 'Configure the bundled pdfium renderer in the browser worker, then retry.',
      });
    } else if (step.op === 'pdfa') {
      pdfaProfile = (step.options.conformanceLevel as '1b' | '2b' | '3b' | undefined) ?? (step.options.profile as '1b' | '2b' | '3b' | undefined) ?? '2b';
    } else {
      outputs = await applyGraphStep(graph, step, inputs);
      if (outputs && index !== plan.recipe.steps.length - 1) {
        throw new PdfEngineError({
          kind: 'invalid-operation',
          operation: 'split',
          remedy:
            'Split must be the final step of a recipe so each output remains independently valid.',
        });
      }
    }
    check(options.signal);
    yield emit(options.onProgress, index + 1, total, `Completed ${step.op}.`);
  }

  check(options.signal);
  const finalOutputs = outputs ?? [await graph.save()];
  if (pdfaProfile) {
    report = await pdfaReport(finalOutputs[0]!, pdfaProfile);
    if (
      !(report as { passed: boolean }).passed &&
      plan.recipe.steps.some(
        (step) => step.op === 'pdfa' && step.options.fallbackOnFailure !== 'report-only',
      )
    ) {
      throw new PdfEngineError({
        kind: 'unsupported-feature',
        feature: 'PDF/A conformance',
        remedy:
          'The report found non-conforming content. Fix the listed checks or choose report-only.',
      });
    }
  }
  const result: Result = { kind: 'result', bytes: finalOutputs[0]!, mimeType: 'application/pdf' };
  if (finalOutputs.length > 1) result.outputs = finalOutputs;
  if (report !== undefined) result.report = report;
  yield result;
}

/** Split helper retained as a stable API for file-per-output UIs and the CLI. */
export async function splitPdf(
  bytes: Uint8Array,
  options: SplitOptions = {},
): Promise<Uint8Array[]> {
  const graph = await MutationGraph.fromInputs([bytes]);
  return splitGraph(graph, options);
}
