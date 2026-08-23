/**
 * SousChef "quiet luxury" palette: warm ivory backgrounds, dark charcoal
 * (never pure black) text, and muted, sophisticated secondary colors.
 * No gradients, no bright/neon colors.
 *
 * SousChef always renders in the light palette by default — it does not
 * follow the device's system dark-mode setting. `Colors.dark` is kept
 * around for a possible future in-app theme setting, but nothing wires it
 * up automatically today. Use `DEFAULT_COLOR_SCHEME` / `Colors.light`
 * directly rather than a device color-scheme hook.
 */

import { Platform } from 'react-native';

const tintColorLight = '#8C6E4F';
const tintColorDark = '#D9C7AE';

export const Colors = {
  light: {
    text: '#2A2521',
    textMuted: '#79695C',
    background: '#FAF5EC',
    surface: '#F2E9DA',
    border: '#E5D9C6',
    tint: tintColorLight,
    icon: '#8A7A6B',
    tabIconDefault: '#B4A793',
    tabIconSelected: tintColorLight,
    // A muted, warm-toned brick red for destructive actions (e.g. Delete
    // recipe) — legible as a warning without being a bright alert red.
    danger: '#9C4A3C',
  },
  dark: {
    text: '#F1E7D8',
    textMuted: '#B3A48F',
    background: '#1C1814',
    surface: '#26201A',
    border: '#382F26',
    tint: tintColorDark,
    icon: '#B3A48F',
    tabIconDefault: '#6F6255',
    tabIconSelected: tintColorDark,
    danger: '#C97361',
  },
};

/** SousChef's default (and, for now, only active) color scheme. */
export const DEFAULT_COLOR_SCHEME: keyof typeof Colors = 'light';

/**
 * Headings currently use the platform's default serif until an editorial
 * serif is chosen. Body, navigation, and recipe-count text use the
 * platform's default sans-serif — no fontFamily override needed for those.
 */
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
  },
});
