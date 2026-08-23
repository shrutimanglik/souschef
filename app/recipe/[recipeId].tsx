import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecipeContent } from '@/components/recipe-content';
import { Colors, Fonts } from '@/constants/theme';
import { useCookbookLibrary } from '@/contexts/cookbook-library';

// Recipes have one canonical identity (see contexts/cookbook-library.tsx),
// so a recipe is addressable by its own id alone — this screen doesn't
// need to know which cookbook it was opened from.
export default function RecipeDetailScreen() {
  const { recipeId } = useLocalSearchParams<{ recipeId: string }>();
  const router = useRouter();
  const colors = Colors.light;
  const { getRecipe, deleteRecipe } = useCookbookLibrary();
  const recipe = getRecipe(recipeId);

  const handleDelete = () => {
    if (!recipe) {
      return;
    }
    // Deleting is destructive and irreversible in this prototype (removes
    // the canonical recipe everywhere, not just from one cookbook) — always
    // confirm before it happens.
    Alert.alert('Delete recipe?', 'This will remove this recipe from all cookbooks.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRecipe(recipe.id);
          router.dismissTo('/');
        },
      },
    ]);
  };

  if (!recipe) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Recipe' }} />
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Recipe not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Stack.Screen options={{ title: recipe.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        <RecipeContent recipe={recipe} />

        <Pressable
          onPress={handleDelete}
          accessibilityRole="button"
          style={[styles.deleteWrap, { borderTopColor: colors.border }]}>
          <Text style={[styles.deleteText, { color: colors.danger }]}>Delete recipe</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontFamily: Fonts.serif,
    fontSize: 22,
    lineHeight: 28,
  },
  deleteWrap: {
    marginTop: 48,
    paddingTop: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  deleteText: {
    fontSize: 14,
  },
});
