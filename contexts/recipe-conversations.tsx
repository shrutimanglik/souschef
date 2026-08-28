import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { normalizeConversation, type Conversation, type ConversationMessage } from '@/constants/conversations';
import { Colors } from '@/constants/theme';

/**
 * Recipe conversation state, shared across screens via context and
 * persisted to on-device storage — the same AsyncStorage-backed Context
 * pattern as CookbookLibraryProvider (contexts/cookbook-library.tsx), kept
 * in its own storage key rather than folded into that one: a conversation
 * transcript is a different kind of data, with a different lifecycle,
 * than saved recipes/cookbooks, and a future change to one storage shape
 * should never be able to corrupt the other.
 *
 * v1 scope: one conversation per recipe (a second thread on the same
 * recipe isn't a need yet), so state is keyed by recipeId.
 */
type RecipeConversationsContextValue = {
  getConversationForRecipe: (recipeId: string) => Conversation | undefined;
  /** Appends a message to a recipe's conversation, creating the conversation if this is its first message. */
  addMessage: (recipeId: string, message: Omit<ConversationMessage, 'id'>) => void;
};

const RecipeConversationsContext = createContext<RecipeConversationsContextValue | null>(null);

const STORAGE_KEY = 'souschef.recipe-conversations.v1';

type PersistedState = {
  conversationsByRecipeId: Record<string, Conversation>;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RecipeConversationsProvider({ children }: { children: ReactNode }) {
  const [conversationsByRecipeId, setConversationsByRecipeId] = useState<Record<string, Conversation>>({});
  const [isHydrated, setIsHydrated] = useState(false);

  // Load whatever was saved last time, once, before anything can write
  // over it — same sequencing as CookbookLibraryProvider.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) {
          return;
        }
        const parsed: Partial<PersistedState> = JSON.parse(raw);
        if (parsed.conversationsByRecipeId) {
          const normalized: Record<string, Conversation> = {};
          for (const [recipeId, rawConversation] of Object.entries(parsed.conversationsByRecipeId)) {
            const conversation = normalizeConversation(createId('conversation'), rawConversation);
            if (conversation) {
              normalized[recipeId] = conversation;
            }
          }
          setConversationsByRecipeId(normalized);
        }
      })
      .catch((error) => {
        console.warn('SousChef: failed to load saved conversations', error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on every change, once there's real (loaded) state to persist —
  // otherwise this would overwrite saved data with empty state before the
  // load above finishes.
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const payload: PersistedState = { conversationsByRecipeId };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch((error) => {
      console.warn('SousChef: failed to save conversations', error);
    });
  }, [conversationsByRecipeId, isHydrated]);

  const getConversationForRecipe = useCallback(
    (recipeId: string) => conversationsByRecipeId[recipeId],
    [conversationsByRecipeId]
  );

  const addMessage = useCallback((recipeId: string, message: Omit<ConversationMessage, 'id'>) => {
    setConversationsByRecipeId((prev) => {
      const existing = prev[recipeId];
      const now = new Date().toISOString();
      const fullMessage: ConversationMessage = { ...message, id: createId('message') };
      const conversation: Conversation = existing
        ? { ...existing, messages: [...existing.messages, fullMessage], updatedAt: now }
        : { id: createId('conversation'), recipeId, messages: [fullMessage], createdAt: now, updatedAt: now };
      return { ...prev, [recipeId]: conversation };
    });
  }, []);

  const value = useMemo(
    () => ({ getConversationForRecipe, addMessage }),
    [getConversationForRecipe, addMessage]
  );

  if (!isHydrated) {
    // Brief, ivory-colored blank frame while saved state loads, matching
    // CookbookLibraryProvider's hydration behavior.
    return <View style={{ flex: 1, backgroundColor: Colors.light.background }} />;
  }

  return (
    <RecipeConversationsContext.Provider value={value}>{children}</RecipeConversationsContext.Provider>
  );
}

export function useRecipeConversations() {
  const context = useContext(RecipeConversationsContext);
  if (!context) {
    throw new Error('useRecipeConversations must be used within a RecipeConversationsProvider');
  }
  return context;
}
