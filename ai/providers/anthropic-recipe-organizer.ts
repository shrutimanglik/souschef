/**
 * The Anthropic (Claude) implementation of RecipeOrganizer (see
 * ai/types.ts) — a single LLM call that proposes a component grouping
 * over an already-extracted Recipe's ingredients/instructions. Not a
 * tool-use loop; one request, one response.
 *
 * The LLM never sees or produces ingredient/instruction TEXT — only the
 * INDEX of each one in a numbered list buildUserMessage() constructs from
 * the recipe. Its response is index references and component names only.
 * validateAndBuildComponents below never reads ingredient/instruction text
 * from the model's response for the ingredients/instructions themselves —
 * every index is bounds-checked, and the full set must exactly partition
 * the original arrays (every index used exactly once, none invented, none
 * missing) before any component is trusted.
 *
 * The one piece of genuine free text the model DOES return is each
 * component's `name` — and a name that's merely "non-empty" isn't enough
 * of a guarantee: an ungrounded check would let the model paraphrase or
 * subtly corrupt wording despite the system prompt's instruction to reuse
 * the recipe's own words (this is exactly how a past bug slipped through —
 * a source recipe's own "spicy dumpling sauce" / "spicy wonton sauce"
 * wording got paraphrased into "Spice Dumpling Sauce"). So
 * validateAndBuildComponents also requires each name to be a literal,
 * case-insensitive substring of the text already sitting in that
 * component's own assigned ingredients/instructions — see
 * isNameGroundedInSource. A name that isn't actually lifted from the
 * recipe's own wording fails validation like any other bad reference.
 *
 * On ANY problem — a malformed response, a failed partition, an API
 * error — organize() returns the ORIGINAL recipe with a warning folded
 * into its existing extraction.warnings, never a broken or partial
 * result. Organizing is best-effort structure on top of a recipe that's
 * already correct; it must never risk the recipe itself.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { formatIngredient, type Recipe, type RecipeComponent } from '@/constants/recipes';

import type { RecipeOrganizer } from '../types';

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2048;

const SYSTEM_PROMPT = `You are a recipe structure organizer. You are given a recipe's ingredients and instructions, each shown with its index in the original list. Your ONLY job is to detect whether the recipe clearly describes multiple distinct components (e.g. "the dough" and "the filling", "the kebabs" and "the chutney") and, if so, group the existing ingredient/instruction indexes by component.

You never see or produce ingredient/instruction text — only index numbers. You are grouping, not extracting, generating, or rewriting anything.

Rules:
- Only propose a component grouping when the recipe's OWN wording clearly establishes it — e.g. an instruction says "for the sauce", "make the filling by...", "meanwhile, prepare the chutney", or an ingredient is explicitly introduced as being for a named part. Do not group items just because they seem thematically related if the recipe's own text never actually names or distinguishes a component.
- If you do detect components, every ingredient index and every instruction index must end up assigned to exactly one component — nothing left out, nothing duplicated.
- Name each component with a word or short phrase copied verbatim (any capitalization) from the exact ingredient/instruction text you're grouping under it — e.g. if an instruction says "for the chutney", the component name must literally contain "chutney". Never paraphrase, correct, retitle, or invent a name — even a close rewording (e.g. turning "spicy dumpling sauce" into "spice dumpling sauce") will be rejected.
- Never reorder ingredients or instructions, and never decide what order components should be made in — you are only grouping, never sequencing.
- If this is a single, undivided recipe, or the component structure is at all unclear, inconsistent, or only partially indicated, output no components at all. That is the correct, common answer for most recipes — do not force a split.

Output ONLY a single JSON object, no prose, no markdown fences, nothing else:
{"components": null}
or, only when clearly justified by the recipe's own wording:
{"components": [{"name": "string", "ingredientIndexes": [numbers], "instructionIndexes": [numbers]}]}`;

function buildUserMessage(recipe: Recipe): string {
  const ingredientLines = recipe.ingredients.map((ingredient, index) => `${index}: ${formatIngredient(ingredient)}`);
  const instructionLines = recipe.instructions.map((step, index) => `${index}: ${step}`);
  return [
    `Title: ${recipe.title}`,
    '',
    'Ingredients (indexed):',
    ingredientLines.join('\n') || '(none)',
    '',
    'Instructions (indexed):',
    instructionLines.join('\n') || '(none)',
  ].join('\n');
}

type ParsedComponent = { name: unknown; ingredientIndexes: unknown; instructionIndexes: unknown };

/**
 * Parses the model's response into a list of raw (untrusted) component
 * proposals — or `[]` for a legitimate "no components" answer (`null`,
 * missing, or an empty array), or `null` if the response wasn't
 * recognizable as either. Field-level trust happens later, in
 * validateAndBuildComponents — this only separates "nothing to validate"
 * from "something to validate" from "couldn't even parse a response".
 */
function parseResponse(text: string): ParsedComponent[] | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const components = (parsed as Record<string, unknown>).components;
    if (components === null || components === undefined) {
      return [];
    }
    if (!Array.isArray(components)) {
      return null;
    }
    // Not yet verified to match ParsedComponent's shape — every field is
    // re-checked defensively in validateAndBuildComponents below, which
    // is the actual trust boundary.
    return components as ParsedComponent[];
  } catch {
    return null;
  }
}

/**
 * The whole safety boundary. Takes the recipe's own ingredient/instruction
 * counts and whatever the model claimed about grouping them, and returns
 * a validated RecipeComponent[] only if it exactly partitions both arrays
 * — every index in range, none missing, none duplicated — or null if the
 * proposal fails that check. Exported for direct unit testing without a
 * live API call (see the "deliberately invalid LLM output" test case).
 */
export function validateAndBuildComponents(recipe: Recipe, parsed: ParsedComponent[] | null): RecipeComponent[] | null {
  if (!parsed || parsed.length === 0) {
    return null;
  }

  const ingredientCount = recipe.ingredients.length;
  const instructionCount = recipe.instructions.length;
  const seenIngredientIndexes = new Set<number>();
  const seenInstructionIndexes = new Set<number>();
  const components: RecipeComponent[] = [];

  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) {
      return null;
    }
    if (!Array.isArray(raw.ingredientIndexes) || !Array.isArray(raw.instructionIndexes)) {
      return null;
    }

    const validIngredientIndexes: number[] = [];
    for (const index of raw.ingredientIndexes) {
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= ingredientCount) {
        return null; // out-of-range or malformed reference — discard the whole proposal
      }
      if (seenIngredientIndexes.has(index)) {
        return null; // duplicate reference across components
      }
      seenIngredientIndexes.add(index);
      validIngredientIndexes.push(index);
    }

    const validInstructionIndexes: number[] = [];
    for (const index of raw.instructionIndexes) {
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= instructionCount) {
        return null;
      }
      if (seenInstructionIndexes.has(index)) {
        return null;
      }
      seenInstructionIndexes.add(index);
      validInstructionIndexes.push(index);
    }

    // Sorted ascending — preserves the recipe's own original relative
    // order within the component regardless of what order the model
    // listed indexes in. Never a reordering or sequencing decision.
    validIngredientIndexes.sort((a, b) => a - b);
    validInstructionIndexes.sort((a, b) => a - b);

    // The name itself is the one piece of this proposal that's genuinely
    // free text from the model, not an index — so it's the one place a
    // paraphrase or outright invention could sneak into the final Recipe
    // despite the system prompt's instruction to only reuse the recipe's
    // own wording. Enforce that structurally: the name must be a literal,
    // case-insensitive substring of this component's OWN assigned
    // ingredient/instruction text (never the whole recipe — that would let
    // a name "ground" itself in a different component's wording). If it
    // isn't, the model renamed or paraphrased something rather than
    // reusing it verbatim, so the whole proposal is discarded exactly like
    // any other invalid reference above.
    if (!isNameGroundedInSource(recipe, name, validIngredientIndexes, validInstructionIndexes)) {
      return null;
    }

    components.push({
      name,
      ingredientIds: validIngredientIndexes.map((index) => recipe.ingredients[index].id),
      instructionIndexes: validInstructionIndexes,
    });
  }

  // Must be an exact, lossless partition — every original ingredient and
  // every original instruction accounted for exactly once. Anything less
  // (or more) means the proposal doesn't fully and faithfully cover the
  // real recipe, so the whole thing is discarded rather than trusted
  // partially.
  if (seenIngredientIndexes.size !== ingredientCount || seenInstructionIndexes.size !== instructionCount) {
    return null;
  }

  // Order components by where they first appear in the original
  // ingredient list — not the model's own ordering, and not a cooking
  // sequence, just "however the source already laid them out".
  components.sort((a, b) => {
    const aIndex = recipe.ingredients.findIndex((ingredient) => ingredient.id === a.ingredientIds[0]);
    const bIndex = recipe.ingredients.findIndex((ingredient) => ingredient.id === b.ingredientIds[0]);
    return aIndex - bIndex;
  });

  return components;
}

/**
 * True only if `name` is a literal, case-insensitive substring of the text
 * already sitting in this component's own assigned ingredients/
 * instructions — the grounding check described above
 * validateAndBuildComponents's call site. Deliberately scoped to just the
 * indexes being proposed for THIS component, not the recipe as a whole.
 */
// Exported alongside validateAndBuildComponents for direct unit testing
// (see ai/test-recipe-organizer.ts) without a live API call.
export function isNameGroundedInSource(
  recipe: Recipe,
  name: string,
  ingredientIndexes: number[],
  instructionIndexes: number[]
): boolean {
  const haystack = [
    ...ingredientIndexes.map((index) => recipe.ingredients[index].name),
    ...instructionIndexes.map((index) => recipe.instructions[index]),
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(name.toLowerCase());
}

/** Folds a warning into the recipe's existing extraction metadata, changing nothing else. Never fabricates `extraction` if it's absent — see the file header on why. */
function withComponentsWarning(recipe: Recipe, message: string): Recipe {
  if (!recipe.extraction) {
    return recipe;
  }
  return {
    ...recipe,
    extraction: { ...recipe.extraction, warnings: [...recipe.extraction.warnings, { field: 'components', message }] },
  };
}

export class AnthropicRecipeOrganizer implements RecipeOrganizer {
  readonly name = 'anthropic';

  constructor(private readonly client: Anthropic) {}

  async organize(recipe: Recipe): Promise<Recipe> {
    if (recipe.ingredients.length === 0 || recipe.instructions.length === 0) {
      return recipe;
    }

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(recipe) }],
      });
    } catch (error) {
      return withComponentsWarning(
        recipe,
        `Could not organize this recipe into components: ${error instanceof Error ? error.message : 'the request failed'}.`
      );
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const parsed = parseResponse(text);
    if (parsed === null) {
      return withComponentsWarning(recipe, 'Could not organize this recipe into components — the response was not understood.');
    }
    if (parsed.length === 0) {
      // The model legitimately found no components — the common case, not a failure.
      return recipe;
    }

    const components = validateAndBuildComponents(recipe, parsed);
    if (!components) {
      return withComponentsWarning(
        recipe,
        'Could not organize this recipe into components — the proposed grouping did not match the recipe.'
      );
    }

    return { ...recipe, components };
  }
}
