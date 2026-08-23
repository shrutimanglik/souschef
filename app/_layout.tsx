import { DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { CookbookLibraryProvider } from '@/contexts/cookbook-library';
import { Colors, Fonts } from '@/constants/theme';

export const unstable_settings = {
  anchor: '(tabs)',
};

// SousChef always uses its light, warm-ivory palette — it intentionally does
// not follow the device's dark-mode setting. This also blends the native
// stack header (used by pushed screens like the Add Recipe flow and recipe
// detail) with the app's ivory background instead of React Navigation's
// default white.
const NAVIGATION_THEME: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.background,
    card: Colors.light.background,
    text: Colors.light.text,
    border: Colors.light.border,
    primary: Colors.light.tint,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={NAVIGATION_THEME}>
      <CookbookLibraryProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: Colors.light.background },
            headerTintColor: Colors.light.text,
            headerTitleStyle: { fontFamily: Fonts.serif, fontSize: 17 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: Colors.light.background },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </CookbookLibraryProvider>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
