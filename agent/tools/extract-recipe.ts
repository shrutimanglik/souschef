/**
 * extract_recipe_from_url — exposes the EXISTING deterministic extraction
 * pipeline (extraction/extract-recipe.ts: fetch -> JSON-LD -> normalize ->
 * validate -> canonical Recipe) to the agent as a tool, unchanged.
 *
 * This file adds nothing to the pipeline itself — no fetching, no
 * parsing, no normalization. It exists only so the agent loop
 * (instagram-recipe-agent.ts) has one place that turns a tool call into a
 * call to extractRecipeFromUrl and a short, log-safe summary of what came
 * back, the same shape every other tool in agent/tools/ returns.
 */

import { extractRecipeFromUrl } from '@/extraction';
import type { ExtractionResult } from '@/extraction';

export async function extractRecipeFromCandidateUrl(url: string): Promise<ExtractionResult> {
  return extractRecipeFromUrl(url);
}

/** A one-line, log-safe description of an ExtractionResult — never the full recipe (see AgentToolCallLogEntry.summary in types.ts). */
export function summarizeExtractionResult(result: ExtractionResult): string {
  if (!result.ok) {
    return `failed: [${result.error.code}] ${result.error.message}`;
  }
  const r = result.recipe;
  return `"${r.title}" — ${r.ingredients.length} ingredients, ${r.instructions.length} steps (via ${result.recipe.extraction?.method ?? 'unknown'})`;
}
