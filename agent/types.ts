/**
 * Shared types for the Instagram recipe-source-discovery agent.
 *
 * Deliberately framework-agnostic — no Expo/React Native imports, same
 * discipline as ai/types.ts and extraction/types.ts — so this can run from
 * the dev CLI (agent/dev-instagram-agent.ts) today and from a server route
 * later without change.
 *
 * This module is intentionally separate from extraction/ — see
 * extraction/types.ts's own header comment: that pipeline is the
 * deterministic URL -> Recipe funnel (fetch -> JSON-LD -> normalize ->
 * validate). This agent never reimplements any of that; its only relation
 * to extraction/ is calling the existing extractRecipeFromUrl as a tool
 * (see agent/tools/extract-recipe.ts) once it believes it has found the
 * right URL.
 */

import type { ExtractionResult } from '@/extraction';

export type InstagramMetadata = {
  instagramUrl: string;
  creatorUsername: string | null;
  /** The creator's display name (e.g. "Adrian Horning"), distinct from the @username. */
  creatorFullName: string | null;
  creatorProfileUrl: string | null;
  caption: string | null;
  title: string | null;
  description: string | null;
  /** Links found in the caption/page that point off Instagram — candidate original-recipe URLs. */
  externalUrls: string[];
  /** The Reel's own video (or image, for a non-video post) URL, if the provider returned one — see agent/providers/scrapecreators-instagram.ts for how short-lived this typically is. Not used for anything in V1 (no video/audio/OCR tools yet); carried through because it's useful metadata a future stage will want. */
  mediaUrl: string | null;
  mediaType: 'video' | 'image' | null;
  /** e.g. "Could not determine creator username", "Page returned no usable caption/description". Informational, not blocking — mirrors ExtractionWarning's role in extraction/types.ts. */
  warnings: string[];
};

export type AgentErrorCode = 'invalid-url' | 'fetch-failed' | 'agent-failed';

export type AgentError = {
  code: AgentErrorCode;
  message: string;
};

export type InstagramMetadataResult =
  | { ok: true; metadata: InstagramMetadata }
  | { ok: false; error: AgentError };

/**
 * The provider-swap boundary for get_instagram_metadata — same pattern as
 * SearchProvider below. V1 ships exactly one implementation
 * (agent/providers/scrapecreators-instagram.ts), but the tool
 * (agent/tools/instagram-metadata.ts) and the agent loop only ever see
 * this interface, never a provider-specific shape. A second provider, or a
 * fallback chain between providers, is a new implementation behind this
 * interface — never a change to the tool's signature or the agent loop.
 */
export interface InstagramMetadataProvider {
  readonly name: string;
  getMetadata(url: string): Promise<InstagramMetadataResult>;
}

/** One candidate search hit — never fabricated, always sourced from a real search provider call. See SearchProvider below. */
export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
};

export type SearchResultsResult =
  | { ok: true; results: SearchResult[] }
  | { ok: false; error: AgentError };

/**
 * The whole provider-swap boundary for search_web — V1 ships exactly one
 * implementation (agent/tools/web-search.ts's AnthropicWebSearchProvider,
 * backed by Anthropic's own server-side web_search tool, no new
 * credential), but nothing in the agent loop or tool schema knows that.
 * A future provider (Brave, Google CSE, Bing) is a second file behind this
 * interface, not a rewrite of any call site — the same pattern as
 * ChatProvider in ai/types.ts.
 */
export interface SearchProvider {
  readonly name: string;
  search(query: string, maxResults: number): Promise<SearchResultsResult>;
}

export type FetchedPageSummary = {
  /** The URL actually fetched, after following redirects — may differ from the requested url. */
  finalUrl: string;
  title: string | null;
  /** Truncated plain text — see agent/lib/html.ts's htmlToPlainText. Never the full raw HTML. */
  content: string;
  /** true if `content` was cut short to keep the tool result small. */
  truncated: boolean;
  warnings: string[];
};

export type FetchPageResult =
  | { ok: true; page: FetchedPageSummary }
  | { ok: false; error: AgentError };

/** One transcribed item for a Reel/post — usually one, but a carousel post can have several video items. */
export type InstagramTranscriptItem = {
  id: string | null;
  shortcode: string | null;
  /** Null specifically means no speech was detected — see agent/providers/scrapecreators-transcript.ts. Not an error. */
  text: string | null;
};

export type InstagramTranscriptResult =
  | { ok: true; transcripts: InstagramTranscriptItem[]; creditsCharged: number | null }
  | { ok: false; error: AgentError };

/**
 * The provider-swap boundary for Instagram transcripts — same pattern as
 * the other three above. V1 ships exactly one implementation
 * (agent/providers/scrapecreators-transcript.ts).
 */
export interface InstagramTranscriptProvider {
  readonly name: string;
  getTranscript(url: string): Promise<InstagramTranscriptResult>;
}

/**
 * One row of the agent's tool-call trace — what the dev CLI (see
 * agent/dev-instagram-agent.ts) prints so a run's evidence trail is
 * inspectable. `input`/`summary` are logging-safe by construction: tool
 * inputs are just URLs/queries, and `summary` is a short line the tool
 * itself produces, never a dump of a full page/caption.
 */
export type AgentToolCallLogEntry = {
  turn: number;
  tool: string;
  input: unknown;
  ok: boolean;
  summary: string;
};

export type AgentConfidence = 'high' | 'medium' | 'low';

/**
 * The agent's structured verdict — always returned, whether or not a
 * source was found. A "couldn't find a reliable source" outcome is a
 * normal `ok: true` result with `selectedSourceUrl: null`, not an error
 * (see report_result's tool description in instagram-recipe-agent.ts) —
 * `ok: false` is reserved for the agent genuinely failing to run (bad
 * input URL, API error, turn limit with no report_result call at all).
 */
export type InstagramAgentResult =
  | {
      ok: true;
      selectedSourceUrl: string | null;
      confidence: AgentConfidence;
      discovery: string;
      /** The existing pipeline's own result for selectedSourceUrl, untouched shape — null if no source was selected or extraction was never run. */
      extraction: ExtractionResult | null;
      warnings: string[];
      toolCalls: AgentToolCallLogEntry[];
    }
  | {
      ok: false;
      error: AgentError;
      toolCalls: AgentToolCallLogEntry[];
    };
