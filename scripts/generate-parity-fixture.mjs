/**
 * Regenerates `fixtures/parity/cli-output.sha256` by running the shipped CLI over the recorded
 * recipe. `tests/e2e/parity.spec.ts` compares that hash against a run of the same recipe inside a
 * real browser page, which is the only comparison that can see a Node-versus-browser divergence —
 * `packages/cli/test/parity.test.mjs` runs both halves in Node and cannot.
 *
 * Run this only when the engine's output is *intended* to change. Re-running it to make a failing
 * parity test pass would record the browser's bytes as correct and destroy the check, so the
 * script prints the old and new hashes and the recipe it used, and refuses to write if the
 * reference is missing rather than creating one silently.
 *
 * Usage: node scripts/generate-parity-fixture.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(root, 'fixtures', 'parity');
const RECIPE = join(FIXTURE_DIR, 'recipe.json');
const REFERENCE = join(FIXTURE_DIR, 'cli-output.sha256');
const INPUT = join(root, 'fixtures', 'pdfs', 'one-page.pdf');
const CLI = join(root, 'packages', 'cli', 'dist', 'index.js');

const recipe = JSON.parse(readFileSync(RECIPE, 'utf8'));
if (!Array.isArray(recipe.steps) || recipe.steps.length === 0)
  throw new Error(`${RECIPE} must contain at least one step.`);

const work = mkdtempSync(join(tmpdir(), 'parity-fixture-'));
try {
  const output = join(work, 'out.pdf');
  execFileSync(process.execPath, [CLI, RECIPE, INPUT, output], { stdio: 'inherit' });
  const bytes = readFileSync(output);
  const hash = createHash('sha256').update(bytes).digest('hex');

  let previous = '(none — this is the first reference)';
  try {
    previous = readFileSync(REFERENCE, 'utf8').trim();
  } catch {
    // No reference yet. Writing one is correct on the first run, so this is not fatal — but it is
    // reported, because it means the browser has never been compared against anything.
  }

  console.log(`recipe:  ${RECIPE}`);
  console.log(`steps:   ${recipe.steps.map((step) => step.op).join(' -> ')}`);
  console.log(`bytes:   ${bytes.byteLength}`);
  console.log(`before:  ${previous}`);
  console.log(`after:   ${hash}`);
  if (previous !== hash && previous !== '(none — this is the first reference)') {
    console.log('\nThe engine output CHANGED. Confirm this is intended before committing.');
  }
  writeFileSync(REFERENCE, `${hash}\n`);
  console.log(`\nwrote ${REFERENCE}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
