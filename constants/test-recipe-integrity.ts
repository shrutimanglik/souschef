/**
 * Data-integrity invariants for the canonical Recipe — the rules that stop
 * real recipe facts being silently lost as a Recipe crosses a boundary.
 * Two boundaries are covered, because both had a demonstrated bug:
 *
 *   1. Persistence (normalizeRecipe): a component grouping loaded from
 *      storage must still be a TOTAL cover of the recipe's ingredients and
 *      instructions, or be discarded. The grouped UI renders items only
 *      through their components, so a partial cover makes real, present
 *      data invisible.
 *   2. The Instagram agent's report step (finalizeFromReport): a recipe
 *      that one of the two extractors already produced successfully must
 *      never be dropped just because report_result's selectedSourceUrl
 *      doesn't line up with the key it was stored under.
 *
 * Neither of these needs a network call or an API key — both are pure
 * functions over data. Not a unit test suite (this project has no test
 * runner; see extraction/test-corpus.ts for that tradeoff) — a pass/fail
 * report.
 *
 * Run with: npm run test:integrity
 */

import type Anthropic from '@anthropic-ai/sdk';

import { finalizeFromReport } from '@/agent/instagram-recipe-agent';
import type { ExtractionResult } from '@/extraction';

import { normalizeRecipe, normalizeSourceUrl, resolveComponentIngredients, type Recipe } from './recipes';

let failures = 0;
function check(pass: boolean, label: string, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? `\n       ${detail}` : ''}`);
  if (!pass) {
    failures += 1;
  }
}

const storedRecipe = {
  id: 'r1',
  title: 'Test Recipe',
  source: 'Test',
  sourceUrl: 'https://example.com/x',
  servings: 2,
  servingsLabel: 'servings',
  prepTime: 1,
  cookTime: 1,
  totalTime: 2,
  ingredients: [
    { id: 'a', quantity: 1, unit: 'cup', name: 'flour' },
    { id: 'b', quantity: 1, unit: 'cup', name: 'sugar' },
    { id: 'c', quantity: 1, unit: 'tsp', name: 'salt' },
  ],
  instructions: ['Mix.', 'Bake.'],
};

// ---- 1. Component coverage at the persistence boundary ----------------

function runComponentCoverageChecks() {
  console.log('\nComponent coverage on load (normalizeRecipe)\n');

  // The reported failure shape: one component is malformed, so
  // normalizeComponent drops it and the survivors no longer cover the
  // recipe. Before the fix this silently hid 2 of 3 ingredients.
  const partial = normalizeRecipe('r1', {
    ...storedRecipe,
    components: [
      { name: 'Base', ingredientIds: ['a'], instructionIndexes: [0] },
      { name: 'Broken', ingredientIds: 'not-an-array', instructionIndexes: [1] },
    ],
  });
  check(partial.components === undefined, 'a non-covering grouping is discarded rather than partially trusted');
  check(
    partial.ingredients.length === 3,
    'all ingredients survive the discard (they fall back to the flat list, which always renders everything)'
  );

  const healthy = normalizeRecipe('r1', {
    ...storedRecipe,
    components: [
      { name: 'Base', ingredientIds: ['a', 'b'], instructionIndexes: [0] },
      { name: 'Finish', ingredientIds: ['c'], instructionIndexes: [1] },
    ],
  });
  check(healthy.components?.length === 2, 'a complete, valid grouping is preserved unchanged');
  const rendered = (healthy.components ?? []).flatMap((component) => resolveComponentIngredients(healthy, component));
  check(rendered.length === 3, 'a preserved grouping still renders every ingredient exactly once');

  const dangling = normalizeRecipe('r1', {
    ...storedRecipe,
    components: [{ name: 'Base', ingredientIds: ['a', 'b', 'MISSING'], instructionIndexes: [0, 1] }],
  });
  check(dangling.components === undefined, 'an ingredient id that no longer exists fails closed');

  const duplicated = normalizeRecipe('r1', {
    ...storedRecipe,
    components: [
      { name: 'One', ingredientIds: ['a', 'b'], instructionIndexes: [0] },
      { name: 'Two', ingredientIds: ['b', 'c'], instructionIndexes: [1] },
    ],
  });
  check(duplicated.components === undefined, 'an ingredient claimed by two components fails closed');

  const outOfRange = normalizeRecipe('r1', {
    ...storedRecipe,
    components: [{ name: 'All', ingredientIds: ['a', 'b', 'c'], instructionIndexes: [0, 1, 9] }],
  });
  check(outOfRange.components === undefined, 'an out-of-range instruction index fails closed');

  const none = normalizeRecipe('r1', storedRecipe);
  check(none.components === undefined && none.ingredients.length === 3, 'a componentless recipe is unaffected');
}

// ---- 2. Save -> storage -> reload lifecycle ---------------------------

/** Mirrors addRecipeToCookbook's canonical-id resolution + upsert (contexts/cookbook-library.tsx). */
function upsertRecipe(recipesById: Record<string, Recipe>, input: Recipe): Record<string, Recipe> {
  const normalizedUrl = normalizeSourceUrl(input.sourceUrl);
  const existing = Object.values(recipesById).find((r) => normalizeSourceUrl(r.sourceUrl) === normalizedUrl);
  const canonicalId = existing?.id ?? `recipe-${Object.keys(recipesById).length + 1}`;
  return { ...recipesById, [canonicalId]: { ...input, id: canonicalId } };
}

/** Mirrors CookbookLibraryProvider's AsyncStorage round trip. */
function roundTrip(recipesById: Record<string, Recipe>): Record<string, Recipe> {
  const parsed = JSON.parse(JSON.stringify({ recipesById })) as { recipesById: Record<string, unknown> };
  const out: Record<string, Recipe> = {};
  for (const [id, raw] of Object.entries(parsed.recipesById)) {
    out[id] = normalizeRecipe(id, raw);
  }
  return out;
}

function runLifecycleChecks() {
  console.log('\nExtraction -> save -> storage -> reload\n');

  const draft: Recipe = normalizeRecipe('pending-recipe', {
    ...storedRecipe,
    components: [
      { name: 'Base', ingredientIds: ['a', 'b'], instructionIndexes: [0] },
      { name: 'Finish', ingredientIds: ['c'], instructionIndexes: [1] },
    ],
  });

  let store = upsertRecipe({}, draft);
  let reloaded = roundTrip(store);
  const canonicalId = Object.keys(reloaded)[0];
  check(
    JSON.stringify(reloaded[canonicalId].components) === JSON.stringify(draft.components),
    'components survive save -> AsyncStorage round trip -> reload'
  );

  // Re-saving the same sourceUrl must refresh the canonical copy (the
  // upsert behavior), not silently keep the older one.
  const resaved: Recipe = {
    ...draft,
    components: [
      { name: 'Dough', ingredientIds: ['a', 'b'], instructionIndexes: [0] },
      { name: 'Topping', ingredientIds: ['c'], instructionIndexes: [1] },
    ],
  };
  store = upsertRecipe(store, resaved);
  check(Object.keys(store).length === 1, 're-saving the same sourceUrl creates no duplicate canonical recipe');
  reloaded = roundTrip(store);
  check(
    reloaded[canonicalId].components?.[0].name === 'Dough',
    're-saving refreshes the stored recipe rather than keeping a stale copy'
  );
}

// ---- 3. The agent must never discard a successful extraction ----------

function reportBlock(input: Record<string, unknown>): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id: 'toolu_test', name: 'report_result', input } as Anthropic.ToolUseBlock;
}

const successfulExtraction: ExtractionResult = {
  ok: true,
  recipe: normalizeRecipe('extracted', { ...storedRecipe, title: 'Extracted From Caption' }),
};

function runAgentFinalizeChecks() {
  console.log('\nInstagram agent: a successful extraction is never dropped (finalizeFromReport)\n');

  const reelUrl = 'https://www.instagram.com/reel/ABC123/';

  // Normal path: the agent reports the same URL the extraction was keyed
  // under. Must still resolve exactly as before.
  const matched = finalizeFromReport(
    3,
    reportBlock({ selectedSourceUrl: reelUrl, confidence: 'high', discovery: 'caption had the recipe', warnings: [] }),
    new Map([[reelUrl, successfulExtraction]]),
    successfulExtraction,
    []
  );
  check(
    matched.ok && matched.extraction?.ok === true && matched.warnings.length === 0,
    'an exact URL match resolves normally, with no added warning'
  );

  // Failure 1: extract_recipe_from_text was called without the optional
  // sourceUrl, so nothing was ever keyed.
  const unkeyed = finalizeFromReport(
    3,
    reportBlock({ selectedSourceUrl: reelUrl, confidence: 'medium', discovery: 'from caption', warnings: [] }),
    new Map(),
    successfulExtraction,
    []
  );
  check(
    unkeyed.ok && unkeyed.extraction?.ok === true,
    'an extraction never keyed by sourceUrl is still returned, not discarded'
  );

  // Failure 2: the most likely production path — a caption-only recipe, so
  // the agent correctly reports no *webpage* source while still holding a
  // successfully extracted Recipe.
  const noSourceUrl = finalizeFromReport(
    3,
    reportBlock({ selectedSourceUrl: '', confidence: 'medium', discovery: 'no webpage found; used the caption', warnings: [] }),
    new Map(),
    successfulExtraction,
    []
  );
  check(
    noSourceUrl.ok && noSourceUrl.extraction?.ok === true,
    'a caption-only recipe reported with an empty selectedSourceUrl is still returned'
  );

  // Failure 3: reported URL differs from the extracted one (redirect or
  // trailing slash).
  const mismatched = finalizeFromReport(
    3,
    reportBlock({ selectedSourceUrl: 'https://blog.example.com/recipe/', confidence: 'high', discovery: 'found blog', warnings: [] }),
    new Map([['https://blog.example.com/recipe', successfulExtraction]]),
    successfulExtraction,
    []
  );
  check(mismatched.ok && mismatched.extraction?.ok === true, 'a trailing-slash/redirect URL mismatch still returns the recipe');
  check(
    mismatched.ok && mismatched.warnings.some((w) => w.includes('did not exactly match')),
    'the URL mismatch is surfaced as a warning rather than hidden'
  );

  // Genuinely nothing extracted — must stay null, never invent a result.
  const nothing = finalizeFromReport(
    3,
    reportBlock({ selectedSourceUrl: '', confidence: 'low', discovery: 'no recipe found anywhere', warnings: [] }),
    new Map(),
    null,
    []
  );
  check(nothing.ok && nothing.extraction === null, 'when nothing was extracted, no recipe is invented');
}

runComponentCoverageChecks();
runLifecycleChecks();
runAgentFinalizeChecks();

console.log(`\n${failures === 0 ? 'All integrity checks passed.' : `${failures} check(s) FAILED.`}`);
if (failures > 0) {
  process.exitCode = 1;
}
