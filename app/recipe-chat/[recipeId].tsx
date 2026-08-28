import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ChatMessage } from '@/ai';
import { AssistantMessage } from '@/components/assistant-message';
import { PrimaryButton } from '@/components/primary-button';
import { formatServings, formatTimeSummary } from '@/constants/recipes';
import { Colors, Fonts } from '@/constants/theme';
import { useCookbookLibrary } from '@/contexts/cookbook-library';
import { useRecipeConversations } from '@/contexts/recipe-conversations';

// A few starting points shown only on an empty conversation — not a fixed
// menu, just enough to signal the kinds of things this screen is for
// before someone has typed anything.
const SUGGESTED_QUESTIONS = [
  'Can I substitute an ingredient?',
  'How do I adjust the servings?',
  'What can I prep ahead?',
];

/**
 * A recipe-specific chat surface: a pinned header naming the exact recipe
 * (and what it knows — servings/time), then a conversation transcript
 * styled like the rest of SousChef's editorial reading layout (see
 * components/recipe-content.tsx) rather than a generic two-tone bubble
 * chat — labeled turns and hairline dividers, not rounded message bubbles.
 *
 * Ask/answer calls go to the server-only /api/recipe-chat route (see
 * app/api/recipe-chat+api.ts) — this screen never talks to Claude
 * directly, and never sees an API key. Conversation state itself is owned
 * by RecipeConversationsProvider (see contexts/recipe-conversations.tsx),
 * not this screen — this screen only reads it and appends to it, the same
 * division of responsibility as app/add/paste-link.tsx (screen owns the
 * network call + loading/error state; context owns persisted state).
 */
export default function RecipeChatScreen() {
  const { recipeId } = useLocalSearchParams<{ recipeId: string }>();
  const colors = Colors.light;
  const { getRecipe } = useCookbookLibrary();
  const { getConversationForRecipe, addMessage } = useRecipeConversations();
  // The native Stack header sits above this screen, not inside it — on iOS
  // "padding" behavior needs its height to avoid double-counting the safe
  // area and undershooting how far the input should lift.
  const headerHeight = useHeaderHeight();

  const recipe = getRecipe(recipeId);
  const conversation = getConversationForRecipe(recipeId);
  const messages = conversation?.messages ?? [];

  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Contextual follow-ups for the *latest* answer only — not persisted
  // with the conversation (see contexts/recipe-conversations.tsx), since
  // they're only useful right after the answer they followed from, not as
  // a permanent part of the transcript. The model produces them in the
  // same completion as the answer (see ai/recipe-conversation.ts) rather
  // than a second request.
  const [followUps, setFollowUps] = useState<string[]>([]);

  const scrollViewRef = useRef<ScrollView>(null);
  const scrollToEnd = (animated = true) => scrollViewRef.current?.scrollToEnd({ animated });

  // Keeps the latest turn in view both when the transcript grows (new
  // message, the "Thinking…" row, an error) and when the keyboard itself
  // opens/closes and shrinks the visible scroll area.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(showEvent, () => scrollToEnd());
    return () => subscription.remove();
  }, []);

  if (!recipe) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Ask about this recipe' }} />
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Recipe not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const recipeMeta = [formatServings(recipe), formatTimeSummary(recipe)].filter(Boolean).join(' · ');

  const sendQuestion = async (question: string) => {
    if (!question || isSending) {
      return;
    }

    setDraft('');
    setError(null);
    setFollowUps([]);
    addMessage(recipeId, { role: 'user', content: question, createdAt: new Date().toISOString() });
    setIsSending(true);

    try {
      const history: ChatMessage[] = [
        ...messages.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user' as const, content: question },
      ];

      const response = await fetch('/api/recipe-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe, messages: history }),
      });

      // TEMP DIAGNOSTIC LOGGING — remove once the "Couldn't reach
      // SousChef" reports are root-caused. Status/headers only.
      console.log('[TEMP DIAGNOSTIC] recipe-chat response received', {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
      });

      let result;
      try {
        result = await response.json();
      } catch (parseError) {
        // The body wasn't valid JSON — capture what it actually was (a
        // status code and a text preview, never recipe/conversation
        // content) so a non-JSON error page can be told apart from a
        // truncated body.
        const bodyPreview = await response
          .clone()
          .text()
          .then((text) => text.slice(0, 300))
          .catch(() => '<unreadable>');
        console.error('[TEMP DIAGNOSTIC] recipe-chat response was not valid JSON', {
          status: response.status,
          contentType: response.headers.get('content-type'),
          bodyPreview,
          parseErrorMessage: parseError instanceof Error ? parseError.message : String(parseError),
        });
        throw parseError;
      }

      if (result.ok) {
        addMessage(recipeId, { role: 'assistant', content: result.message, createdAt: new Date().toISOString() });
        setFollowUps(Array.isArray(result.suggestions) ? result.suggestions : []);
      } else {
        setError(result.error?.message ?? 'Something went wrong asking Claude.');
      }
    } catch (err) {
      // TEMP DIAGNOSTIC LOGGING — this catch previously discarded the
      // error entirely (`catch {}`), which is why past failures showed
      // only the generic message below with no trace anywhere. Logs the
      // error's own name/message only — the recipe and conversation text
      // are the outgoing request, never part of what lands in this catch.
      console.error('[TEMP DIAGNOSTIC] recipe-chat request failed on the client', {
        name: err instanceof Error ? err.name : typeof err,
        message: err instanceof Error ? err.message : String(err),
      });
      setError("Couldn't reach SousChef. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Stack.Screen options={{ title: recipe.title }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
        {/* Pinned above the scrolling transcript (not inside it) so the
            recipe this conversation is grounded in — and what SousChef
            actually knows about it — stays visible no matter how far the
            conversation scrolls. */}
        <View style={[styles.recipeHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.recipeEyebrow, { color: colors.textMuted }]}>Asking about</Text>
          <Text style={[styles.recipeTitle, { color: colors.text, fontFamily: Fonts.serif }]} numberOfLines={1}>
            {recipe.title}
          </Text>
          {recipeMeta ? <Text style={[styles.recipeMeta, { color: colors.textMuted }]}>{recipeMeta}</Text> : null}
        </View>

        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => scrollToEnd()}
          keyboardShouldPersistTaps="handled">
          {messages.length === 0 ? (
            <View>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                SousChef has this recipe’s full ingredients and method — ask about substitutions, timing,
                prep-ahead, or a step that needs explaining.
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTED_QUESTIONS.map((question) => (
                  <Pressable
                    key={question}
                    onPress={() => setDraft(question)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.suggestion,
                      { borderColor: colors.border, backgroundColor: colors.surface },
                      pressed && styles.suggestionPressed,
                    ]}>
                    <Text style={[styles.suggestionText, { color: colors.text }]}>{question}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((message, index) => (
              <View
                key={message.id}
                style={[
                  styles.turn,
                  index < messages.length - 1 && {
                    borderBottomColor: colors.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}>
                <Text style={[styles.turnLabel, { color: message.role === 'user' ? colors.textMuted : colors.tint }]}>
                  {message.role === 'user' ? 'You asked' : 'SousChef'}
                </Text>
                {message.role === 'user' ? (
                  <Text style={[styles.turnQuestion, { color: colors.text, fontFamily: Fonts.serif }]}>
                    {message.content}
                  </Text>
                ) : (
                  <AssistantMessage content={message.content} />
                )}
              </View>
            ))
          )}

          {/* Contextual next questions for the answer just above — not a
              fixed menu (see SUGGESTED_QUESTIONS), so this only shows
              while it's still attached to the latest turn. */}
          {!isSending && followUps.length > 0 ? (
            <View style={styles.followUps}>
              {followUps.map((question) => (
                <Pressable
                  key={question}
                  onPress={() => sendQuestion(question)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.suggestion,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                    pressed && styles.suggestionPressed,
                  ]}>
                  <Text style={[styles.suggestionText, { color: colors.text }]}>{question}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {isSending ? (
            <View style={styles.turn}>
              <Text style={[styles.turnLabel, { color: colors.tint }]}>SousChef</Text>
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.textMuted} size="small" />
                <Text style={[styles.turnAnswer, { color: colors.textMuted }]}>Thinking…</Text>
              </View>
            </View>
          ) : null}

          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        </ScrollView>

        <View style={[styles.inputRow, { borderTopColor: colors.border }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask a question…"
            placeholderTextColor={colors.textMuted}
            editable={!isSending}
            multiline
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />
          <PrimaryButton
            title="Send"
            onPress={() => sendQuestion(draft.trim())}
            disabled={isSending || !draft.trim()}
            style={styles.sendButton}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  emptyTitle: { fontFamily: Fonts.serif, fontSize: 22, lineHeight: 28 },
  recipeHeader: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  recipeEyebrow: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  recipeTitle: {
    fontSize: 20,
    lineHeight: 25,
  },
  recipeMeta: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  messages: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, flexGrow: 1 },
  emptyText: { fontSize: 15, lineHeight: 22 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  followUps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 8 },
  suggestion: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestionPressed: { opacity: 0.6 },
  suggestionText: { fontSize: 13, lineHeight: 18 },
  turn: { paddingVertical: 16, gap: 6 },
  turnLabel: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  turnQuestion: {
    fontSize: 17,
    lineHeight: 24,
    fontStyle: 'italic',
  },
  turnAnswer: {
    fontSize: 15,
    lineHeight: 22,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: { paddingHorizontal: 20, alignSelf: 'flex-end' },
});
