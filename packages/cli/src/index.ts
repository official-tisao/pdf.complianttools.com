#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  compile,
  createBlankPdf,
  inspectWithPdfJs,
  parseRecipe,
  run,
} from '@pdf-complianttools/engine';

export async function runRecipeFile(
  recipePath: string,
  inputPath?: string,
  outputPath?: string,
): Promise<readonly string[]> {
  const recipe = parseRecipe(JSON.parse(await readFile(recipePath, 'utf8')));
  const input = inputPath ? new Uint8Array(await readFile(inputPath)) : createBlankPdf();
  const meta = await inspectWithPdfJs(input);
  const plan = compile(recipe, meta);
  let primary: Uint8Array | undefined;
  let outputs: readonly Uint8Array[] | undefined;
  for await (const event of run(plan, [input], {
    onProgress: (progress) =>
      console.error(`${progress.completed}/${progress.total} ${progress.message}`),
  })) {
    if (event.kind === 'result') {
      primary = event.bytes;
      outputs = event.outputs;
    }
  }
  if (!primary) throw new Error('The recipe completed without a PDF result.');
  const target = resolve(
    outputPath ??
      join(dirname(inputPath ?? recipePath), `${basename(recipePath, extname(recipePath))}.pdf`),
  );
  const files = outputs && outputs.length > 1 ? outputs : [primary];
  const written: string[] = [];
  for (const [index, bytes] of files.entries()) {
    const path = files.length === 1 ? target : target.replace(/\.pdf$/iu, `-${index + 1}.pdf`);
    await writeFile(path, bytes);
    written.push(path);
  }
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [recipePath, inputPath, outputPath] = process.argv.slice(2);
  if (!recipePath || recipePath === '--help' || recipePath === '-h') {
    console.log('pdf-tools <recipe.json> [input.pdf] [output.pdf]');
  } else {
    try {
      for (const path of await runRecipeFile(recipePath, inputPath, outputPath)) console.log(path);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'The recipe failed.');
      process.exitCode = 1;
    }
  }
}
