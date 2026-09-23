import { z } from 'zod';
import type { DocMeta, Plan, Recipe } from './types.js';

const stepSchema = z.object({
  op: z.string().min(1),
  options: z.record(z.string(), z.unknown()),
});

export const recipeSchema = z.object({
  version: z.literal('r1'),
  steps: z.array(stepSchema),
});

export function parseRecipe(input: unknown): Recipe {
  return recipeSchema.parse(input) as Recipe;
}

export function compile(recipe: Recipe, inputMeta: DocMeta): Plan {
  const parsed = parseRecipe(recipe);
  const estimatedPeakBytes = Math.max(inputMeta.byteLength * 2, inputMeta.pageCount * 262_144);
  return {
    recipe: parsed,
    estimatedPeakBytes,
    requiresNetwork: false,
  };
}
