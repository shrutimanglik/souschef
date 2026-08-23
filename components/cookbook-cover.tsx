import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { getRecipeCount, type Cookbook } from '@/constants/cookbooks';
import { Fonts } from '@/constants/theme';

type CookbookCoverProps = {
  cookbook: Cookbook;
  style?: StyleProp<ViewStyle>;
  onPress?: (cookbook: Cookbook) => void;
};

/**
 * A single cookbook "cover" — styled to feel like a physical, editorial book
 * cover rather than a generic rectangular app card. Every cover shares the
 * same simple, centered composition; a future cover theme system (once
 * typography is settled) will introduce restrained typographic and
 * paper/tonal variation between cookbooks.
 */
export function CookbookCover({ cookbook, style, onPress }: CookbookCoverProps) {
  const { title, cover } = cookbook;
  const recipeCount = getRecipeCount(cookbook);
  const recipeLabel = `${recipeCount} ${recipeCount === 1 ? 'recipe' : 'recipes'}`;

  return (
    <Pressable
      onPress={() => onPress?.(cookbook)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${recipeLabel}`}
      style={({ pressed }) => [
        styles.cover,
        { backgroundColor: cover.background },
        pressed && styles.pressed,
        style,
      ]}>
      <View style={styles.inner}>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: cover.foreground, fontFamily: Fonts.serif }]}>
            {title}
          </Text>
          <Text style={[styles.count, { color: cover.accent }]}>{recipeLabel}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cover: {
    flex: 1,
    aspectRatio: 0.7,
    borderRadius: 3,
    overflow: 'hidden',
    shadowColor: '#2A2521',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
  pressed: {
    opacity: 0.9,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  titleBlock: {
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 23,
    lineHeight: 28,
    textAlign: 'center',
  },
  count: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});
