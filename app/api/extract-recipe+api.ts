import { organizeRecipeIfPossible } from '@/ai';
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

  // A single best-effort LLM call, after extraction, that may group
  // ingredients/instructions into components — never alters recipe facts,
  // and can never fail an extraction that already succeeded. See
  // ai/organize-recipe.ts.
  return Response.json({ ok: true, recipe: await organizeRecipeIfPossible(result.recipe, process.env.ANTHROPIC_API_KEY) });
}
