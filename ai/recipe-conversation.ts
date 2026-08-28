import { formatIngredient, formatServings, formatTimeSummary, type Recipe } from '@/constants/recipes';

import type { ChatError, ChatMessage, ChatProvider } from './types';

// Not a real markdown construct and distinctive enough that it won't
// collide with normal conversational text, so splitting on it is exact —
// no heuristics needed to tell the answer from the follow-up questions.
const SUGGESTIONS_MARKER = '<<<SUGGESTIONS>>>';

const MAX_SUGGESTIONS = 3;

/**
 * Turns one Recipe into the system prompt that grounds a conversation
 * about it. The recipe is the model's complete and only source of truth
 * for this dish — it must reason over these exact ingredients and steps,
 * never invent a recipe-specific fact (a quantity, a technique, a
 * substitution ratio) that isn't stated below or backed by general
 * cooking knowledge it's explicit about drawing on.
 */
function buildSystemPrompt(recipe: Recipe): string {
  const servings = formatServings(recipe);
  const time = formatTimeSummary(recipe);

  const ingredientLines =
    recipe.ingredients.map((ingredient) => `- ${formatIngredient(ingredient)}`).join('\n') || '(none listed)';
  const instructionLines =
    recipe.instructions.map((step, index) => `${index + 1}. ${step}`).join('\n') || '(none listed)';

  return [
    `You are a cooking assistant helping someone cook one specific recipe: "${recipe.title}".`,
    servings ? `Servings: ${servings}` : null,
    time ? `Time: ${time}` : null,
    'Ingredients:',
    ingredientLines,
    'Instructions:',
    instructionLines,
    '',
    'Rules:',
    '- The recipe above is the complete and only source of truth for this dish. Never invent an ingredient, quantity, or step that is not listed above.',
    "- You may draw on general cooking knowledge to answer questions the recipe itself doesn't cover (substitutions, scaling, make-ahead advice, technique explanations) — but be clear when you're doing that rather than stating it as part of the recipe.",
    '- If a question cannot be answered from the recipe or reasonable cooking knowledge, say so plainly instead of guessing.',
    "- Keep answers short, practical, and conversational — this is a home cook asking a quick question, not a request for an essay.",
    // The single most valuable behavior this feature has — reason about a
    // change in the context of *this* dish, not as a generic lookup.
    "- When asked about a substitution or ingredient change, don't just say whether it's possible in general — reason about the ingredient's role in this specific recipe (moisture, fat, binding, leavening, structure, acidity, sweetness, flavor) and how it interacts with the other ingredients and this method, then explain why the swap should or shouldn't work here and what it's likely to change (texture, moisture, flavor, fat, acidity, structure, or cooking time) where that's meaningful. Keep the reasoning grounded in this recipe rather than turning the answer into a general substitution reference.",
    '- Formatting: plain prose for a short answer is fine. For anything with real structure — a few distinct points, ordered steps, options to weigh — use light markdown (bold for emphasis, "- " bullet lists, "1." numbered lists, "#" for a short heading) so it renders cleanly; the app parses this, so use it rather than avoiding it. Don\'t use tables, links, or code blocks — none of those fit a quick cooking answer.',
    '',
    // A trailing, machine-parsed section rather than a second request: the
    // model produces the follow-ups in the same completion as the answer,
    // and the app splits them out before displaying either half (see
    // splitMessageAndSuggestions below) — never shown to the user as raw
    // text.
    `After your answer, on its own line write exactly ${SUGGESTIONS_MARKER}, then 2-3 short follow-up questions this home cook could naturally ask next, one per line, no bullets or numbering — each grounded in this specific recipe and where the conversation has gone so far, not a generic/fixed set. If nothing meaningful naturally follows, write the marker with nothing after it.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/**
 * Separates the model's trailing suggested-questions section (see the
 * prompt instruction above) from the visible answer. Pure string parsing —
 * works on whatever text a ChatProvider returns, so it stays provider-
 * agnostic the same way buildSystemPrompt does; nothing here is
 * Anthropic-specific.
 */
function splitMessageAndSuggestions(raw: string): { message: string; suggestions: string[] } {
  const markerIndex = raw.indexOf(SUGGESTIONS_MARKER);
  if (markerIndex === -1) {
    // The model didn't follow the trailer format (e.g. an unusually short
    // reply) — show the full text rather than losing part of the answer.
    return { message: raw.trim(), suggestions: [] };
  }

  const message = raw.slice(0, markerIndex).trim();
  const suggestions = raw
    .slice(markerIndex + SUGGESTIONS_MARKER.length)
    .split('\n')
    .map((line) => line.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, ''))
    .filter((line) => line.length > 0)
    .slice(0, MAX_SUGGESTIONS);

  // Defensive: if the marker somehow led the response (nothing before it),
  // fall back to the untouched raw text so the user never sees a blank
  // answer.
  return message ? { message, suggestions } : { message: raw.trim(), suggestions: [] };
}

export type AskAboutRecipeResult =
  | { ok: true; message: string; suggestions: string[] }
  | { ok: false; error: ChatError };

/**
 * The feature's single entry point: a ChatProvider, the Recipe being
 * discussed, and the running conversation in — one assistant reply plus
 * its contextual follow-up suggestions out. Callers (the API route) never
 * build a prompt, touch a provider, or parse suggestions themselves.
 */
export async function askAboutRecipe(
  provider: ChatProvider,
  recipe: Recipe,
  messages: ChatMessage[]
): Promise<AskAboutRecipeResult> {
  const result = await provider.sendMessage({ system: buildSystemPrompt(recipe), messages });
  if (!result.ok) {
    return result;
  }

  const split = splitMessageAndSuggestions(result.message);
  // TEMP DIAGNOSTIC LOGGING — remove once the "Couldn't reach SousChef"
  // client-side reports are root-caused. Lengths/counts only — never the
  // recipe, the question, or the answer text itself.
  console.log('[TEMP DIAGNOSTIC] askAboutRecipe split response', {
    rawLength: result.message.length,
    markerFound: result.message.includes(SUGGESTIONS_MARKER),
    messageLength: split.message.length,
    suggestionCount: split.suggestions.length,
  });

  return { ok: true, ...split };
}
