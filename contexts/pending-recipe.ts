import type { Recipe } from '@/constants/recipes';

/**
 * Hands an extracted-but-not-yet-saved recipe from the Paste Link screen
 * to the Preview screen, and from there on to the Select Cookbook screen
 * if the user needs to pick a cookbook. A plain module-level value rather
 * than React Context: nothing needs to subscribe to changes, only read the
 * current one on mount, and it's naturally scoped to a single in-progress
 * Add Recipe flow (not a queue — pasting a new URL simply replaces it).
 *
 * Deliberately a "peek", not a one-time "take": both Preview and Select
 * Cookbook may need to read the same pending recipe. Call
 * `clearPendingExtractedRecipe()` once the recipe is actually saved.
 *
 * Preview lets the user edit the extracted recipe before saving (see
 * app/add/preview.tsx) — when that editing flow needs to hand off to
 * Select Cookbook, it calls `setPendingExtractedRecipe()` again with the
 * edited draft, so this always holds what should actually be saved, not
 * necessarily the original, unedited extraction result.
 */
let pendingRecipe: Recipe | null = null;

export function setPendingExtractedRecipe(recipe: Recipe) {
  pendingRecipe = recipe;
}

export function getPendingExtractedRecipe(): Recipe | null {
  return pendingRecipe;
}

export function clearPendingExtractedRecipe() {
  pendingRecipe = null;
}
