import type { ExtractionMethod, Recipe } from '@/constants/recipes';

import { fetchHtml } from './fetch-html';
import { normalizeSchemaOrgRecipe } from './normalize';
import { STRATEGIES } from './strategies';
import type { ExtractionResult, FetchedPage, RawExtraction } from './types';
import { validateRecipe } from './validate';

function runStrategies(page: FetchedPage): { strategyName: ExtractionMethod; raw: RawExtraction } | null {
  for (const strategy of STRATEGIES) {
    if (!strategy.canAttempt(page)) {
      continue;
    }
    try {
      const raw = strategy.extract(page);
      if (raw) {
        return { strategyName: strategy.name, raw };
      }
    } catch {
      // This strategy failed unexpectedly on this page — fall through to
      // the next one rather than failing the whole extraction.
    }
  }
  return null;
}

function createPendingRecipeId(): string {
  // Always replaced by a real canonical id when the recipe is actually
  // saved to a cookbook (see contexts/cookbook-library.tsx) — this is a
  // placeholder for the extraction result on its way to the Preview screen.
  return 'pending-recipe';
}

/**
 * The extraction pipeline's single entry point: URL in, a validated
 * canonical `Recipe` or a typed `ExtractionError` out. See
 * extraction/types.ts for the shape of each stage this wires together.
 */
export async function extractRecipeFromUrl(input: string): Promise<ExtractionResult> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, error: { code: 'invalid-url', message: "That doesn't look like a valid URL." } };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: { code: 'invalid-url', message: 'Only http(s) URLs are supported.' } };
  }

  const fetched = await fetchHtml(url);
  if (!fetched.ok) {
    return { ok: false, error: fetched.error };
  }

  const page: FetchedPage = { url, html: fetched.html };
  const strategyResult = runStrategies(page);
  if (!strategyResult) {
    return {
      ok: false,
      error: { code: 'no-structured-data', message: "We couldn't find structured recipe data on that page." },
    };
  }

  const { fields, warnings } = normalizeSchemaOrgRecipe(strategyResult.raw.node, url);

  const validationError = validateRecipe(fields);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const recipe: Recipe = {
    id: createPendingRecipeId(),
    ...fields,
    extraction: {
      method: strategyResult.strategyName,
      fetchedAt: new Date().toISOString(),
      warnings,
    },
  };

  return { ok: true, recipe };
}
