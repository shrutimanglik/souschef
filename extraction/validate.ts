import type { ExtractionError, NormalizedRecipeFields } from './types';

/**
 * Checks a normalized recipe for minimum viability. Ingredients and
 * instructions are hard requirements — a "recipe" with neither isn't
 * useful to save. A missing title is not: it already gets a sensible
 * default ("Untitled recipe") upstream in the normalizer, and a recipe
 * with real ingredients/instructions but a missing name is still worth
 * keeping.
 *
 * Returns `null` when the recipe passes, or a typed `ExtractionError`
 * naming exactly what's missing otherwise.
 */
export function validateRecipe(fields: NormalizedRecipeFields): ExtractionError | null {
  const missing: string[] = [];
  if (fields.ingredients.length === 0) {
    missing.push('ingredients');
  }
  if (fields.instructions.length === 0) {
    missing.push('instructions');
  }
  if (missing.length === 0) {
    return null;
  }
  return {
    code: 'incomplete-recipe',
    message: `Found a recipe on that page, but it's missing ${formatList(missing)}.`,
  };
}

function formatList(items: string[]): string {
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
