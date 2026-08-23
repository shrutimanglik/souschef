import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { RecipeEditor } from '@/components/recipe-editor';
import { Colors, Fonts } from '@/constants/theme';
import { clearPendingExtractedRecipe, getPendingExtractedRecipe, setPendingExtractedRecipe } from '@/contexts/pending-recipe';
import { useCookbookLibrary } from '@/contexts/cookbook-library';

/**
 * "Here's what SousChef found — review it before saving." Renders whatever
 * app/add/paste-link.tsx just extracted (see contexts/pending-recipe.ts)
 * as an editable draft: the user can correct any field before it's ever
 * written to a cookbook. Editing state is local to this screen — nothing
 * is persisted until Save.
 */
export default function RecipePreviewScreen() {
  const router = useRouter();
  const colors = Colors.light;
  // Read once, not on every render — Preview shouldn't lose the recipe if
  // something else in the tree re-renders it before the user saves. This
  // becomes the editable draft; the module-level pending recipe itself is
  // only touched again if we hand the edited version to Select Cookbook.
  const [draft, setDraft] = useState(() => getPendingExtractedRecipe());
  // Carried from app/cookbook/[id].tsx when this flow was opened from
  // inside a specific cookbook — if present, save straight into it instead
  // of asking the user to choose a cookbook they're already inside.
  const { cookbookId } = useLocalSearchParams<{ cookbookId?: string }>();
  const { getCookbook, addRecipeToCookbook } = useCookbookLibrary();
  const targetCookbook = cookbookId ? getCookbook(cookbookId) : undefined;

  const handleSaveToCookbook = () => {
    if (!draft) {
      return;
    }
    if (targetCookbook) {
      addRecipeToCookbook(targetCookbook.id, draft);
      clearPendingExtractedRecipe();
      router.dismissTo({ pathname: '/cookbook/[id]', params: { id: targetCookbook.id } });
      return;
    }
    // Select Cookbook reads from the same pending-recipe handoff — it must
    // hold the edited draft, not the original extraction result, by the
    // time the user gets there.
    setPendingExtractedRecipe(draft);
    router.push('/add/select-cookbook');
  };

  const handleGoToPasteLink = () => {
    router.push({ pathname: '/add/paste-link', params: cookbookId ? { cookbookId } : {} });
  };

  if (!draft) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Review recipe' }} />
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing to preview</Text>
          <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
            Paste a recipe link to get started.
          </Text>
          <PrimaryButton
            title="Paste a recipe link"
            onPress={handleGoToPasteLink}
            style={styles.emptyButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  const warnings = draft.extraction?.warnings ?? [];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Review recipe' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {warnings.length > 0 ? (
            <View style={[styles.warnings, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.warningsTitle, { color: colors.text }]}>
                {warnings.length} {warnings.length === 1 ? 'thing' : 'things'} to double-check
              </Text>
              {warnings.map((warning, index) => (
                <Text key={index} style={[styles.warningItem, { color: colors.textMuted }]}>
                  · {warning.message}
                </Text>
              ))}
            </View>
          ) : null}

          <RecipeEditor recipe={draft} onChange={setDraft} />

          <PrimaryButton
            title={targetCookbook ? `Save to ${targetCookbook.title}` : 'Save to cookbook'}
            onPress={handleSaveToCookbook}
            style={styles.button}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  warnings: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 14,
    marginBottom: 28,
    gap: 4,
  },
  warningsTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  warningItem: {
    fontSize: 13,
    lineHeight: 19,
  },
  button: {
    marginTop: 36,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontFamily: Fonts.serif,
    fontSize: 22,
    lineHeight: 28,
  },
  emptyBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 20,
    alignSelf: 'stretch',
  },
});
