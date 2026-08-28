import { askAboutRecipe, createAnthropicProvider, type ChatMessage } from '@/ai';
import { normalizeRecipe } from '@/constants/recipes';

// Runs server-side (Expo Router API route — same pattern as
// app/api/extract-recipe+api.ts). This is the one place ANTHROPIC_API_KEY
// is read: the key must never reach the client bundle, and constructing
// the Anthropic provider here (rather than inside ai/) keeps ai/ itself
// free of any direct process.env access.
export async function POST(request: Request) {
  // TEMP DIAGNOSTIC LOGGING — remove once the "Couldn't reach SousChef"
  // client-side reports are root-caused. Confirms the request actually
  // reaches this route at all; never logs the body.
  console.log('[TEMP DIAGNOSTIC] recipe-chat POST received', {
    contentType: request.headers.get('content-type'),
  });

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

  // TEMP DIAGNOSTIC LOGGING — remove alongside the rest of this batch.
  // Confirms the request body parsed into a valid recipe/message shape
  // before it's handed to Claude; counts only, never content.
  console.log('[TEMP DIAGNOSTIC] recipe-chat request parsed', {
    ingredientCount: recipe.ingredients.length,
    instructionCount: recipe.instructions.length,
    messageCount: messages.length,
  });

  const provider = createAnthropicProvider(process.env.ANTHROPIC_API_KEY);
  const result = await askAboutRecipe(provider, recipe, messages);

  if (!result.ok) {
    // TEMP DIAGNOSTIC LOGGING — remove once the "workspace ID" 400 is
    // root-caused. This is the propagated, already-stringified error; the
    // richer SDK fields (status/type/headers) are logged in
    // ai/providers/anthropic.ts, the only place the raw SDK error is
    // available. Never logs the API key or request headers/body.
    console.error('[TEMP DIAGNOSTIC] recipe-chat request failed', {
      code: result.error.code,
      message: result.error.message,
    });
    const status = result.error.code === 'missing-api-key' ? 500 : 502;
    return Response.json({ ok: false, error: result.error }, { status });
  }
  // TEMP DIAGNOSTIC LOGGING — remove alongside the rest of this batch.
  // Confirms a 200 actually left this route with the expected shape.
  console.log('[TEMP DIAGNOSTIC] recipe-chat responding ok', {
    messageLength: result.message.length,
    suggestionCount: result.suggestions.length,
  });
  return Response.json({ ok: true, message: result.message, suggestions: result.suggestions });
}
