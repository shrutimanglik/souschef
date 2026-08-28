/**
 * Data model for recipe conversations — a user's Q&A thread about one
 * saved recipe.
 *
 * Kept as its own entity, separate from Recipe (constants/recipes.ts): a
 * conversation references a recipe by id and never duplicates or owns
 * recipe data, the same way a Cookbook only references recipe ids rather
 * than embedding recipes (see contexts/cookbook-library.tsx). The recipe
 * stays the single source of truth; a conversation is just a transcript
 * about it.
 */

export type ConversationRole = 'user' | 'assistant';

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  content: string;
  /** ISO timestamp. */
  createdAt: string;
};

export type Conversation = {
  id: string;
  /** The recipe this conversation is about — a reference, not embedded recipe data. */
  recipeId: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
};

function normalizeConversationMessage(raw: unknown): ConversationMessage | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Partial<ConversationMessage>;
  if (typeof value.id !== 'string' || !value.id || typeof value.content !== 'string') {
    return null;
  }
  return {
    id: value.id,
    role: value.role === 'assistant' ? 'assistant' : 'user',
    content: value.content,
    createdAt: typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : new Date(0).toISOString(),
  };
}

/**
 * Upgrades a conversation loaded from storage to the current
 * `Conversation` shape — the same defensive-normalization pattern as
 * `normalizeRecipe` (constants/recipes.ts): persisted data can predate
 * fields added since it was saved. Returns `null` if `raw` isn't even
 * recognizable as a conversation (e.g. missing `recipeId`), so the caller
 * can drop it rather than resurrect a broken entry.
 */
export function normalizeConversation(fallbackId: string, raw: unknown): Conversation | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Partial<Conversation>;
  if (typeof value.recipeId !== 'string' || !value.recipeId) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id: typeof value.id === 'string' && value.id ? value.id : fallbackId,
    recipeId: value.recipeId,
    messages: Array.isArray(value.messages)
      ? value.messages.map(normalizeConversationMessage).filter((message): message is ConversationMessage => message !== null)
      : [],
    createdAt: typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : now,
  };
}
