import { findJsonLdRecipe } from './json-ld';
import type { ExtractionStrategy, FetchedPage, RawExtraction } from './types';

/**
 * V1's only strategy: read Schema.org Recipe JSON-LD. Highest-reliability
 * source available (see the Pass 1 research doc) and, per this app's
 * scope, the only one implemented — no site allowlist, no per-site
 * scrapers. A future strategy (Microdata, a one-off site patch, AI) is
 * added to `STRATEGIES` below, not by changing anything here.
 */
export const jsonLdStrategy: ExtractionStrategy = {
  name: 'json-ld',
  canAttempt: () => true,
  extract(page: FetchedPage): RawExtraction | null {
    const node = findJsonLdRecipe(page.html);
    return node ? { node } : null;
  },
};

/** Tried in order by `runStrategies` (see extract-recipe.ts) until one succeeds. */
export const STRATEGIES: ExtractionStrategy[] = [jsonLdStrategy];
