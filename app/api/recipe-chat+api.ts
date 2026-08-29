import { askAboutRecipe, createAnthropicProvider, type ChatMessage } from '@/ai';
import { normalizeRecipe } from '@/constants/recipes';

// Runs server-side (Expo Router API route — same pattern as
// app/api/extract-recipe+api.ts). This is the one place ANTHROPIC_API_KEY
// is read: the key must never reach the client bundle, and constructing
// the Anthropic provider here (rather than inside ai/) keeps ai/ itself
// free of any direct process.env access.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: { code: 'invalid-request', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }

  const { recipe: rawRecipe, messages: rawMessages } = (body ?? {}) as {
    recipe?: unknown;
    messages?: unknown;
  };

  if (!rawRecipe || typeof rawRecipe !== 'object') {
    return Response.json(
      { ok: false, error: { code: 'invalid-request', message: 'Missing "recipe".' } },
      { status: 400 }
    );
  }
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return Response.json(
      { ok: false, error: { code: 'invalid-request', message: 'Missing "messages".' } },
      { status: 400 }
    );
  }

  // The recipe is passed by the client rather than looked up server-side —
  // there's no server-side recipe store yet (see contexts/cookbook-library.tsx),
  // and normalizing it here means an older/edited recipe shape can never
  // crash the request the way trusting the client's Recipe object as-is
  // could.
  const recipe = normalizeRecipe('unknown-recipe', rawRecipe);
  const messages = rawMessages
    .filter(
      (message): message is { role?: unknown; content: string } =>
        !!message && typeof message === 'object' && typeof (message as { content?: unknown }).content === 'string'
    )
    .map(
      (message): ChatMessage => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      })
    );

  const provider = createAnthropicProvider(process.env.ANTHROPIC_API_KEY);
  const result = await askAboutRecipe(provider, recipe, messages);

  if (!result.ok) {
    // A missing key is our own misconfiguration (500); anything else is an
    // upstream failure talking to Claude (502). The richer SDK-level error
    // detail is logged in ai/providers/anthropic.ts, the only place the raw
    // SDK error object exists.
    const status = result.error.code === 'missing-api-key' ? 500 : 502;
    return Response.json({ ok: false, error: result.error }, { status });
  }
  return Response.json({ ok: true, message: result.message, suggestions: result.suggestions });
}
