import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

type PrimaryButtonProps = {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The app's one primary-action button style — a solid charcoal bar rather
 * than a bright/colorful CTA, so it stays understated next to the rest of
 * the editorial design language.
 */
export function PrimaryButton({ title, onPress, disabled, style }: PrimaryButtonProps) {
  const colors = Colors.light;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.text },
        (pressed || disabled) && styles.disabled,
        style,
      ]}>
      <Text style={[styles.label, { color: colors.background }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 16,
    borderRadius: 4,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  label: {
    fontSize: 15,
    letterSpacing: 0.4,
  },
});
