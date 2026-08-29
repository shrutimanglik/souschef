/**
 * extract_recipe_from_text — exposes ai/'s LLM-based text-to-recipe path
 * (see ai/providers/anthropic-text-recipe.ts) to the agent as a tool.
 * Mirrors agent/tools/extract-recipe.ts's role exactly, one level over:
 * that file wraps the deterministic extraction/ pipeline; this one wraps
 * the LLM-based ai/ pipeline. Both return the exact same ExtractionResult
 * shape, so instagram-recipe-agent.ts's report_result handling (see
 * finalizeFromReport) treats either tool's output identically — see
 * summarizeExtractionResult in extract-recipe.ts, reused here unchanged
 * rather than duplicated.
 *
 * This file adds nothing to the extraction logic itself — no prompting,
 * no parsing, no normalization. It exists only so the agent loop has one
 * place that turns a tool call's input into a TextRecipeExtractionInput
 * and calls the provided extractor.
 */

import type { TextRecipeExtractionInput, TextRecipeExtractor } from '@/ai';
import type { ExtractionResult } from '@/extraction';

export async function extractRecipeFromCandidateText(
  extractor: TextRecipeExtractor,
  input: TextRecipeExtractionInput
): Promise<ExtractionResult> {
  return extractor.extract(input);
}
