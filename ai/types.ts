/**
 * Shared types for the AI layer.
 *
 * Deliberately framework-agnostic — no Expo/React Native imports anywhere
 * under ai/, so this can run inside the `+api.ts` server route (see
 * app/api/recipe-chat+api.ts) and, later, from any other server-side entry
 * point (e.g. a future recipe-ingestion pipeline) without change. Mirrors
 * the shape of extraction/types.ts for the same reason.
 *
 * `ChatProvider` is the entire provider-agnostic boundary: recipe-
 * conversation.ts and the API route depend only on this interface, never
 * on a specific vendor SDK. Claude (see providers/anthropic.ts) is the
 * only implementation today — a second provider is a second file behind
 * this same interface, not a rewrite of any call site.
 *
 * This file imports ExtractionResult from extraction/ (for
 * TextRecipeExtractor below) — the one dependency ai/ has on extraction/,
 * for the shared canonical Recipe type only. extraction/ has no dependency
 * back, and none of its pipeline logic is touched by anything here.
 */

import type { ExtractionResult } from '@/extraction';
import type { Recipe } from '@/constants/recipes';

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatErrorCode = 'invalid-request' | 'missing-api-key' | 'request-failed';

export type ChatError = {
  code: ChatErrorCode;
  message: string;
};

/**
 * Why the model stopped generating, collapsed to the two cases a caller
 * actually needs to distinguish today — a normal completion vs. one cut
 * short by the token budget — rather than passing a vendor-specific
 * `stop_reason` string (Anthropic's includes values like "tool_use" and
 * "pause_turn" that don't apply to this no-tools, non-streaming feature).
 * A provider maps its own reason values onto this at the boundary; see
 * providers/anthropic.ts.
 */
export type ChatStopReason = 'complete' | 'max_tokens' | 'other';

export type ChatCompletionResult =
  | { ok: true; message: string; stopReason: ChatStopReason }
  | { ok: false; error: ChatError };

/**
 * One provider call: a system prompt plus the running message history in,
 * a single assistant reply out. No streaming, no tool use — the smallest
 * shape a Q&A-over-one-recipe feature needs today. Extend this interface
 * only when a real use case needs more.
 */
export interface ChatProvider {
  readonly name: string;
  sendMessage(params: { system: string; messages: ChatMessage[] }): Promise<ChatCompletionResult>;
}

/**
 * Where a piece of recipe-bearing text came from — carried through so the
 * resulting Recipe's attribution is grounded in real evidence rather than
 * guessed, and so a future OCR path is just another value here, not a new
 * interface.
 */
export type RecipeTextSourceType = 'instagram-caption' | 'video-transcript' | 'comment' | 'ocr' | 'manual';

export type TextRecipeExtractionInput = {
  /** The raw recipe-bearing text — a caption, a transcript, eventually OCR output. */
  text: string;
  sourceType: RecipeTextSourceType;
  /** The URL this text is associated with, if any — becomes the resulting Recipe's sourceUrl. */
  sourceUrl?: string;
  /** The creator/author, if already known from other evidence (e.g. Instagram metadata) — lets the extractor attribute the recipe correctly without guessing when the text itself doesn't state an author. */
  creatorName?: string;
};

/**
 * The provider-agnostic boundary for text-to-recipe extraction — same
 * pattern as ChatProvider above, and the same shape of boundary
 * extraction/types.ts draws around ExtractionStrategy: callers (see
 * agent/tools/extract-recipe-from-text.ts) depend only on this interface,
 * never on a specific vendor SDK. Claude (see
 * providers/anthropic-text-recipe.ts) is the only implementation today.
 *
 * Returns extraction/'s own ExtractionResult — the whole point of this
 * interface is that this LLM-based path and extractRecipeFromUrl's
 * deterministic path converge on the exact same canonical Recipe shape,
 * not a parallel one. This is the one place ai/ depends on extraction/ —
 * for the shared Recipe/ExtractionResult *types* only; extraction/ itself
 * has no dependency back, and its own pipeline is untouched by this file.
 */
export interface TextRecipeExtractor {
  readonly name: string;
  extract(input: TextRecipeExtractionInput): Promise<ExtractionResult>;
}

/**
 * The provider-agnostic boundary for the recipe organizer — a single LLM
 * call (never a tool-use loop) that proposes grouping an already-extracted
 * Recipe's ingredients/instructions into components (e.g. "Dough" and
 * "Filling"), run as a step after extraction, not part of extraction
 * itself. Claude (see providers/anthropic-recipe-organizer.ts) is the
 * only implementation today.
 *
 * `organize` always resolves to a complete, valid Recipe — organized (has
 * `components`), unchanged (no meaningful structure found — the common
 * case), or unchanged with a warning folded into `extraction.warnings`
 * (the proposal didn't validate, or the call failed). There is no
 * separate error case a caller has to branch on: this can only ever
 * return the Recipe it was given, optionally annotated with a grouping
 * that already validated as an exact, lossless partition of the original
 * ingredients/instructions — see validateAndBuildComponents in the
 * Anthropic implementation for that guarantee. It can never become a
 * source of recipe facts.
 */
export interface RecipeOrganizer {
  readonly name: string;
  organize(recipe: Recipe): Promise<Recipe>;
}
