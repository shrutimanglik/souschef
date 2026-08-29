/**
 * search_web — the agent's way of finding candidate recipe pages once it
 * knows a creator/recipe name (from get_instagram_metadata) or wants a
 * second opinion after a candidate page turned out wrong.
 *
 * Implements SearchProvider (agent/types.ts) against Anthropic's own
 * server-side web_search tool rather than a third-party search API — see
 * the header comment on AnthropicWebSearchProvider below for why, and why
 * that stays a real SearchProvider implementation instead of a special
 * case: swapping in Brave/Google/Bing later is a second file behind the
 * same interface, not a rewrite of this tool or the agent loop.
 */

import type Anthropic from '@anthropic-ai/sdk';

import type { SearchProvider, SearchResult, SearchResultsResult } from '../types';

const MODEL = 'claude-sonnet-5';

/**
 * V1's only SearchProvider. Anthropic's web_search_20260209 is a
 * server-side tool — Claude runs the actual search and dynamic filtering
 * on Anthropic's infrastructure, so this needs no separate search-provider
 * credential or client library, only the ANTHROPIC_API_KEY already
 * configured for this app (see ai/providers/anthropic.ts).
 *
 * The raw web_search_tool_result block only carries `title`/`url` plus an
 * `encrypted_content` blob that's opaque to us by design (meant to be
 * replayed back to Claude, not read client-side) — there's no plain-text
 * snippet on the block itself. So this makes one isolated
 * `messages.create` call: web_search is declared as a tool, Claude
 * searches, then (per the system prompt below) reports back a small JSON
 * array shaped exactly like SearchResult. Validated live against a real
 * query before wiring this up — Claude reliably finds real pages and
 * reports genuine titles/URLs/snippets, never inventing a result when the
 * search comes back empty (the prompt says so explicitly).
 */
export class AnthropicWebSearchProvider implements SearchProvider {
  readonly name = 'anthropic-web-search';

  constructor(private readonly client: Anthropic) {}

  async search(query: string, maxResults: number): Promise<SearchResultsResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { ok: false, error: { code: 'invalid-url', message: 'Empty search query.' } };
    }

    try {
      const requestMessages: Anthropic.MessageParam[] = [
        { role: 'user', content: `Search query: ${trimmed}\n\nReturn up to ${maxResults} results.` },
      ];
      const tools = [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 1 }];

      let response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system:
          'Use the web_search tool exactly once for the query below, then reply with ONLY a JSON array ' +
          '(no prose, no markdown fences) of up to N results you actually found, each shaped as ' +
          '{"title":"...","url":"...","snippet":"...","domain":"..."}. Never invent a result — if the search ' +
          'returns nothing useful, reply with an empty array: [].',
        tools,
        messages: requestMessages,
      });

      // Server-side tool loops can hit their internal iteration cap and
      // return pause_turn instead of a final answer — resume once by
      // re-sending the same exchange, per Anthropic's documented pattern
      // (append the paused assistant turn, don't add a "continue" message).
      if (response.stop_reason === 'pause_turn') {
        response = await this.client.messages.create({
          model: MODEL,
          max_tokens: 2048,
          tools,
          messages: [...requestMessages, { role: 'assistant', content: response.content }],
        });
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      return { ok: true, results: parseSearchResults(text, maxResults) };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'fetch-failed', message: error instanceof Error ? error.message : 'Web search failed.' },
      };
    }
  }
}

function parseSearchResults(text: string, maxResults: number): SearchResult[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && typeof (item as Record<string, unknown>).url === 'string'
    )
    .map(
      (item): SearchResult => ({
        title: typeof item.title === 'string' ? item.title : '',
        url: item.url as string,
        snippet: typeof item.snippet === 'string' ? item.snippet : '',
        domain: typeof item.domain === 'string' ? item.domain : safeHostname(item.url as string),
      })
    )
    .slice(0, maxResults);
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export async function searchWeb(provider: SearchProvider, query: string, maxResults = 5): Promise<SearchResultsResult> {
  return provider.search(query, maxResults);
}
