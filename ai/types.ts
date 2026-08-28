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
 */

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
