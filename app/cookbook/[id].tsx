import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListRow } from '@/components/list-row';
import { getRecipeCount } from '@/constants/cookbooks';
import { Colors, Fonts } from '@/constants/theme';
import { useCookbookLibrary } from '@/contexts/cookbook-library';

export default function CookbookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = Colors.light;
  const { getCookbook, getRecipesForCookbook } = useCookbookLibrary();
  const cookbook = getCookbook(id);

  const handleAddRecipe = () => {
    // Carries this cookbook through the whole Add Recipe flow (see
    // app/(tabs)/add-recipe.tsx, app/add/paste-link.tsx, app/add/preview.tsx)
    // so the user isn't asked to pick a cookbook they're already inside.
    router.push({ pathname: '/add-recipe', params: { cookbookId: id } });
  };

  if (!cookbook) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Cookbook' }} />
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Cookbook not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const recipeCount = getRecipeCount(cookbook);
  const recipes = getRecipesForCookbook(cookbook);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Stack.Screen options={{ title: cookbook.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{cookbook.title}</Text>
          <Text style={[styles.count, { color: colors.textMuted }]}>
            {recipeCount} {recipeCount === 1 ? 'recipe' : 'recipes'}
          </Text>
          {!cookbook.isSystem && (
            <Pressable
              onPress={handleAddRecipe}
              accessibilityRole="button"
              hitSlop={8}
              style={styles.addRecipeWrap}>
              <Text style={[styles.addRecipe, { color: colors.tint }]}>+ Add Recipe</Text>
            </Pressable>
          )}
        </View>

        {recipeCount === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No recipes yet</Text>
            <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
              {cookbook.isSystem
                ? 'Recipes you save to any cookbook will appear here.'
                : 'Add your first recipe to this cookbook.'}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {recipes.map((recipe, index) => (
              <ListRow
                key={recipe.id}
                title={recipe.title}
                subtitle={recipe.source}
                onPress={() =>
                  router.push({ pathname: '/recipe/[recipeId]', params: { recipeId: recipe.id } })
                }
                showDivider={index < recipes.length - 1}
              />
            ))}
          </View>
        )}
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
    paddingBottom: 40,
    flexGrow: 1,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 8,
    gap: 4,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 32,
    lineHeight: 38,
  },
  count: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  addRecipeWrap: {
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  addRecipe: {
    fontSize: 14,
  },
  list: {
    marginTop: 24,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 60,
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
    maxWidth: 260,
  },
});
