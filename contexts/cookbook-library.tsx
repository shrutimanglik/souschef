import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import {
  ALL_RECIPES_COOKBOOK_ID,
  createAllRecipesCookbook,
  MOCK_COOKBOOKS,
  normalizeCookbook,
  type Cookbook,
} from '@/constants/cookbooks';
import { normalizeRecipe, normalizeSourceUrl, type Recipe } from '@/constants/recipes';
import { Colors } from '@/constants/theme';

/**
 * Local cookbook + recipe state, shared across screens via context and
 * persisted to on-device storage (AsyncStorage) so it survives navigation
 * and app restarts. Still no backend/auth — this is local-first state, not
 * a synced one.
 *
 * Data is split into two parts, matching the product's data architecture:
 *  - `recipesById`: canonical Recipe objects. A recipe is written here
 *    exactly once (see the dedup note on `addRecipeToCookbook`) and never
 *    copied.
 *  - `cookbooks`: cookbook metadata plus `recipeIds` — references into
 *    `recipesById`, not duplicated recipe data.
 *
 * "All Recipes" is not stored at all: it's derived on every read as every
 * key in `recipesById`, so it can never drift out of sync with what's
 * actually been saved.
 */
type CookbookLibraryContextValue = {
  /** User-created cookbooks only (does not include the system "All Recipes" collection). */
  cookbooks: Cookbook[];
  /** The system "All Recipes" collection, derived from every saved recipe. */
  allRecipesCookbook: Cookbook;
  /** Looks up a cookbook by id, including the system "All Recipes" id. */
  getCookbook: (cookbookId: string) => Cookbook | undefined;
  getRecipe: (recipeId: string) => Recipe | undefined;
  getRecipesForCookbook: (cookbook: Cookbook) => Recipe[];
  /**
   * Saves a recipe into a cookbook. If a recipe with the same normalized
   * `sourceUrl` already exists, no new canonical Recipe is created — its
   * id is reused and its content is refreshed from `recipe` instead (see
   * `normalizeSourceUrl`), so every cookbook already referencing it sees
   * the update too.
   */
  addRecipeToCookbook: (cookbookId: string, recipe: Recipe) => void;
  /**
   * Removes a recipe *reference* from one cookbook only. This never
   * touches the canonical Recipe — it stays in `recipesById`, in All
   * Recipes, and in any other cookbook that references it.
   */
  removeRecipeFromCookbook: (cookbookId: string, recipeId: string) => void;
  /**
   * Deletes the canonical Recipe itself: removes it from `recipesById` and
   * strips its id from every cookbook's `recipeIds` (so it also disappears
   * from All Recipes, which is derived from `recipesById`). Distinct from
   * `removeRecipeFromCookbook`, which only ever touches one cookbook.
   */
  deleteRecipe: (recipeId: string) => void;
};

const CookbookLibraryContext = createContext<CookbookLibraryContextValue | null>(null);

const STORAGE_KEY = 'souschef.cookbook-library.v1';

type PersistedState = {
  cookbooks: Cookbook[];
  recipesById: Record<string, Recipe>;
};

function createRecipeId() {
  return `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CookbookLibraryProvider({ children }: { children: ReactNode }) {
  const [cookbooks, setCookbooks] = useState<Cookbook[]>(MOCK_COOKBOOKS);
  const [recipesById, setRecipesById] = useState<Record<string, Recipe>>({});
  const [isHydrated, setIsHydrated] = useState(false);

  // Load whatever was saved last time, once, before anything can write
  // over it.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) {
          return;
        }
        const parsed: Partial<PersistedState> = JSON.parse(raw);
        // Persisted data can predate fields added to the Recipe/Cookbook
        // shapes since it was saved — never assume it already matches the
        // current schema. Normalize on the way in so an older recipe (e.g.
        // one saved before sourceUrl/servings/time fields existed) opens
        // safely with sensible defaults instead of crashing or rendering
        // "undefined".
        if (parsed.cookbooks) {
          setCookbooks(parsed.cookbooks.map(normalizeCookbook));
        }
        if (parsed.recipesById) {
          const normalizedRecipes: Record<string, Recipe> = {};
          for (const [recipeId, rawRecipe] of Object.entries(parsed.recipesById)) {
            normalizedRecipes[recipeId] = normalizeRecipe(recipeId, rawRecipe);
          }
          setRecipesById(normalizedRecipes);
        }
      })
      .catch((error) => {
        console.warn('SousChef: failed to load saved cookbooks', error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on every change, once there's real (loaded) state to persist —
  // otherwise this would immediately overwrite saved data with the
  // starting mock cookbooks before the load above finishes.
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const payload: PersistedState = { cookbooks, recipesById };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch((error) => {
      console.warn('SousChef: failed to save cookbooks', error);
    });
  }, [cookbooks, recipesById, isHydrated]);

  const addRecipeToCookbook = useCallback(
    (cookbookId: string, recipeInput: Recipe) => {
      // A Recipe has one canonical identity: reuse an existing recipe with
      // the same normalized sourceUrl instead of ever creating a second
      // object (no "(2)" duplicates). This must be resolved before either
      // state update below, since both need the same final id.
      const normalizedInputUrl = normalizeSourceUrl(recipeInput.sourceUrl);
      const existing = Object.values(recipesById).find(
        (recipe) => normalizeSourceUrl(recipe.sourceUrl) === normalizedInputUrl
      );
      const canonicalId = existing?.id ?? createRecipeId();

      // Always write recipeInput — even when a canonical recipe already
      // exists for this sourceUrl. Save means "persist what's currently in
      // the draft" (Preview may have just re-extracted/re-organized it, or
      // the user edited a field), so an existing recipe's stale content —
      // including a since-computed `components` grouping — must not win
      // over a fresh save just because the URL was saved once before. This
      // still creates no "(2)" duplicate: the canonical id is reused, so
      // every cookbook that already referenced it sees the refreshed
      // content too, exactly as recipesById's single-canonical-copy model
      // intends.
      setRecipesById((prev) => ({ ...prev, [canonicalId]: { ...recipeInput, id: canonicalId } }));

      // All Recipes needs no separate write here: it's derived from
      // recipesById above, so referencing the (new or reused) canonical id
      // in this cookbook is automatically enough for it to also appear in
      // All Recipes.
      setCookbooks((prev) =>
        prev.map((cookbook) => {
          if (cookbook.id !== cookbookId || cookbook.recipeIds.includes(canonicalId)) {
            return cookbook;
          }
          return { ...cookbook, recipeIds: [...cookbook.recipeIds, canonicalId] };
        })
      );
    },
    [recipesById]
  );

  const removeRecipeFromCookbook = useCallback((cookbookId: string, recipeId: string) => {
    setCookbooks((prev) =>
      prev.map((cookbook) =>
        cookbook.id === cookbookId
          ? { ...cookbook, recipeIds: cookbook.recipeIds.filter((id) => id !== recipeId) }
          : cookbook
      )
    );
  }, []);

  const deleteRecipe = useCallback((recipeId: string) => {
    // Canonical delete: remove the Recipe itself...
    setRecipesById((prev) => {
      if (!(recipeId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[recipeId];
      return next;
    });
    // ...and strip the reference from every cookbook that had it. All
    // Recipes needs no separate update — it's derived from recipesById
    // above, so the deleted recipe drops out of it automatically.
    setCookbooks((prev) =>
      prev.map((cookbook) =>
        cookbook.recipeIds.includes(recipeId)
          ? { ...cookbook, recipeIds: cookbook.recipeIds.filter((id) => id !== recipeId) }
          : cookbook
      )
    );
  }, []);

  const allRecipesCookbook = useMemo(
    () => createAllRecipesCookbook(Object.keys(recipesById)),
    [recipesById]
  );

  const getCookbook = useCallback(
    (cookbookId: string) => {
      if (cookbookId === ALL_RECIPES_COOKBOOK_ID) {
        return allRecipesCookbook;
      }
      return cookbooks.find((cookbook) => cookbook.id === cookbookId);
    },
    [cookbooks, allRecipesCookbook]
  );

  const getRecipe = useCallback((recipeId: string) => recipesById[recipeId], [recipesById]);

  const getRecipesForCookbook = useCallback(
    (cookbook: Cookbook) =>
      cookbook.recipeIds.map((recipeId) => recipesById[recipeId]).filter((recipe): recipe is Recipe => !!recipe),
    [recipesById]
  );

  const value = useMemo(
    () => ({
      cookbooks,
      allRecipesCookbook,
      getCookbook,
      getRecipe,
      getRecipesForCookbook,
      addRecipeToCookbook,
      removeRecipeFromCookbook,
      deleteRecipe,
    }),
    [
      cookbooks,
      allRecipesCookbook,
      getCookbook,
      getRecipe,
      getRecipesForCookbook,
      addRecipeToCookbook,
      removeRecipeFromCookbook,
      deleteRecipe,
    ]
  );

  if (!isHydrated) {
    // Brief, ivory-colored blank frame while saved state loads, rather
    // than flashing the starting mock cookbooks first.
    return <View style={{ flex: 1, backgroundColor: Colors.light.background }} />;
  }

  return (
    <CookbookLibraryContext.Provider value={value}>{children}</CookbookLibraryContext.Provider>
  );
}

export function useCookbookLibrary() {
  const context = useContext(CookbookLibraryContext);
  if (!context) {
    throw new Error('useCookbookLibrary must be used within a CookbookLibraryProvider');
  }
  return context;
}
