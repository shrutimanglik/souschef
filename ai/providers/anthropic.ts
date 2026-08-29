import Anthropic from '@anthropic-ai/sdk';

import type { ChatCompletionResult, ChatMessage, ChatProvider, ChatStopReason } from '../types';

/**
 * The Anthropic (Claude) implementation of ChatProvider — the only
 * implementation today. Every call site (recipe-conversation.ts, the API
 * route) depends on the ChatProvider interface, not on this file or the
 * Anthropic SDK directly, so adding a second provider (OpenAI, Gemini,
 * ...) later means adding a second file here, not touching any caller.
 *
 * Takes the API key as a parameter rather than reading `process.env`
 * itself, so this file stays plain, provider-only TypeScript with no
 * environment access of its own. The one place that reads
 * `ANTHROPIC_API_KEY` is app/api/recipe-chat+api.ts, which is guaranteed
 * to run server-side — see that file's header comment for why that
 * matters (the key must never reach the client bundle).
 */

// Claude Sonnet 5 — a mid-tier, non-Opus model with enough reasoning
// headroom for grounded, occasionally multi-step cooking questions
// (substitution tradeoffs, scaling math) while staying well below Opus
// cost/latency. Swap this one constant (or add a second provider) to move
// to a different Claude model or vendor.
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2048;

// Extracted so any other server-side Claude caller (see agent/instagram-recipe-agent.ts,
// which needs raw tool-use access this narrow ChatProvider interface doesn't expose)
// constructs the client the same way, rather than each duplicating `new Anthropic(...)`.
export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

export function createAnthropicProvider(apiKey: string | undefined): ChatProvider {
  return {
    name: 'anthropic',
    async sendMessage({ system, messages }): Promise<ChatCompletionResult> {
      if (!apiKey) {
        return {
          ok: false,
          error: { code: 'missing-api-key', message: 'ANTHROPIC_API_KEY is not configured on the server.' },
        };
      }

      const client = createAnthropicClient(apiKey);

      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: toAnthropicMessages(messages),
        });

        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim();

        if (!text) {
          return { ok: false, error: { code: 'request-failed', message: 'Claude returned an empty response.' } };
        }

        const stopReason = toChatStopReason(response.stop_reason);
        // TEMP DIAGNOSTIC LOGGING — remove once the "Couldn't reach
        // SousChef" client-side reports are root-caused. Confirms Claude
        // actually returned successfully before anything downstream of
        // this point could fail. Shape/size only, never the prompt or reply.
        console.log('[TEMP DIAGNOSTIC] Anthropic response received', {
          stopReason,
          textLength: text.length,
          outputTokens: response.usage?.output_tokens,
        });
        if (stopReason === 'max_tokens') {
          // DIAGNOSTIC — not an error (the caller still gets a usable, just
          // possibly incomplete, reply), so this only warns rather than
          // failing the request. Logs shape/size, never the prompt, the
          // reply text, or anything from the request/response headers.
          console.warn('[SousChef] Claude response hit MAX_TOKENS — reply may be truncated', {
            model: MODEL,
            maxTokens: MAX_TOKENS,
            outputTokens: response.usage?.output_tokens,
          });
        }

        return { ok: true, message: text, stopReason };
      } catch (error) {
        // ---- TEMP DIAGNOSTIC LOGGING — remove once the "workspace ID" 400 is
        // root-caused (see app/api/recipe-chat+api.ts for the matching log at
        // the call site). Only ever reads status/type/headers off the SDK's
        // own error object — never the request, the API key, or the
        // Authorization/X-Api-Key headers we sent. `error.headers` here are
        // the *response* headers Anthropic sent back, not our request
        // headers, but they're redacted below anyway as a defensive measure.
        if (error instanceof Anthropic.APIError) {
          console.error('[TEMP DIAGNOSTIC] Anthropic API error', {
            status: error.status,
            errorClass: error.name,
            errorType: error.type,
            message: error.message,
            body: error.error, // parsed { type, message } from Anthropic's JSON error body, if any
            requestId: error.requestID,
            workspaceIdHeader: error.workspaceID,
            responseHeaders: redactHeaders(error.headers),
          });
        } else {
          console.error('[TEMP DIAGNOSTIC] Non-API error contacting Claude', {
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        // ---- end TEMP DIAGNOSTIC LOGGING

        return { ok: false, error: { code: 'request-failed', message: describeError(error) } };
      }
    },
  };
}

// TEMP DIAGNOSTIC LOGGING helper — remove alongside the console.error calls
// above. Strips any header that could carry credentials before logging, even
// though `error.headers` is Anthropic's response, not our request.
const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'x-api-key', 'cookie', 'set-cookie']);
function redactHeaders(headers: Headers | undefined): Record<string, string> {
  if (!headers) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    result[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? '[redacted]' : value;
  }
  return result;
}

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

// Maps Anthropic's vendor-specific stop_reason onto the provider-agnostic
// ChatStopReason (see ai/types.ts). "end_turn" and "stop_sequence" both mean
// the model finished on its own; everything else this feature doesn't use
// (tool_use, pause_turn, refusal) falls back to "other" rather than growing
// ChatStopReason to match Anthropic's full vocabulary.
function toChatStopReason(stopReason: Anthropic.Message['stop_reason']): ChatStopReason {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'complete';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'other';
  }
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Claude rejected the configured API key.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Claude is rate-limiting requests right now — try again shortly.';
  }
  if (error instanceof Anthropic.APIError) {
    return `Claude API error (${error.status}): ${error.message}`;
  }
  return error instanceof Error ? error.message : 'Unknown error contacting Claude.';
}
