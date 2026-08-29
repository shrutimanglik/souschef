import { AnthropicRecipeOrganizer } from '@/ai';
import { createAnthropicClient } from '@/ai/providers/anthropic';
import type { Recipe } from '@/constants/recipes';
import { extractRecipeFromUrl } from '@/extraction';

// Runs server-side (Expo Router API route — requires web.output: "server"
// in app.json). Recipe extraction needs real HTML parsing and has to
// happen off-device: React Native has no DOM/HTML parser to read the
// result with, and keeping the fetch+parse logic server-side means one
// implementation shared by every client, with a place to set a realistic
// User-Agent and handle redirects consistently.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return Response.json(
      { ok: false, error: { code: 'invalid-url', message: 'Missing "url" query parameter.' } },
      { status: 400 }
    );
  }

  const result = await extractRecipeFromUrl(url);
  if (!result.ok) {
    return Response.json(result);
  }

  return Response.json({ ok: true, recipe: await organizeIfPossible(result.recipe) });
}

/**
 * A single LLM call, after extraction, that may group ingredients/
 * instructions into components — see
 * ai/providers/anthropic-recipe-organizer.ts. Best-effort and isolated
 * from extraction itself: with no ANTHROPIC_API_KEY configured, or on any
 * organizing problem (including an unexpected throw — belt and suspenders
 * beyond RecipeOrganizer's own contract of never throwing), this falls
 * back to the recipe exactly as extraction produced it. Organizing can
 * never fail an extraction that itself already succeeded.
 */
async function organizeIfPossible(recipe: Recipe): Promise<Recipe> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return recipe;
  }
  try {
    return await new AnthropicRecipeOrganizer(createAnthropicClient(apiKey)).organize(recipe);
  } catch {
    return recipe;
  }
}
