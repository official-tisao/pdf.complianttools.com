import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { compile, inspectWithPdfJs, parseRecipe, run } from '@pdf-complianttools/engine';
import { runRecipeFile } from '../dist/index.js';

test('CLI and browser library share byte-equivalent recipe output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pdf-tools-'));
  try {
    const inputPath = join(directory, 'input.pdf');
    const recipePath = join(directory, 'recipe.json');
    const outputPath = join(directory, 'cli-output.pdf');
    await writeFile(
      inputPath,
      await readFile(new URL('../../../fixtures/pdfs/one-page.pdf', import.meta.url)),
    );
    await writeFile(
      recipePath,
      JSON.stringify({ version: 'r1', steps: [{ op: 'bates', options: { prefix: 'CLI-' } }] }),
    );
    const directInput = new Uint8Array(await readFile(inputPath));
    assert.equal((await PDFDocument.load(directInput)).getPageCount(), 1);
    await runRecipeFile(recipePath, inputPath, outputPath);
    const input = new Uint8Array(await readFile(inputPath));
    const recipe = parseRecipe(JSON.parse(await readFile(recipePath, 'utf8')));
    const plan = compile(recipe, await inspectWithPdfJs(input));
    let expected;
    for await (const event of run(plan, [input]))
      if (event.kind === 'result') expected = event.bytes;
    assert.deepEqual(new Uint8Array(await readFile(outputPath)), expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
