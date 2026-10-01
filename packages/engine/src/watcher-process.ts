/**
 * P7-09 (T71) — auto-processing for the folder watcher.
 *
 * README §4.10 specifies that files dropped into a picked folder are *processed*, not merely
 * reported. `watcher.ts` detects files and calls `onFile`; this module is the processing half that
 * was missing — it applies a recipe and writes the result into an output folder. It deliberately
 * does not own the polling loop: `FolderWatcher` already does, and a second loop here would
 * double-scan the same directory.
 *
 * Two boundaries are load-bearing:
 *
 * - Nothing is read or written before permission. The output handle is permissioned exactly like
 *   the input one, so the watcher cannot be pointed at a folder the user has not granted.
 * - Every failure carries a remedy, and a per-file failure never stops the watcher. A corrupt PDF
 *   in a watched folder must not take down the run for every other file, so `processWatchedFile`
 *   returns the failure instead of throwing and the caller keeps going.
 */

import { PdfEngineError } from './errors.js';
import type { EngineError } from './errors.js';
import { classifyPdfInput } from './pdf/read.js';
import { compile, parseRecipe } from './recipe.js';
import type { Recipe } from './types.js';
import { run } from './runtime/pipeline.js';

/** A destination directory, as the File System Access API exposes one. */
export type WritableDirectoryHandle = {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: unknown) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

export type WritableDirectoryWithSubdirectories = WritableDirectoryHandle & {
  getDirectoryHandle?: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<WritableDirectoryHandle>;
};

/**
 * The processing seam. The default runs the recipe through the shared engine, which is what makes
 * the watcher produce the same bytes as the CLI for the same recipe. A caller with a different
 * pipeline supplies its own.
 */
export type WatchProcessor = (input: Uint8Array, recipe: Recipe) => Promise<Uint8Array>;

export type WatchedFileResult = {
  name: string;
  status: 'succeeded' | 'failed';
  /** The name actually written. Differs from `name` because the suffix is inserted. */
  outputName?: string;
  attempts: number;
  error?: EngineError;
};

export type WatchProcessOptions = {
  /** The recipe applied to every detected file. */
  recipe: Recipe;
  output: WritableDirectoryHandle;
  /** Subdirectory of the output handle to write into, created where the API allows it. */
  outputSubdirectory?: string;
  /** Inserted before the extension. Defaults to `.processed`, so an output can never overwrite
   *  the input it came from. */
  suffix?: string;
  maxRetries?: number;
  processor?: WatchProcessor;
  /** Called after every file, so a page can show progress without polling. */
  onResult?: (result: WatchedFileResult) => void;
};

/**
 * Asks for read/write permission on the output folder, mirroring `FolderWatcher.start`. Kept
 * separate from picking because the browser cannot know which handle the caller wants until the
 * user chooses it.
 */
export async function assertWritable(directory: WritableDirectoryHandle): Promise<void> {
  const granted = await (directory.requestPermission?.({ mode: 'readwrite' }) ??
    directory.queryPermission?.({ mode: 'readwrite' }));
  if (granted !== 'granted')
    throw new PdfEngineError({
      kind: 'permission-denied',
      resource: 'output folder',
      remedy:
        'Allow write access to the output folder. Without it a detected file can be processed but not saved.',
    });
}

/**
 * Resolves the subdirectory when the API supports one, and falls back to the output folder itself
 * where it does not. A missing subdirectory handle is not an error — the convenience must not
 * fail the common case.
 */
export async function resolveOutputDirectory(
  directory: WritableDirectoryWithSubdirectories,
  subdirectory?: string,
): Promise<WritableDirectoryHandle> {
  if (!subdirectory) return directory;
  if (typeof directory.getDirectoryHandle !== 'function') return directory;
  try {
    return await directory.getDirectoryHandle(subdirectory, { create: true });
  } catch {
    return directory;
  }
}

/** `report.pdf` + `.processed` → `report.processed.pdf`. */
export function outputNameFor(name: string, suffix = '.processed'): string {
  const dot = name.lastIndexOf('.');
  // `dot <= 0` covers both "no extension" and a dotfile like `.env`, where the
  // suffix belongs on the end rather than in the middle.
  if (dot <= 0) return `${name}${suffix}`;
  return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

async function defaultProcessor(input: Uint8Array, recipe: Recipe): Promise<Uint8Array> {
  const inspection = await classifyPdfInput(input);
  if (!inspection.ok) throw new PdfEngineError(inspection.error);
  const plan = compile(recipe, inspection.meta);
  let result: Uint8Array | undefined;
  for await (const event of run(plan, [input])) if (event.kind === 'result') result = event.bytes;
  if (!result)
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'watch',
      remedy:
        'The recipe produced no output for this file. Check that the recipe has at least one step.',
    });
  return result;
}

function toEngineError(error: unknown, name: string): EngineError {
  if (error instanceof PdfEngineError) {
    const details = error.details;
    // A per-file failure has to say WHICH file, and the engine's own errors do not carry a
    // filename — they describe the operation, not the document. Without this the user sees a
    // remedy naming a problem ("Re-export the PDF…") with no indication of what to re-export,
    // and with several files in a watched folder there is no way to tell them apart. The
    // engine-specific `cause` is preserved so the original diagnosis survives.
    const cause =
      'cause' in details && typeof details.cause === 'string'
        ? `${name}: ${details.cause}`
        : `${name}: the engine reported "${details.kind}".`;
    return { ...details, cause } as EngineError;
  }
  return {
    kind: 'conversion-failed',
    format: 'pdf',
    direction: 'to-pdf',
    cause: `${name}: ${error instanceof Error ? error.message : 'Unknown failure.'}`,
    remedy: 'The file was left untouched. Repair it, or drop a corrected copy into the folder.',
  };
}

async function writeBytes(
  directory: WritableDirectoryHandle,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  // Copied into a standalone buffer: a view over a larger pooled buffer would hand the
  // writer bytes it does not own, which some implementations refuse to serialise.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await writable.write(copy);
  await writable.close();
}

/**
 * Processes one detected file: applies the recipe and writes the result.
 *
 * Never throws for a per-file problem — the result carries the error instead, so one bad file in
 * a watched folder cannot stop the watcher for every other file.
 */
export async function processWatchedFile(
  file: File,
  options: WatchProcessOptions,
  target: WritableDirectoryHandle = options.output,
): Promise<WatchedFileResult> {
  const recipe = parseRecipe(options.recipe);
  const retries = Math.max(0, Math.min(options.maxRetries ?? 0, 3));
  const outputName = outputNameFor(file.name, options.suffix ?? '.processed');
  const processor = options.processor ?? defaultProcessor;
  let lastError: EngineError | undefined;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await writeBytes(target, outputName, await processor(bytes, recipe));
      return { name: file.name, status: 'succeeded', outputName, attempts: attempt };
    } catch (error) {
      lastError = toEngineError(error, file.name);
    }
  }
  // `lastError` is set on every path that reaches here: the loop only falls through after the
  // final `catch`, and each `catch` assigns it unconditionally.
  return { name: file.name, status: 'failed', attempts: retries + 1, error: lastError! };
}

/**
 * Builds the `onFile` callback a `FolderWatcher` needs to auto-process, with the output directory
 * resolved and permissioned up front so a denied write fails at start rather than once per file.
 */
export async function watchProcessor(
  options: WatchProcessOptions,
): Promise<(file: File) => Promise<void>> {
  await assertWritable(options.output);
  const target = await resolveOutputDirectory(
    options.output as WritableDirectoryWithSubdirectories,
    options.outputSubdirectory,
  );
  return async (file: File) => {
    const result = await processWatchedFile(file, options, target);
    options.onResult?.(result);
  };
}

/** A picked directory plus the name to show the user, which the raw handle does not carry. */
export type PickedOutputFolder = WritableDirectoryHandle & { name: string };

/**
 * Picks the folder results are written to. Separate from `pickFolder` for the input directory
 * because the two permissions differ: the watcher needs `read`, and the output needs `readwrite`.
 * Asking for one handle for both would request write access to a folder the user only meant to
 * read from.
 *
 * Throws a typed `unsupported-feature` where the API is absent, rather than returning a handle
 * that cannot write.
 */
export async function pickOutputFolder(): Promise<PickedOutputFolder> {
  const picker = (
    globalThis as {
      showDirectoryPicker?: (options?: {
        mode?: 'read' | 'readwrite';
        id?: string;
      }) => Promise<WritableDirectoryHandle & { name?: string }>;
    }
  ).showDirectoryPicker;
  if (!picker)
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'File System Access API',
      remedy:
        'Writing processed files back needs a Chromium-based browser with folder access support.',
    });
  const handle = await picker({ mode: 'readwrite', id: 'pdf-tools-watch-output' });
  // `name` is not on the base lib.dom type, so it is narrowed here rather than cast at the call
  // site; a handle without it would render an empty path in the status line.
  const name = (handle as { name?: string }).name ?? 'the output folder';
  return { ...handle, name };
}
