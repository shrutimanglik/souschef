/**
 * Mock cookbook library data for the first visual milestone.
 *
 * This shape is intentionally close to what a future API/database record
 * would look like, so swapping this file for a real data source later
 * shouldn't require reshaping the UI.
 */

/**
 * Every cookbook cover currently shares the same simple, centered
 * composition and font treatment — only the "paper" colors vary. A future
 * cover theme system (once the editorial typeface is chosen) will introduce
 * intentional typographic variation between cookbooks; that shouldn't be
 * faked here in the meantime.
 */
export type CookbookCoverTheme = {
  /** Cover background ("paper" or "cloth") color. */
  background: string;
  /** Primary ink color for the title on this cover. */
  foreground: string;
  /** Secondary ink color for the small-caps recipe count. */
  accent: string;
};

export type Cookbook = {
  id: string;
  title: string;
  /**
   * References into the canonical recipe store (see constants/recipes.ts /
   * contexts/cookbook-library.tsx) — never the Recipe objects themselves.
   * A cookbook holds recipe IDs, not copies, so a recipe keeps one
   * canonical identity even when it belongs to more than one collection.
   * The cover's displayed recipe count is always derived from this array's
   * length (see `getRecipeCount`), never stored as a separate number.
   */
  recipeIds: string[];
  cover: CookbookCoverTheme;
  /**
   * True only for the system-generated "All Recipes" collection. It isn't
   * a cookbook the user created or can save into directly — it's every
   * recipe the user has saved, derived automatically. See
   * `ALL_RECIPES_COOKBOOK_ID` / `createAllRecipesCookbook`.
   */
  isSystem?: boolean;
};

/** The number of recipes to display for a cookbook, derived from its actual recipe references. */
export function getRecipeCount(cookbook: Cookbook): number {
  return cookbook.recipeIds.length;
}

/**
 * Guards a cookbook loaded from storage against a missing/malformed
 * `recipeIds` (e.g. from a version of the schema that predates it) so
 * opening an older persisted cookbook can't crash on a missing array.
 * Everything else about the cookbook is trusted as-is.
 */
export function normalizeCookbook(raw: Cookbook): Cookbook {
  return {
    ...raw,
    recipeIds: Array.isArray(raw.recipeIds)
      ? raw.recipeIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

export const MOCK_COOKBOOKS: Cookbook[] = [
  {
    id: 'everyday-cooking',
    title: 'Everyday Cooking',
    recipeIds: [],
    cover: {
      background: '#B9744F',
      foreground: '#FBF3E7',
      accent: '#EAD3B8',
    },
  },
  {
    id: 'baking',
    title: 'Baking',
    recipeIds: [],
    cover: {
      background: '#EFE4D2',
      foreground: '#2A2521',
      accent: '#8C6E4F',
    },
  },
  {
    id: 'dinner-parties',
    title: 'Dinner Parties',
    recipeIds: [],
    cover: {
      background: '#333B33',
      foreground: '#F3ECDD',
      accent: '#B7A98C',
    },
  },
];

export const ALL_RECIPES_COOKBOOK_ID = 'all-recipes';

// A neutral, "library card" palette — built from the app's own muted
// tokens rather than a warm cloth color — so All Recipes reads as shared
// infrastructure sitting alongside the personal cookbooks, not one more of
// them.
const ALL_RECIPES_COVER: CookbookCoverTheme = {
  background: '#E4DED2',
  foreground: '#2A2521',
  accent: '#79695C',
};

/** Builds the system "All Recipes" pseudo-cookbook from every recipe ID that currently exists. */
export function createAllRecipesCookbook(recipeIds: string[]): Cookbook {
  return {
    id: ALL_RECIPES_COOKBOOK_ID,
    title: 'All Recipes',
    recipeIds,
    cover: ALL_RECIPES_COVER,
    isSystem: true,
  };
}
