import { router, useLocalSearchParams } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListRow } from '@/components/list-row';
import { Colors, Fonts } from '@/constants/theme';
import { useCookbookLibrary } from '@/contexts/cookbook-library';

export default function AddRecipeScreen() {
  const colors = Colors.light;
  // Present when this screen was opened from inside a specific cookbook
  // (see app/cookbook/[id].tsx) — carried through the rest of the flow so
  // the user isn't asked to choose a cookbook they're already inside.
  const { cookbookId } = useLocalSearchParams<{ cookbookId?: string }>();
  const { getCookbook } = useCookbookLibrary();
  const targetCookbook = cookbookId ? getCookbook(cookbookId) : undefined;

  const handlePasteLink = () => {
    router.push({ pathname: '/add/paste-link', params: cookbookId ? { cookbookId } : {} });
  };

  const handleAddManually = () => {
    // Adding a recipe by hand (for recipes that aren't online) is a future
    // milestone; this milestone only builds the Paste a Recipe Link path.
    Alert.alert('Add Manually', 'Coming soon.');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: colors.textMuted }]}>Add Recipe</Text>
          <Text style={[styles.title, { color: colors.text }]}>Add a recipe</Text>
          {targetCookbook ? (
            <Text style={[styles.targetCookbook, { color: colors.textMuted }]}>
              Adding to {targetCookbook.title}
            </Text>
          ) : null}
        </View>

        <View>
          <ListRow
            title="Paste a recipe link"
            subtitle="Turn a recipe website into your cookbook."
            onPress={handlePasteLink}
          />
          <ListRow
            title="Add manually"
            subtitle="For recipes that aren't online."
            onPress={handleAddManually}
            showDivider={false}
          />
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
  },
  header: {
    paddingTop: 12,
    paddingBottom: 28,
    gap: 4,
  },
  eyebrow: {
    fontSize: 13,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 34,
    lineHeight: 40,
  },
  targetCookbook: {
    fontSize: 14,
    marginTop: 6,
  },
});
