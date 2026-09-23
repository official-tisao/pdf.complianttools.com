#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseRecipe } from '@pdf-complianttools/engine';

const recipePath = process.argv[2];
if (recipePath) {
  const recipe = parseRecipe(JSON.parse(await readFile(recipePath, 'utf8')));
  console.log(JSON.stringify(recipe, null, 2));
} else {
  console.log('pdf-tools <recipe.json>');
}
