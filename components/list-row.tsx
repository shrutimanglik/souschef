import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Fonts } from '@/constants/theme';

type ListRowProps = {
  title: string;
  subtitle?: string;
  /**
   * 'caption' (default) is a normal, sentence-case description, e.g. "Turn
   * a recipe website into your cookbook." 'label' is the small-caps
   * treatment used elsewhere in the app for a recipe count, e.g. "0 recipes".
   */
  subtitleVariant?: 'caption' | 'label';
  /** Optional leading icon, tinted with the app's accent color — omit for the plain text-only row every existing call site uses today. */
  icon?: IconSymbolName;
  onPress?: () => void;
  showChevron?: boolean;
  showDivider?: boolean;
  /** De-emphasized treatment for a not-yet-available row (e.g. "+ New Cookbook"). */
  muted?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * A restrained, editorial list row shared by the Add Recipe chooser, the
 * cookbook picker, and a cookbook's recipe list — so those simple lists
 * read as one consistent visual language rather than a UI-kit menu.
 */
export function ListRow({
  title,
  subtitle,
  subtitleVariant = 'caption',
  icon,
  onPress,
  showChevron = true,
  showDivider = true,
  muted = false,
  style,
}: ListRowProps) {
  const colors = Colors.light;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => [
        styles.row,
        showDivider && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
        pressed && styles.pressed,
        style,
      ]}>
      {icon ? <IconSymbol name={icon} size={20} color={colors.tint} /> : null}
      <View style={styles.text}>
        <Text
          style={[styles.title, { color: muted ? colors.textMuted : colors.text, fontFamily: Fonts.serif }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[
              subtitleVariant === 'label' ? styles.subtitleLabel : styles.subtitleCaption,
              { color: colors.textMuted },
            ]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showChevron && <IconSymbol name="chevron.right" size={16} color={colors.textMuted} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    gap: 12,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 19,
    lineHeight: 24,
  },
  subtitleCaption: {
    fontSize: 14,
    lineHeight: 19,
  },
  subtitleLabel: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
