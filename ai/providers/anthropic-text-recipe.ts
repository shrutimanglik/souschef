/**
 * The Anthropic (Claude) implementation of TextRecipeExtractor (see
 * ai/types.ts) — turns recipe-bearing free text (an Instagram caption, a
 * video transcript, eventually OCR output) into a canonical Recipe.
 *
 * This is a SEPARATE path from extraction/extractRecipeFromUrl — that
 * pipeline is untouched and remains the preferred, more reliable route
 * whenever a canonical recipe webpage exists (deterministic JSON-LD
 * parsing, no model in the loop). This file exists for the case that
 * pipeline structurally can't handle: the recipe never lived on a
 * fetchable webpage at all, only as text. Both converge on the exact same
 * Recipe/ExtractionResult shape — see extraction/types.ts — so every
 * caller downstream of extraction (report_result, a future save-to-
 * cookbook flow) treats either path's result identically.
 *
 * Normalization split mirrors extraction/normalize.ts's own division of
 * labor: Claude's job is literal extraction into a small intermediate
 * JSON shape (never the final Recipe/Ingredient types directly — this
 * file trusts nothing about the shape of what comes back and parses it as
 * defensively as extraction/json-ld.ts parses a page's JSON-LD); this
 * file's job is turning that into NormalizedRecipeFields and running it
 * through extraction/validate.ts's *existing, unmodified* validateRecipe —
 * the same validation both paths are held to.
 */

import type Anthropic from '@anthropic-ai/sdk';

import type { Ingredient } from '@/constants/recipes';
import type { ExtractionResult, NormalizedRecipeFields } from '@/extraction/types';
import { validateRecipe } from '@/extraction/validate';

import type { TextRecipeExtractionInput, TextRecipeExtractor } from '../types';

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

// Every rule here exists because a generative extractor can fail in ways a
// regex-based one structurally can't — inventing a plausible-sounding
// quantity or step that was never actually stated. The "never invent"
// framing is repeated deliberately; this is the one place in the app
// where an LLM produces recipe *facts* (not conversation about a known
// recipe, like ai/recipe-conversation.ts), so it carries the most weight.
const SYSTEM_PROMPT = `You are a precise recipe-data extractor. You are given a piece of text — an Instagram caption, a video transcript, or similar — that may contain a complete recipe, a partial one, or no recipe at all. Extract ONLY what is explicitly present. Never invent, infer, or estimate an ingredient, quantity, unit, step, serving count, or time that is not actually stated in the text. If the text doesn't say it, leave it out.

Rules:
- If the text contains no recognizable recipe at all, set "recipeFound" to false and leave "ingredients"/"instructions" empty. Do not guess at a recipe that isn't there.
- Extract each ingredient as its own {quantity, unit, name} entry. If a real number is given (including a written-out or fractional amount, e.g. "1/2 cup" or "a dozen eggs" -> 12), use it. If the source gives a QUALITATIVE amount instead of a number — "a handful of basil", "salt to taste", "a pinch of pepper", "a splash of milk", "a drizzle of oil" — set "quantity" to null and put the qualitative word itself in "unit" (e.g. "handful", "to taste", "pinch", "splash", "drizzle"). Never convert a qualitative amount into an invented number.
- Extract instructions as an ordered array of individual steps, staying as close to the source's own wording as possible — do not paraphrase into a different technique, merge steps that were distinct, or add a step that wasn't stated.
- Extract servings/yield, prep/cook/total time (in minutes), and author/source attribution ONLY if explicitly stated in the text. Otherwise leave them null. Do not estimate a time or serving count from context.
- When something is ambiguous — an ingredient with no clear quantity or unit at all, a step that seems to skip detail, a vague serving range — still extract what you can, and add a short note to "warnings" explaining what's uncertain.
- Output ONLY a single JSON object matching this exact shape. No prose, no markdown fences, nothing before or after it:
{
  "recipeFound": boolean,
  "title": string | null,
  "servings": number | null,
  "servingsLabel": string | null,
  "prepTimeMinutes": number | null,
  "cookTimeMinutes": number | null,
  "totalTimeMinutes": number | null,
  "source": string | null,
  "ingredients": [{"quantity": number | null, "unit": string | null, "name": string}],
  "instructions": [string],
  "warnings": [string]
}`;

type ParsedExtraction = {
  recipeFound: boolean;
  title: string | null;
  servings: number | null;
  servingsLabel: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  source: string | null;
  ingredients: Array<{ quantity: number | null; unit: string | null; name: string }>;
  instructions: string[];
  warnings: string[];
};

function buildUserMessage(input: TextRecipeExtractionInput): string {
  const lines = [
    `Source type: ${input.sourceType}`,
    input.sourceUrl ? `Source URL: ${input.sourceUrl}` : null,
    input.creatorName ? `Known creator/author: ${input.creatorName}` : null,
    '',
    'Text:',
    '"""',
    input.text,
    '"""',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

function parseResponse(text: string): ParsedExtraction | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return {
      recipeFound: record.recipeFound === true,
      title: typeof record.title === 'string' ? record.title : null,
      servings: typeof record.servings === 'number' && Number.isFinite(record.servings) ? record.servings : null,
      servingsLabel: typeof record.servingsLabel === 'string' ? record.servingsLabel : null,
      prepTimeMinutes: typeof record.prepTimeMinutes === 'number' && Number.isFinite(record.prepTimeMinutes) ? record.prepTimeMinutes : null,
      cookTimeMinutes: typeof record.cookTimeMinutes === 'number' && Number.isFinite(record.cookTimeMinutes) ? record.cookTimeMinutes : null,
      totalTimeMinutes: typeof record.totalTimeMinutes === 'number' && Number.isFinite(record.totalTimeMinutes) ? record.totalTimeMinutes : null,
      source: typeof record.source === 'string' ? record.source : null,
      ingredients: Array.isArray(record.ingredients) ? record.ingredients : [],
      instructions: Array.isArray(record.instructions)
        ? record.instructions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
        : [],
      warnings: Array.isArray(record.warnings) ? record.warnings.filter((w): w is string => typeof w === 'string') : [],
    };
  } catch {
    return null;
  }
}

function toIngredient(raw: unknown, index: number): Ingredient | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    return null;
  }
  // A qualitative amount ("a handful", "to taste") is represented as
  // quantity: 0 with the descriptor carried in `unit` — the same
  // convention extraction/normalize.ts's ingredient parser already uses
  // for "pinch"/"dash" (quantity-less by nature, not "unknown").
  const quantity = typeof record.quantity === 'number' && Number.isFinite(record.quantity) && record.quantity > 0 ? record.quantity : 0;
  const unit = typeof record.unit === 'string' ? record.unit.trim() : '';
  return { id: `ingredient-${index}`, quantity, unit, name };
}

export class AnthropicTextRecipeExtractor implements TextRecipeExtractor {
  readonly name = 'anthropic-text';

  constructor(private readonly client: Anthropic) {}

  async extract(input: TextRecipeExtractionInput): Promise<ExtractionResult> {
    if (!input.text.trim()) {
      return { ok: false, error: { code: 'no-structured-data', message: 'No text was provided to extract from.' } };
    }

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(input) }],
      });
    } catch (error) {
      return {
        ok: false,
        error: { code: 'fetch-failed', message: error instanceof Error ? error.message : 'Claude request failed.' },
      };
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const parsed = parseResponse(text);
    if (!parsed) {
      return { ok: false, error: { code: 'fetch-failed', message: 'Claude returned a response that was not valid JSON.' } };
    }

    if (!parsed.recipeFound) {
      return { ok: false, error: { code: 'no-structured-data', message: 'No recipe was found in the provided text.' } };
    }

    const ingredients = parsed.ingredients
      .map((raw, index) => toIngredient(raw, index))
      .filter((ingredient): ingredient is Ingredient => ingredient !== null);

    // Attribution: prefer what the text itself stated; fall back to a
    // creator name already known from other evidence (e.g. Instagram
    // metadata) rather than leaving it blank when we genuinely know it.
    const source = (parsed.source && parsed.source.trim()) || input.creatorName || '';

    const fields: NormalizedRecipeFields = {
      title: (parsed.title && parsed.title.trim()) || 'Untitled recipe',
      source,
      sourceUrl: input.sourceUrl ?? '',
      servings: parsed.servings ?? 0,
      servingsLabel: (parsed.servingsLabel && parsed.servingsLabel.trim()) || '',
      prepTime: parsed.prepTimeMinutes ?? 0,
      cookTime: parsed.cookTimeMinutes ?? 0,
      totalTime: parsed.totalTimeMinutes ?? 0,
      ingredients,
      instructions: parsed.instructions,
    };

    // Same validation the deterministic path is held to — reused
    // unmodified, not reimplemented, so "what counts as a usable recipe"
    // can never drift between the two extraction paths.
    const validationError = validateRecipe(fields);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    return {
      ok: true,
      recipe: {
        id: 'pending-recipe',
        ...fields,
        extraction: {
          method: 'ai-text-extraction',
          fetchedAt: new Date().toISOString(),
          warnings: parsed.warnings.map((message) => ({ field: 'text-extraction', message })),
        },
      },
    };
  }
}
