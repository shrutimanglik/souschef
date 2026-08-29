/**
 * The Instagram recipe-source-discovery agent.
 *
 * Given an Instagram Reel/post URL, this runs a small Claude tool-use loop
 * that REASONS about where the original recipe actually lives — it does
 * not follow a fixed Instagram -> search -> fetch -> extract sequence.
 * Claude decides, turn by turn, which of its six research tools to call
 * next based on what it has learned so far, and concludes by calling
 * report_result. See the system prompt below for the full contract,
 * including the evidence-reasoning framework that governs when the
 * transcript is worth its credit cost versus not, when web discovery is
 * worth attempting (e.g. a caption saying "comment X and I'll DM you the
 * recipe" is evidence the recipe isn't written down publicly, so search
 * for the creator's own page instead), and when the recipe is already
 * fully present as text — a caption or transcript — rather than needing a
 * source webpage at all. That reasoning lives entirely in the prompt and
 * tool descriptions below, not as code-level routing logic.
 *
 * V1 scope note: Instagram comments were evaluated as a possible evidence
 * source (see conversation history) and are deliberately NOT a production
 * tool here — retrieving a specific creator-authored comment turned out to
 * require either an expensive, unbounded search (posts can have hundreds
 * of comments, returned newest-first with no sort/filter/search capability
 * on the provider side) or accepting a low hit rate, neither of which fit
 * a per-request tool budget. Nothing about that finding is Instagram-API-
 * specific to this codebase; if comments are revisited, it would likely
 * need an out-of-band/cached retrieval strategy, not a live agent tool.
 *
 * Deliberate separation from extraction/ (the deterministic pipeline):
 * this file never fetches HTML for parsing, never touches JSON-LD, never
 * normalizes or validates a recipe. Its relationship to that pipeline is
 * calling the existing extractRecipeFromUrl as a tool (see
 * agent/tools/extract-recipe.ts) once Claude believes it has found the
 * right page — the deterministic pipeline remains the only place a
 * canonical Recipe is constructed from a webpage. The separate
 * extract_recipe_from_text tool (agent/tools/extract-recipe-from-text.ts)
 * covers the case that pipeline structurally can't: a recipe that only
 * ever existed as text (a caption, a transcript) and never lived on a
 * fetchable page — see ai/providers/anthropic-text-recipe.ts. Both tools
 * converge on the exact same canonical Recipe shape.
 *
 * Manual tool-use loop (not the SDK's beta tool runner) — see the
 * "before coding" note in conversation for why: full control over the
 * per-turn tool-call log the dev CLI prints, and a custom stop condition
 * (report_result) rather than "no more tool calls".
 */

import type Anthropic from '@anthropic-ai/sdk';

import { AnthropicTextRecipeExtractor } from '@/ai';
import type { RecipeTextSourceType, TextRecipeExtractor } from '@/ai';
import { createAnthropicClient } from '@/ai/providers/anthropic';
import type { ExtractionResult } from '@/extraction';

import { isInstagramUrl } from './lib/instagram-url';
import { ScrapeCreatorsInstagramProvider } from './providers/scrapecreators-instagram';
import { ScrapeCreatorsTranscriptProvider } from './providers/scrapecreators-transcript';
import { extractRecipeFromCandidateUrl, summarizeExtractionResult } from './tools/extract-recipe';
import { extractRecipeFromCandidateText } from './tools/extract-recipe-from-text';
import { fetchPage } from './tools/fetch-page';
import { getInstagramMetadata } from './tools/instagram-metadata';
import { AnthropicWebSearchProvider, searchWeb } from './tools/web-search';
import type {
  AgentConfidence,
  AgentToolCallLogEntry,
  InstagramAgentResult,
  InstagramMetadataProvider,
  InstagramTranscriptProvider,
  SearchProvider,
} from './types';

const TEXT_SOURCE_TYPES: RecipeTextSourceType[] = ['instagram-caption', 'video-transcript', 'comment', 'ocr', 'manual'];

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;
// A "turn" is one assistant response (which may itself contain several
// parallel tool calls). Bounds cost/latency and guarantees the loop always
// terminates — required regardless of how well the agent reasons.
const MAX_TURNS = 8;

const SYSTEM_PROMPT = `You are a recipe source discovery agent. Given an Instagram Reel, your goal is to find the most authoritative recipe source represented by that Reel.

Prefer the original recipe published by the creator/blogger over secondary copies, roundups, or aggregator sites that reposted it.

You have tools for Instagram metadata, a Reel's spoken-audio transcript, web search, page inspection, and two separate recipe extractors:
- get_instagram_metadata: read whatever public metadata the Reel's page exposes (creator, caption, any external link).
- get_instagram_transcript: transcribe the Reel's spoken audio (videos under 2 minutes only).
- search_web: search the public web for candidate recipe pages.
- fetch_page: look closely at one candidate page (title + readable text) to judge whether it's the original recipe page.
- extract_recipe_from_url: run the existing deterministic recipe extractor (structured page data, no model involved) against a URL you believe is the original recipe page.
- extract_recipe_from_text: run an LLM-based extractor against a piece of text you already have (a caption, a transcript) that appears to contain a recipe itself.

Reason about the evidence you have and decide which tool to use next — there is no fixed sequence and no tool is mandatory. A typical path might be: inspect Instagram metadata, identify the creator and recipe name, search the web for them, inspect one or more candidate pages, decide which (if any) is the original, then extract from it. But follow the evidence, not this example — e.g. if Instagram metadata already includes a direct external link, you may go straight to fetch_page or extract_recipe_from_url on it; if the caption already contains the whole recipe, you may go straight to extract_recipe_from_text and never touch search_web, fetch_page, or the transcript at all.

Two extractors, and when each applies:
- extract_recipe_from_url is deterministic (parses the page's own structured data) and more reliable than a model reading prose — prefer it whenever a real recipe webpage exists and you're confident you've found it.
- extract_recipe_from_text exists for recipes that never lived on a fetchable webpage at all — the recipe is the caption, or the recipe is what was said in the video. Don't force a URL search when the recipe you need is already sitting in text you've already retrieved. If a caption looks complete and self-contained (title/ingredients/steps all present), extract directly from it rather than searching the web or fetching a transcript to "confirm" what you can already see. If a caption is only partial (e.g. names the dish but not the method, or vice versa), gathering more evidence first (transcript, search) before extracting is often better than extracting from an incomplete source.
- A transcript that turns out to contain a recipe is just more text — feed it to extract_recipe_from_text the same way you would a caption. The same will eventually be true of OCR output, when that tool exists. A transcript that turns out to be promotional or otherwise non-recipe content is not a recipe — don't force extract_recipe_from_text on it just because you already paid to transcribe it; report that no recipe was found instead.

Evidence and tool choice:
The transcript costs real credits and isn't always worth calling. Let the specific evidence you already have tell you whether a source is likely to pay off — these are illustrative examples of that reasoning, not a checklist to run through or a fixed order:
- The caption itself already contains real recipe detail (an ingredient list, method) → that's usable evidence on its own; extract from it directly rather than searching or transcribing to "confirm" it.
- The caption mentions "link in bio", a website, or a blog with no direct URL in the metadata → search for the creator's own site/blog rather than assuming it's unreachable.
- The caption says something like "Comment BURGER and I'll DM you the recipe" → the recipe isn't written down anywhere public in the caption. Use the creator and the dish/recipe name as evidence to search the web for the creator's own recipe page — that's more likely to pay off than guessing at the recipe from a two-line caption.
- The caption is thin, but the creator appears to narrate the recipe out loud in the video → a transcript may surface what the caption doesn't.
- The recipe appears to be shown only as on-screen text/visuals with no narration and no caption detail → you have no way to inspect that (no visual/OCR tool is available to you). Treat this as evidence being genuinely insufficient rather than guessing.

Private Instagram DMs cannot be retrieved through any tool available to you. Never attempt to retrieve or approximate a DM's contents — that evidence is genuinely inaccessible. When a caption signals a DM-based recipe, the correct response is to look elsewhere (usually a web search), not to guess at what might have been sent.

Rules:
- Do not invent recipe information, a creator name, or a URL. Only report what your tools and extractors actually returned.
- Never describe, summarize, or write out the recipe yourself — always produce it by calling extract_recipe_from_url (for a webpage) or extract_recipe_from_text (for text you already have). You are finding and extracting from evidence, not authoring a recipe.
- If extraction fails (from a URL or from text), you may continue gathering evidence for a better source, or conclude that none was found — don't guess at a worse candidate just to have an answer.
- Prefer the creator's own site/blog over content platforms that merely mention them, and over other creators' unrelated recipes.
- Stop when you have a sufficiently reliable recipe (either extractor succeeded on a source you're confident is the original) or when the available evidence is insufficient to go further — both are valid outcomes.
- You have a limited number of turns. Don't repeat a tool call with the same input, and don't call fetch_page or get_instagram_transcript on something you already have good evidence about (or good evidence against).

When you are done — whether or not you found a reliable source — call report_result exactly once, as your last action. Never end without calling it.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_instagram_metadata',
    description:
      "Fetches whatever publicly accessible metadata is available for an Instagram Reel/post URL — creator username, profile URL, caption, title/description, any external URL mentioned, and warnings about anything missing. Use this first on the Instagram URL to see what evidence is available before searching the web. Does not log in or bypass any access control; results are often partial.",
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The Instagram Reel/post URL.' } },
      required: ['url'],
    },
  },
  {
    name: 'get_instagram_transcript',
    description:
      "Transcribes the Reel's spoken audio — not any on-screen visual text, which you have no way to inspect. Useful when the caption gives little detail but the creator appears to narrate the recipe (ingredients/steps spoken aloud) in the video itself. Only works for videos under 2 minutes, and returns no transcript if the video is silent or too long — not a hard failure, just means this evidence isn't available. If a creator/recipe name is already known from the caption, searching the web for their own recipe page is often faster and more reliable than transcribing.",
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The Instagram Reel/post URL.' } },
      required: ['url'],
    },
  },
  {
    name: 'search_web',
    description:
      'Searches the public web and returns a small set of real candidate results (title, url, snippet, domain) — never invented. Use this once you know the creator and/or recipe name, e.g. "<creator name> <recipe name> recipe".',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query.' } },
      required: ['query'],
    },
  },
  {
    name: 'fetch_page',
    description:
      "Fetches a candidate webpage and returns its title and a truncated readable-text summary — enough to judge whether it's the original recipe page (vs. a copy, aggregator, or unrelated page). Not full extraction — use extract_recipe_from_url for that once you're confident.",
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The candidate page URL.' } },
      required: ['url'],
    },
  },
  {
    name: 'extract_recipe_from_url',
    description:
      "Runs SousChef's existing deterministic recipe extraction pipeline (JSON-LD parsing, normalization, validation) against a URL you believe is the original recipe page. Call this once you're confident, not to explore — use fetch_page for exploring. If it fails, the page likely has no structured recipe data; you may keep searching for a better source.",
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The URL to extract a recipe from.' } },
      required: ['url'],
    },
  },
  {
    name: 'extract_recipe_from_text',
    description:
      "Runs an LLM-based extractor against a piece of text you already have — an Instagram caption, a transcript — that appears to contain a recipe itself, rather than pointing at one elsewhere. Use this when the recipe is already sitting in text you've retrieved (a caption that lists ingredients/steps, a transcript that narrates them), not as a way to explore or verify an unclear source — use extract_recipe_from_url instead whenever a real recipe webpage exists, since deterministic extraction from a page is more reliable than a model reading prose. Never invents missing information; ambiguous or missing details come back as warnings, not guesses.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The recipe-bearing text itself — the caption or transcript content you already retrieved.' },
        sourceType: {
          type: 'string',
          enum: ['instagram-caption', 'video-transcript', 'comment', 'ocr', 'manual'],
          description: 'Where this text came from.',
        },
        sourceUrl: { type: 'string', description: "The Instagram URL this text is associated with — normally the Reel's own URL." },
        creatorName: {
          type: 'string',
          description: "The creator's name, if already known (e.g. from get_instagram_metadata) — helps attribute the recipe correctly.",
        },
      },
      required: ['text', 'sourceType'],
    },
  },
  {
    name: 'report_result',
    description:
      "Call this exactly once, as your final action, to report what you found — whether or not you found a reliable source. If none was found, set selectedSourceUrl to an empty string and explain why in discovery/warnings. Never invent a source just to have something to report.",
    input_schema: {
      type: 'object',
      properties: {
        selectedSourceUrl: {
          type: 'string',
          description: 'The recipe webpage URL you selected as most authoritative, or an empty string if none was found.',
        },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        discovery: { type: 'string', description: 'Brief account of the evidence trail — how you found/chose this source (or why you did not).' },
        warnings: { type: 'array', items: { type: 'string' }, description: 'Anything uncertain, missing, or worth double-checking.' },
      },
      required: ['selectedSourceUrl', 'confidence', 'discovery', 'warnings'],
    },
  },
];

function getStringInput(input: unknown, field: string): string | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

/** Runs one tool by name. Always returns a result — a failed tool call becomes a `tool_result` with `is_error: true`, per the SDK's documented pattern, rather than throwing and aborting the whole agent run. */
async function executeTool(
  name: string,
  input: unknown,
  searchProvider: SearchProvider,
  instagramProvider: InstagramMetadataProvider,
  transcriptProvider: InstagramTranscriptProvider,
  textExtractor: TextRecipeExtractor,
  extractionsByUrl: Map<string, ExtractionResult>
): Promise<{ ok: boolean; resultText: string; summary: string }> {
  switch (name) {
    case 'get_instagram_metadata': {
      const url = getStringInput(input, 'url');
      if (!url) {
        return { ok: false, resultText: 'Missing required "url".', summary: 'missing url' };
      }
      const result = await getInstagramMetadata(instagramProvider, url);
      // Full normalized metadata, not just a one-line digest — this is the
      // one tool call the dev CLI needs to show completely (see the
      // "before coding" testing requirements), and it's already log-safe:
      // InstagramMetadata never carries the API key or raw provider JSON.
      const summary = result.ok ? JSON.stringify(result.metadata) : `failed: ${result.error.message}`;
      return { ok: result.ok, resultText: JSON.stringify(result), summary };
    }
    case 'get_instagram_transcript': {
      const url = getStringInput(input, 'url');
      if (!url) {
        return { ok: false, resultText: 'Missing required "url".', summary: 'missing url' };
      }
      const result = await transcriptProvider.getTranscript(url);
      const summary = result.ok
        ? result.transcripts.some((item) => item.text)
          ? `${result.transcripts.length} item(s), ${result.transcripts.reduce((n, item) => n + (item.text?.length ?? 0), 0)} chars`
          : 'no speech detected'
        : `failed: ${result.error.message}`;
      return { ok: result.ok, resultText: JSON.stringify(result), summary };
    }
    case 'search_web': {
      const query = getStringInput(input, 'query');
      if (!query) {
        return { ok: false, resultText: 'Missing required "query".', summary: 'missing query' };
      }
      const result = await searchWeb(searchProvider, query);
      const summary = result.ok ? `${result.results.length} result(s) for "${query}"` : `failed: ${result.error.message}`;
      return { ok: result.ok, resultText: JSON.stringify(result), summary };
    }
    case 'fetch_page': {
      const url = getStringInput(input, 'url');
      if (!url) {
        return { ok: false, resultText: 'Missing required "url".', summary: 'missing url' };
      }
      const result = await fetchPage(url);
      const summary = result.ok
        ? `"${result.page.title ?? '(untitled)'}" (${result.page.content.length} chars${result.page.truncated ? ', truncated' : ''})`
        : `failed: ${result.error.message}`;
      return { ok: result.ok, resultText: JSON.stringify(result), summary };
    }
    case 'extract_recipe_from_url': {
      const url = getStringInput(input, 'url');
      if (!url) {
        return { ok: false, resultText: 'Missing required "url".', summary: 'missing url' };
      }
      const result = await extractRecipeFromCandidateUrl(url);
      extractionsByUrl.set(url, result);
      return { ok: result.ok, resultText: JSON.stringify(result), summary: summarizeExtractionResult(result) };
    }
    case 'extract_recipe_from_text': {
      const text = getStringInput(input, 'text');
      const sourceTypeRaw = getStringInput(input, 'sourceType');
      if (!text) {
        return { ok: false, resultText: 'Missing required "text".', summary: 'missing text' };
      }
      if (!sourceTypeRaw || !TEXT_SOURCE_TYPES.includes(sourceTypeRaw as RecipeTextSourceType)) {
        return {
          ok: false,
          resultText: `"sourceType" must be one of: ${TEXT_SOURCE_TYPES.join(', ')}.`,
          summary: 'invalid sourceType',
        };
      }
      const sourceUrl = getStringInput(input, 'sourceUrl') ?? undefined;
      const creatorName = getStringInput(input, 'creatorName') ?? undefined;

      const result = await extractRecipeFromCandidateText(textExtractor, {
        text,
        sourceType: sourceTypeRaw as RecipeTextSourceType,
        sourceUrl,
        creatorName,
      });
      // Keyed the same way as extract_recipe_from_url's results, so
      // finalizeFromReport's lookup (by report_result's selectedSourceUrl)
      // works identically regardless of which extractor produced it — as
      // long as the agent passes the same URL to both. For this agent,
      // that's always the Instagram Reel URL itself.
      if (sourceUrl) {
        extractionsByUrl.set(sourceUrl, result);
      }
      return { ok: result.ok, resultText: JSON.stringify(result), summary: summarizeExtractionResult(result) };
    }
    default:
      return { ok: false, resultText: `Unknown tool "${name}".`, summary: 'unknown tool' };
  }
}

function toConfidence(value: unknown): AgentConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function finalizeFromReport(
  turn: number,
  block: Anthropic.ToolUseBlock,
  extractionsByUrl: Map<string, ExtractionResult>,
  toolCalls: AgentToolCallLogEntry[]
): InstagramAgentResult {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const selectedSourceUrl = getStringInput(input, 'selectedSourceUrl')?.trim() || null;
  const confidence = toConfidence(input.confidence);
  const discovery = getStringInput(input, 'discovery')?.trim() || '(no discovery notes provided)';
  const warnings = Array.isArray(input.warnings) ? input.warnings.filter((w): w is string => typeof w === 'string') : [];

  let extraction: ExtractionResult | null = null;
  if (selectedSourceUrl) {
    extraction = extractionsByUrl.get(selectedSourceUrl) ?? null;
    if (!extraction) {
      warnings.push(
        'A source URL was selected but neither extract_recipe_from_url nor extract_recipe_from_text produced a result for it.'
      );
    }
  }

  toolCalls.push({
    turn,
    tool: 'report_result',
    input: block.input,
    ok: true,
    summary: selectedSourceUrl ? `selected ${selectedSourceUrl} (${confidence} confidence)` : 'no reliable source found',
  });

  return { ok: true, selectedSourceUrl, confidence, discovery, extraction, warnings, toolCalls };
}

function insufficientEvidenceResult(discovery: string, toolCalls: AgentToolCallLogEntry[]): InstagramAgentResult {
  return {
    ok: true,
    selectedSourceUrl: null,
    confidence: 'low',
    discovery,
    extraction: null,
    warnings: [discovery],
    toolCalls,
  };
}

export async function runInstagramRecipeAgent(
  instagramUrl: string,
  apiKey: string | undefined,
  scrapeCreatorsApiKey: string | undefined
): Promise<InstagramAgentResult> {
  if (!isInstagramUrl(instagramUrl)) {
    return { ok: false, error: { code: 'invalid-url', message: 'That does not look like an instagram.com URL.' }, toolCalls: [] };
  }
  if (!apiKey) {
    return { ok: false, error: { code: 'agent-failed', message: 'ANTHROPIC_API_KEY is not configured.' }, toolCalls: [] };
  }
  if (!scrapeCreatorsApiKey) {
    return { ok: false, error: { code: 'agent-failed', message: 'SCRAPECREATORS_API_KEY is not configured.' }, toolCalls: [] };
  }

  const client = createAnthropicClient(apiKey);
  const searchProvider = new AnthropicWebSearchProvider(client);
  const instagramProvider = new ScrapeCreatorsInstagramProvider(scrapeCreatorsApiKey);
  const transcriptProvider = new ScrapeCreatorsTranscriptProvider(scrapeCreatorsApiKey);
  // Same client the tool-use loop itself uses — one Anthropic client per
  // run, reused for both conversing with the agent and (separately, one
  // call at a time) running text-based recipe extraction.
  const textExtractor = new AnthropicTextRecipeExtractor(client);
  const toolCalls: AgentToolCallLogEntry[] = [];
  const extractionsByUrl = new Map<string, ExtractionResult>();

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `Instagram URL: ${instagramUrl}` }];

  try {
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      messages.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

      const reportBlock = toolUseBlocks.find((b) => b.name === 'report_result');
      if (reportBlock) {
        return finalizeFromReport(turn, reportBlock, extractionsByUrl, toolCalls);
      }

      if (toolUseBlocks.length === 0) {
        return insufficientEvidenceResult(
          'The agent stopped without reporting a conclusion (no tool call and no report_result).',
          toolCalls
        );
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const { ok, resultText, summary } = await executeTool(
          block.name,
          block.input,
          searchProvider,
          instagramProvider,
          transcriptProvider,
          textExtractor,
          extractionsByUrl
        );
        toolCalls.push({ turn, tool: block.name, input: block.input, ok, summary });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText, is_error: !ok });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    return insufficientEvidenceResult(`Reached the ${MAX_TURNS}-turn limit before the agent reported a conclusion.`, toolCalls);
  } catch (error) {
    return {
      ok: false,
      error: { code: 'agent-failed', message: error instanceof Error ? error.message : 'Agent run failed.' },
      toolCalls,
    };
  }
}
