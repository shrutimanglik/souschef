import { runInstagramRecipeAgent } from '@/agent';
import type { AgentError, InstagramAgentResult } from '@/agent';
import { organizeRecipeIfPossible } from '@/ai';
import type { ExtractionError, ExtractionResult } from '@/extraction';

// Runs server-side (Expo Router API route), same pattern as
// app/api/extract-recipe+api.ts and app/api/recipe-chat+api.ts — this is
// the one place ANTHROPIC_API_KEY and SCRAPECREATORS_API_KEY are read for
// the Instagram flow; both stay out of the client bundle.
//
// Deliberately a second, parallel route rather than a branch inside
// extract-recipe+api.ts: it keeps the deterministic route's behavior
// completely untouched, and it's this file's job — not extraction/'s or
// the agent's — to adapt the agent's richer InstagramAgentResult down to
// the exact same ExtractionResult shape the client already knows how to
// handle. Neither extraction/ nor agent/ needed to change for this.
// AgentError's code ('invalid-url' | 'fetch-failed' | 'agent-failed') is a
// different, narrower union than ExtractionError's — 'agent-failed' (the
// agent itself couldn't run, e.g. a missing API key) has no direct
// equivalent, so it's folded into 'fetch-failed', the closest existing
// meaning ("the extraction attempt failed for reasons outside the URL
// itself"). The other two codes already mean the same thing in both.
function toExtractionError(error: AgentError): ExtractionError {
  return { code: error.code === 'agent-failed' ? 'fetch-failed' : error.code, message: error.message };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return Response.json(
      { ok: false, error: { code: 'invalid-url', message: 'Missing "url" query parameter.' } },
      { status: 400 }
    );
  }

  const agentResult = await runInstagramRecipeAgent(url, process.env.ANTHROPIC_API_KEY, process.env.SCRAPECREATORS_API_KEY);
  const result = toExtractionResult(agentResult);
  if (!result.ok) {
    return Response.json(result);
  }

  // The same best-effort organizing step app/api/extract-recipe+api.ts
  // runs — shared via ai/organize-recipe.ts so the "can never fail an
  // already-successful extraction" guarantee lives in exactly one place.
  return Response.json({ ok: true, recipe: await organizeRecipeIfPossible(result.recipe, process.env.ANTHROPIC_API_KEY) });
}

/**
 * Adapts the agent's result to extraction/'s ExtractionResult — the same
 * shape app/api/extract-recipe+api.ts returns — so app/add/paste-link.tsx
 * and everything downstream of it (preview.tsx, RecipeEditor,
 * contexts/pending-recipe.ts) never need to know which path produced the
 * Recipe. Reuses extraction/'s own existing error codes rather than
 * inventing new ones the client would need to special-case.
 */
function toExtractionResult(result: InstagramAgentResult): ExtractionResult {
  if (!result.ok) {
    return { ok: false, error: toExtractionError(result.error) };
  }
  if (!result.extraction) {
    // A normal, non-error outcome from the agent's own perspective (see
    // InstagramAgentResult's doc comment) — no reliable source was found.
    // From the client's perspective, though, there's no Recipe to preview,
    // so it's surfaced the same way a failed website extraction is.
    return {
      ok: false,
      error: { code: 'no-structured-data', message: result.discovery || "Couldn't find a recipe for that Instagram post." },
    };
  }
  if (!result.extraction.ok) {
    return result.extraction;
  }

  // Fold the agent's own process-level warnings (e.g. "no external site
  // found, extracted from the caption instead") into the recipe's own
  // extraction warnings, so nothing the agent learned along the way is
  // lost on the way into the review screen — same {field, message} shape
  // and same "generic field for a whole-response note" convention
  // ai/providers/anthropic-text-recipe.ts already uses for its own
  // extractor-level warnings.
  const recipe = result.extraction.recipe;
  const agentWarnings = result.warnings.map((message) => ({ field: 'instagram-discovery', message }));
  if (agentWarnings.length === 0) {
    return { ok: true, recipe };
  }
  return {
    ok: true,
    recipe: {
      ...recipe,
      extraction: recipe.extraction
        ? { ...recipe.extraction, warnings: [...recipe.extraction.warnings, ...agentWarnings] }
        : { method: 'ai-text-extraction', fetchedAt: new Date().toISOString(), warnings: agentWarnings },
    },
  };
}
