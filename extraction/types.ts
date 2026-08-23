/**
 * Shared types for the recipe extraction pipeline.
 *
 * Deliberately framework-agnostic — no Expo/React Native imports anywhere
 * under extraction/, so this can run both inside the `+api.ts` server
 * route (see app/api/extract-recipe+api.ts) and directly under Node for
 * testing against live URLs (see extraction/test-corpus.ts).
 *
 * Pipeline shape (see extract-recipe.ts for the orchestrator):
 *   URL -> fetch HTML -> [ExtractionStrategy, ...] -> normalize -> validate -> Recipe
 */

import type { ExtractionMethod, ExtractionWarning, Recipe } from '@/constants/recipes';

export type FetchedPage = {
  url: URL;
  html: string;
};

/**
 * What a strategy finds on a page, before normalization. Loosely
 * schema.org-shaped today because JSON-LD is the only strategy that
 * exists — a future non-schema.org strategy (Microdata, a site-specific
 * patch, AI) would either shape its output to match this same node, or
 * the orchestrator would branch by `strategy.name`. Not generalized further
 * than that until a second strategy actually needs it.
 */
export type RawExtraction = {
  node: Record<string, unknown>;
};

/**
 * A specific way of finding recipe-ish data on a fetched page. Strategies
 * are tried in order (see strategies.ts) until one succeeds — this
 * interface is the whole replaceability boundary: nothing downstream of it
 * (the normalizer, the validator, the canonical Recipe type, the app's
 * Preview screen) needs to know which strategy produced a result.
 */
export interface ExtractionStrategy {
  /** Also recorded on the saved Recipe as `extraction.method` — see constants/recipes.ts. */
  readonly name: ExtractionMethod;
  /** Cheap pre-check — should this strategy even attempt this page? */
  canAttempt(page: FetchedPage): boolean;
  /**
   * Returns a raw extraction, or `null` if this strategy found nothing
   * usable on this page. Only throw for a genuine internal error — "not
   * found" is a normal, expected `null`, not an exception.
   */
  extract(page: FetchedPage): RawExtraction | null;
}

export type ExtractionErrorCode =
  | 'invalid-url'
  | 'fetch-failed'
  | 'no-structured-data'
  | 'incomplete-recipe';

export type ExtractionError = {
  code: ExtractionErrorCode;
  message: string;
};

export type ExtractionResult = { ok: true; recipe: Recipe } | { ok: false; error: ExtractionError };

/** The normalized recipe fields, before an id or extraction metadata is attached. */
export type NormalizedRecipeFields = Omit<Recipe, 'id' | 'extraction'>;

export type NormalizeResult = {
  fields: NormalizedRecipeFields;
  warnings: ExtractionWarning[];
};
