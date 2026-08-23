import { Stack, useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListRow } from '@/components/list-row';
import { getRecipeCount } from '@/constants/cookbooks';
import { Colors, Fonts } from '@/constants/theme';
import { clearPendingExtractedRecipe, getPendingExtractedRecipe } from '@/contexts/pending-recipe';
import { useCookbookLibrary } from '@/contexts/cookbook-library';

export default function SelectCookbookScreen() {
  const router = useRouter();
  const colors = Colors.light;
  const { cookbooks, addRecipeToCookbook } = useCookbookLibrary();

  const handleSelectCookbook = (cookbookId: string) => {
    const recipe = getPendingExtractedRecipe();
    if (!recipe) {
      // Shouldn't normally happen — this screen is only reachable from
      // Preview, which already confirmed a recipe exists — but if it does,
      // say so rather than silently bouncing back to a Library that looks
      // like nothing went wrong.
      Alert.alert(
        "We lost your recipe",
        "Something went wrong and we couldn't find the recipe you were saving. Please paste the link again.",
        [{ text: 'OK', onPress: () => router.dismissTo('/') }]
      );
      return;
    }
    addRecipeToCookbook(cookbookId, recipe);
    clearPendingExtractedRecipe();
    // Dismiss the whole Add Recipe flow in one atomic navigation call and
    // land back on the Cookbook Library, where the chosen cookbook's count
    // now reflects the saved recipe. (Chaining a separate dismissAll() +
    // replace() here was the earlier save bug — two back-to-back
    // imperative navigation calls raced, so screens deeper in the stack
    // sometimes mounted against a route that hadn't finished resolving.)
    router.dismissTo('/');
  };

  const handleNewCookbook = () => {
    Alert.alert('New Cookbook', 'Creating cookbooks is coming soon.');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Save to cookbook' }} />
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Save to cookbook</Text>
        <View style={styles.list}>
          {cookbooks.map((cookbook, index) => (
            <ListRow
              key={cookbook.id}
              title={cookbook.title}
              subtitle={`${getRecipeCount(cookbook)} recipes`}
              subtitleVariant="label"
              onPress={() => handleSelectCookbook(cookbook.id)}
              showDivider={index < cookbooks.length - 1}
            />
          ))}
          <ListRow title="+ New Cookbook" onPress={handleNewCookbook} showDivider={false} muted />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 26,
    lineHeight: 32,
    marginBottom: 20,
  },
  list: {
    marginTop: 4,
  },
});
