/**
 * Core recipe data model.
 *
 * Recipes are their own typed entity — a cookbook holds a collection of
 * them rather than duplicating recipe data inline. Nothing here is wired
 * up to a UI yet; this just establishes the shape the Add Recipe flow and
 * cookbook detail screen will build on.
 */

export type Ingredient = {
  id: string;
  /**
   * Kept separate from `unit` (rather than a single "180g flour" string) so
   * we can later support recipe scaling, grams-first unit handling, and
   * conversions without reparsing free text.
   */
  quantity: number;
  unit: string;
  name: string;
};

export type Recipe = {
  id: string;
  title: string;
  /** Human-readable attribution, e.g. "Dish by Rish". */
  source: string;
  /** Where the recipe was extracted from. The canonical dedup key — see `normalizeSourceUrl`. */
  sourceUrl: string;
  /** How many `servingsLabel` this recipe makes, e.g. 18 "cookies" or 4 "servings". */
  servings: number;
  servingsLabel: string;
  /** All three times are in minutes — kept numeric, not a formatted string, for the same reason as ingredient quantity/unit. */
  prepTime: number;
  cookTime: number;
  totalTime: number;
  ingredients: Ingredient[];
  /** Ordered preparation steps. */
  instructions: string[];
  /**
   * Captured from extraction when available. Not rendered or downloaded
   * anywhere yet — this only stores the URL so a hero image can be added
   * later without re-extracting.
   */
  imageUrl?: string;
  /**
   * How this recipe was obtained, if it wasn't hand-entered — absent for
   * recipes with no extraction history (e.g. a future "Add manually").
   * See extraction/ for the pipeline that populates this.
   */
  extraction?: RecipeExtractionInfo;
};

export type ExtractionMethod = 'json-ld' | 'manual';

/** A specific field extraction couldn't fully resolve — informational, not blocking. */
export type ExtractionWarning = {
  /** e.g. "servings", "ingredients[3]" */
  field: string;
  message: string;
};

export type RecipeExtractionInfo = {
  method: ExtractionMethod;
  /** ISO timestamp of when the source page was fetched. */
  fetchedAt: string;
  warnings: ExtractionWarning[];
};

// A few common fractional quantities, formatted the way a recipe would
// print them (e.g. "1/2 tbsp") rather than as a decimal. This is display
// formatting only — quantity stays a plain number in the data model, ready
// for real scaling/conversion later.
const FRACTION_QUANTITIES: Record<number, string> = {
  0.25: '1/4',
  0.33: '1/3',
  0.5: '1/2',
  0.67: '2/3',
  0.75: '3/4',
};

function formatQuantity(quantity: number): string {
  if (Number.isInteger(quantity)) {
    return String(quantity);
  }
  const rounded = Math.round(quantity * 100) / 100;
  return FRACTION_QUANTITIES[rounded] ?? String(quantity);
}

/** Renders an ingredient the way it would read in a recipe, e.g. "180 g plain flour". */
export function formatIngredient(ingredient: Ingredient): string {
  return `${formatQuantity(ingredient.quantity)} ${ingredient.unit} ${ingredient.name}`.trim();
}

/** e.g. "180 g" — the quantity/unit half of an ingredient row, kept apart from the name. */
export function formatIngredientQuantity(ingredient: Ingredient): string {
  return `${formatQuantity(ingredient.quantity)} ${ingredient.unit}`.trim();
}

/**
 * e.g. "18 cookies" or "4 servings" — or `null` if servings isn't known
 * (missing, non-positive, or has no label), so the caller can omit the
 * line entirely rather than showing a fake "0" or a bare number with no
 * unit. Normalization defaults an unknown `servings` to `0` and an unknown
 * `servingsLabel` to `''` (see `normalizeRecipe`) specifically so this
 * function has a reliable "unknown" signal to check for.
 */
export function formatServings(recipe: Pick<Recipe, 'servings' | 'servingsLabel'>): string | null {
  if (!Number.isFinite(recipe.servings) || recipe.servings <= 0) {
    return null;
  }
  if (!recipe.servingsLabel || !recipe.servingsLabel.trim()) {
    return null;
  }
  return `${recipe.servings} ${recipe.servingsLabel}`;
}

/** e.g. "34 min". Minutes only for now — no need for an hours breakdown yet. */
export function formatMinutes(minutes: number): string {
  return `${minutes} min`;
}

function hasKnownMinutes(minutes: number): boolean {
  return Number.isFinite(minutes) && minutes > 0;
}

/**
 * e.g. "Prep 20 min · Cook 14 min · Total 34 min" — built only from
 * whichever of prep/cook/total are actually known (see `hasKnownMinutes`;
 * an unknown time normalizes to `0`, which reads as "not known" here, not
 * "takes no time"). Returns `null` if none are known, so the whole
 * metadata line can be omitted instead of showing fake "0 min" values.
 */
export function formatTimeSummary(recipe: Pick<Recipe, 'prepTime' | 'cookTime' | 'totalTime'>): string | null {
  const parts: string[] = [];
  if (hasKnownMinutes(recipe.prepTime)) {
    parts.push(`Prep ${formatMinutes(recipe.prepTime)}`);
  }
  if (hasKnownMinutes(recipe.cookTime)) {
    parts.push(`Cook ${formatMinutes(recipe.cookTime)}`);
  }
  if (hasKnownMinutes(recipe.totalTime)) {
    parts.push(`Total ${formatMinutes(recipe.totalTime)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Normalizes a recipe source URL for duplicate detection — strips the
 * protocol, a leading "www.", and any trailing slash(es), so trivial
 * differences (http vs https, www vs not, a trailing "/") don't produce a
 * second canonical Recipe for the same page.
 */
export function normalizeSourceUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

function normalizeIngredient(raw: unknown, index: number): Ingredient {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Ingredient>;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `ingredient-${index}`,
    quantity: typeof value.quantity === 'number' && Number.isFinite(value.quantity) ? value.quantity : 0,
    unit: typeof value.unit === 'string' ? value.unit : '',
    name: typeof value.name === 'string' ? value.name : '',
  };
}

/**
 * Upgrades a recipe loaded from storage to the current `Recipe` shape.
 * Persisted data can predate fields added since it was saved (e.g. an
 * older prototype's recipes have no `sourceUrl`/`servings`/time fields) —
 * this fills in safe defaults for anything missing or malformed, without
 * touching any field that's already present and valid. `fallbackId` is
 * used only if the stored value has no id of its own (e.g. it's keyed by
 * that id in `recipesById`).
 */
export function normalizeRecipe(fallbackId: string, raw: unknown): Recipe {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Recipe>;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : fallbackId,
    title: typeof value.title === 'string' && value.title ? value.title : 'Untitled recipe',
    source: typeof value.source === 'string' ? value.source : '',
    sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : '',
    servings: typeof value.servings === 'number' && Number.isFinite(value.servings) ? value.servings : 0,
    servingsLabel: typeof value.servingsLabel === 'string' ? value.servingsLabel : '',
    prepTime: typeof value.prepTime === 'number' && Number.isFinite(value.prepTime) ? value.prepTime : 0,
    cookTime: typeof value.cookTime === 'number' && Number.isFinite(value.cookTime) ? value.cookTime : 0,
    totalTime: typeof value.totalTime === 'number' && Number.isFinite(value.totalTime) ? value.totalTime : 0,
    ingredients: Array.isArray(value.ingredients)
      ? value.ingredients.map((ingredient, index) => normalizeIngredient(ingredient, index))
      : [],
    instructions: Array.isArray(value.instructions)
      ? value.instructions.filter((step): step is string => typeof step === 'string')
      : [],
    ...(typeof value.imageUrl === 'string' && value.imageUrl ? { imageUrl: value.imageUrl } : {}),
    ...(isRecipeExtractionInfo(value.extraction) ? { extraction: value.extraction } : {}),
  };
}

function isRecipeExtractionInfo(value: unknown): value is RecipeExtractionInfo {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const info = value as Partial<RecipeExtractionInfo>;
  return (
    (info.method === 'json-ld' || info.method === 'manual') &&
    typeof info.fetchedAt === 'string' &&
    Array.isArray(info.warnings)
  );
}
