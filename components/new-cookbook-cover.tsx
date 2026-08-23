import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

type NewCookbookCoverProps = {
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
};

/**
 * A blank cookbook cover — an empty place on the shelf waiting to be filled.
 * This card, not a floating action button, is the mechanism for creating a
 * new cookbook.
 */
export function NewCookbookCover({ style, onPress }: NewCookbookCoverProps) {
  const colors = Colors.light;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="New Cookbook"
      accessibilityHint="Creates a new, empty cookbook"
      style={({ pressed }) => [
        styles.cover,
        { borderColor: colors.border, backgroundColor: colors.surface },
        pressed && { opacity: 0.85 },
        style,
      ]}>
      <View style={styles.inner}>
        <Text style={[styles.plus, { color: colors.textMuted }]}>+</Text>
        <Text style={[styles.label, { color: colors.textMuted }]}>New Cookbook</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cover: {
    flex: 1,
    aspectRatio: 0.7,
    borderRadius: 3,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  plus: {
    fontFamily: Fonts.serif,
    fontSize: 26,
    lineHeight: 30,
  },
  label: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
