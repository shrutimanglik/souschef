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
        // Server-side error log for a failed Claude call. Deliberately
        // narrow: the SDK error's own status/type/request id, never the
        // request we sent, the API key, any header, or the prompt/reply
        // text. `requestID` is the one field worth keeping — it's what
        // Anthropic support can correlate against.
        if (error instanceof Anthropic.APIError) {
          console.error('[SousChef] Anthropic API error', {
            status: error.status,
            errorType: error.type,
            message: error.message,
            requestId: error.requestID,
          });
        } else {
          console.error('[SousChef] Could not reach Claude', {
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          });
        }

        return { ok: false, error: { code: 'request-failed', message: describeError(error) } };
      }
    },
  };
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
