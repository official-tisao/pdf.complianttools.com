import { z } from 'zod';
import type { DocMeta, OpId, Plan, Recipe, Step, StepOptions } from './types.js';
import { PdfEngineError } from './errors.js';

const pageSelector = z.union([
  z.array(z.number().int().positive()),
  z.string().regex(/^(?:(?:\d+(?:-\d+)?)(?:,(?:\d+(?:-\d+)?))*|odd|even|blank)$/u),
]);

export const operationSchemas = {
  merge: z.object({
    fileOrder: z.array(z.number().int().nonnegative()).optional(),
    pageRangePerFile: z.record(z.string(), z.string()).optional(),
    preserveBookmarks: z.boolean().default(true),
    bookmarkStrategy: z
      .enum(['per-file-top-level', 'preserve', 'flatten', 'none'])
      .default('per-file-top-level'),
    insertBlankBetween: z.boolean().default(false),
  }),
  split: z.object({
    ranges: z.array(z.string()).optional(),
    pagesPerFile: z.number().int().positive().optional(),
    maxBytes: z.number().int().positive().optional(),
    bookmarkLevel: z.number().int().min(0).optional(),
  }),
  'extract-pages': z.object({ pages: pageSelector, separateFiles: z.boolean().default(false) }),
  'remove-pages': z.object({ pages: pageSelector }),
  'insert-pages': z.object({
    index: z.number().int().min(0).default(0),
    blankPages: z.number().int().min(0).default(0),
  }),
  organize: z.object({ order: z.array(z.number().int().positive()).min(1) }),
  rotate: z.object({
    degrees: z.union([z.literal(90), z.literal(180), z.literal(270), z.literal(-90)]).default(90),
    pages: pageSelector.optional(),
  }),
  'n-up': z.object({
    columns: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(9)]).default(2),
    margin: z.number().min(0).default(18),
    booklet: z.boolean().default(false),
  }),
  halve: z.object({
    direction: z.enum(['horizontal', 'vertical']).default('horizontal'),
    threshold: z.number().positive().default(1.25),
  }),
  crop: z.object({
    left: z.number().min(0).default(0),
    top: z.number().min(0).default(0),
    right: z.number().min(0).default(0),
    bottom: z.number().min(0).default(0),
    pages: pageSelector.optional(),
  }),
  resize: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    mode: z.enum(['scale-to-fit', 'crop-to-fit']).default('scale-to-fit'),
  }),
  bookmarks: z.object({
    entries: z.array(
      z.object({
        title: z.string().min(1),
        page: z.number().int().positive(),
        level: z.number().int().min(0).default(0),
      }),
    ),
  }),
  bates: z.object({
    prefix: z.string().default(''),
    suffix: z.string().default(''),
    start: z.number().int().min(0).default(1),
    padding: z.number().int().min(1).max(12).default(6),
    position: z
      .enum(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'])
      .default('bottom-right'),
  }),
  compress: z.object({
    preset: z.enum(['extreme', 'balanced', 'high-quality', 'custom']).default('balanced'),
    imageQuality: z.number().int().min(1).max(100).default(75),
    imageDpiCap: z.union([z.literal('off'), z.number().int().min(72).max(600)]).default('off'),
    subsetFonts: z.boolean().default(true),
    removeUnusedObjects: z.boolean().default(true),
    stripMetadata: z.boolean().default(false),
    linearize: z.boolean().default(false),
  }),
  'optimize-web': z.object({
    progressive: z.boolean().default(true),
    imageQuality: z.number().int().min(1).max(100).default(80),
    imageDpiCap: z.union([z.literal('off'), z.number().int().min(72).max(600)]).default('off'),
    subsetFonts: z.boolean().default(true),
  }),
  repair: z.object({ recoverPages: z.boolean().default(true) }),
  rasterize: z.object({ dpi: z.number().int().min(72).max(600).default(150) }),
  flatten: z.object({ forms: z.boolean().default(true), annotations: z.boolean().default(true) }),
  pdfa: z.object({
    conformanceLevel: z.enum(['1b', '2b', '3b']).default('2b'),
    profile: z.enum(['1b', '2b', '3b']).optional(),
    colorProfile: z.enum(['embed-srgb', 'preserve-existing']).default('embed-srgb'),
    fallbackOnFailure: z.enum(['report-only', 'best-effort-fix']).default('report-only'),
  }),
  metadata: z.object({
    title: z.string().optional(),
    author: z.string().optional(),
    subject: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    strip: z.boolean().default(false),
  }),
  'inspect-structure': z.object({}),
  render: z.object({
    page: z.number().int().positive().default(1),
    scale: z.number().positive().default(1),
  }),
  inspect: z.object({}),
} satisfies Record<OpId, z.ZodTypeAny>;

const stepSchema = z.object({
  op: z.enum(Object.keys(operationSchemas) as [OpId, ...OpId[]]),
  options: z.record(z.string(), z.unknown()),
});
export const recipeSchema = z.object({ version: z.literal('r1'), steps: z.array(stepSchema) });

export function validateStep(step: Step): Step {
  const parsed = stepSchema.parse(step);
  const options = operationSchemas[parsed.op].parse(parsed.options) as StepOptions;
  return { op: parsed.op, options };
}

export function parseRecipe(input: unknown): Recipe {
  assertNoCredentials(input);
  const parsed = recipeSchema.parse(input);
  return { version: 'r1', steps: parsed.steps.map((step) => validateStep(step as Step)) };
}

function assertNoCredentials(value: unknown, path = 'recipe'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentials(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/api[_-]?key|secret|token|password|authorization|credential/iu.test(key))
      throw new PdfEngineError({
        kind: 'invalid-operation',
        operation: 'recipe-credential',
        remedy:
          'Provider credentials cannot be stored in recipes. Save a provider connection in IndexedDB instead.',
      });
    assertNoCredentials(item, `${path}.${key}`);
  }
}

// Keep a safety margin below typical tab limits so a 2,000-page synthetic input is refused
// with a remedy rather than relying on the browser to terminate the worker for OOM.
const MAX_MEMORY_BYTES = 384 * 1024 * 1024;

export function compile(recipe: Recipe, inputMeta: DocMeta): Plan {
  const parsed = parseRecipe(recipe);
  const projectedPeakBytes = Math.max(inputMeta.byteLength * 2, inputMeta.pageCount * 262_144);
  if (projectedPeakBytes > MAX_MEMORY_BYTES) {
    throw new PdfEngineError({
      kind: 'memory-limit-exceeded',
      projectedBytes: projectedPeakBytes,
      maxBytes: MAX_MEMORY_BYTES,
      remedy: `This document projects to ${Math.ceil(projectedPeakBytes / 1024 / 1024)} MiB. Split it into batches of at most ${Math.floor(MAX_MEMORY_BYTES / 262_144).toLocaleString()} pages and retry.`,
    });
  }
  const degraded: ('reduced-concurrency' | 'streamed-pages')[] = [];
  if (projectedPeakBytes > 128 * 1024 * 1024) degraded.push('reduced-concurrency');
  if (inputMeta.pageCount > 250) degraded.push('streamed-pages');
  return {
    recipe: parsed,
    estimatedPeakBytes: projectedPeakBytes,
    requiresNetwork: false,
    operationCount: parsed.steps.length,
    memory: {
      projectedPeakBytes,
      maxBytes: MAX_MEMORY_BYTES,
      concurrency: degraded.length ? 1 : 2,
      degraded,
    },
  };
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64url(value: string): Uint8Array {
  const binary = atob(
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Encode only recipe parameters. Input documents are deliberately never included. */
export async function serializeRecipe(recipe: Recipe): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(parseRecipe(recipe)));
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  await writer.write(json as Uint8Array<ArrayBuffer>);
  await writer.close();
  return `r1.${base64url(new Uint8Array(await new Response(stream.readable).arrayBuffer()))}`;
}

export async function parseSerializedRecipe(value: string): Promise<Recipe> {
  if (!value.startsWith('r1.'))
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'recipe',
      remedy: 'Use a recipe link generated by this version of the application.',
    });
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  await writer.write(fromBase64url(value.slice(3)) as Uint8Array<ArrayBuffer>);
  await writer.close();
  const json = await new Response(stream.readable).arrayBuffer();
  return parseRecipe(JSON.parse(new TextDecoder().decode(json)));
}
