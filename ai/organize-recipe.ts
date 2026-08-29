/**
 * The post-extraction organizing step, shared by both extraction routes
 * (app/api/extract-recipe+api.ts and app/api/extract-instagram-recipe+api.ts).
 *
 * Organizing is strictly best-effort structure layered on top of a recipe
 * that is ALREADY correct and complete. It must never be able to fail, or
 * degrade, an extraction that already succeeded — so every failure path
 * here (no API key configured, the organizer returning a warning, an
 * unexpected throw) resolves to the recipe exactly as extraction produced
 * it. That guarantee is the reason this lives in one place rather than
 * being reimplemented per route: it's an invariant, not boilerplate.
 *
 * The try/catch is deliberately redundant with RecipeOrganizer's own
 * contract of never throwing (see ai/types.ts) — belt and suspenders,
 * because the cost of a thrown error here is a failed import of a recipe
 * that was already successfully extracted.
 *
 * Takes the API key as a parameter rather than reading process.env itself,
 * for the same reason every other file under ai/ does: env access belongs
 * to the `+api.ts` routes, which are guaranteed to run server-side.
 */

import type { Recipe } from '@/constants/recipes';

import { createAnthropicClient } from './providers/anthropic';
import { AnthropicRecipeOrganizer } from './providers/anthropic-recipe-organizer';

export async function organizeRecipeIfPossible(recipe: Recipe, apiKey: string | undefined): Promise<Recipe> {
  if (!apiKey) {
    return recipe;
  }
  try {
    return await new AnthropicRecipeOrganizer(createAnthropicClient(apiKey)).organize(recipe);
  } catch {
    return recipe;
  }
}
