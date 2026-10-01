/**
 * P7-10 — the browser half of the recipe byte-parity check.
 *
 * This exists as a normal module rather than inside the Playwright spec because a
 * `page.evaluate` body is not processed by Vite: a bare specifier cannot resolve inside it, and
 * importing the engine by absolute path makes its `new URL('./inspect.worker.js', import.meta.url)`
 * resolve against that path rather than the app's own, so the worker fails to load. Routing
 * through the app's module graph sidesteps both — Vite rewrites the worker URL correctly, and the
 * pdf.js worker is configured by `PdfViewer` the same way it is for a user.
 *
 * It is dev-only by construction. Nothing imports it from a route, so no production bundle
 * includes it; `tests/e2e/parity.spec.ts` loads it through the dev server.
 */
import { compile, inspectWithPdfJs, parseRecipe, run } from '@pdf-complianttools/engine';
import type { Recipe } from '@pdf-complianttools/engine';

/**
 * Runs `recipe` over `input` and returns the result bytes.
 *
 * Throws with a real message rather than an opaque rejection: a bare `new Error()` here reached
 * the spec as `page.evaluate: Error`, which says nothing about which of the several possible
 * failures actually happened.
 */
export async function runRecipeForParity(recipe: unknown, input: number[]): Promise<number[]> {
  const bytes = new Uint8Array(input);
  const parsed = parseRecipe(recipe as Recipe);
  let meta;
  try {
    meta = await inspectWithPdfJs(bytes);
  } catch (error) {
    // `cause` keeps the underlying failure rather than flattening it into a string, so the
    // original stack survives if this ever surfaces in a real UI.
    throw new Error('The inspector failed before the recipe could start.', { cause: error });
  }
  const plan = compile(parsed, meta);
  let output: Uint8Array | undefined;
  for await (const event of run(plan, [bytes])) if (event.kind === 'result') output = event.bytes;
  if (!output) throw new Error('The recipe produced no result.');
  // A plain number array rather than base64: a base64 hop decodes in the page and re-encodes
  // outside it, so a transport bug would be misattributed to the engine.
  return Array.from(output);
}
