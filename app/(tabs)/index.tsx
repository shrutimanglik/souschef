import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CookbookCover } from '@/components/cookbook-cover';
import { NewCookbookCover } from '@/components/new-cookbook-cover';
import { type Cookbook } from '@/constants/cookbooks';
import { Colors, Fonts } from '@/constants/theme';
import { useCookbookLibrary } from '@/contexts/cookbook-library';

// The trailing "new cookbook" tile lives in the same grid as real cookbooks,
// so the list needs a lightweight discriminated shape rather than two
// separately-rendered lists (which would break the two-column wrapping).
type LibraryItem = { kind: 'cookbook'; cookbook: Cookbook } | { kind: 'new' };

export default function CookbookLibraryScreen() {
  const colors = Colors.light;
  const router = useRouter();
  const { cookbooks, allRecipesCookbook } = useCookbookLibrary();

  const libraryData = useMemo<LibraryItem[]>(
    () => [
      ...cookbooks.map((cookbook): LibraryItem => ({ kind: 'cookbook', cookbook })),
      { kind: 'cookbook', cookbook: allRecipesCookbook },
      { kind: 'new' },
    ],
    [cookbooks, allRecipesCookbook]
  );

  const handleOpenCookbook = useCallback(
    (cookbook: Cookbook) => {
      router.push({ pathname: '/cookbook/[id]', params: { id: cookbook.id } });
    },
    [router]
  );

  const handleCreateCookbook = useCallback(() => {
    // Creating a cookbook is a future milestone; this is the visual
    // affordance for it, matching the restrained "coming soon" treatment
    // used elsewhere in the app.
    Alert.alert('New Cookbook', 'Creating cookbooks is coming soon.');
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <FlatList
        data={libraryData}
        keyExtractor={(item) => (item.kind === 'cookbook' ? item.cookbook.id : 'new')}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.eyebrow, { color: colors.textMuted }]}>SousChef</Text>
            <Text style={[styles.title, { color: colors.text }]}>Your cookbooks</Text>
          </View>
        }
        renderItem={({ item }) =>
          item.kind === 'cookbook' ? (
            <CookbookCover
              cookbook={item.cookbook}
              style={styles.tile}
              onPress={handleOpenCookbook}
            />
          ) : (
            <NewCookbookCover style={styles.tile} onPress={handleCreateCookbook} />
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
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
  row: {
    gap: 16,
    marginBottom: 16,
  },
  tile: {
    flexBasis: '47%',
  },
});
