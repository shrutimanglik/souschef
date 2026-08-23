import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { Colors, Fonts } from '@/constants/theme';
import { setPendingExtractedRecipe } from '@/contexts/pending-recipe';
import type { ExtractionResult } from '@/extraction';

function isLikelyUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function PasteLinkScreen() {
  const router = useRouter();
  const colors = Colors.light;
  const { cookbookId } = useLocalSearchParams<{ cookbookId?: string }>();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleContinue = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Paste a recipe URL to continue.');
      return;
    }
    if (!isLikelyUrl(trimmed)) {
      setError("That doesn't look like a valid URL.");
      return;
    }

    setError(null);
    setIsExtracting(true);
    try {
      const response = await fetch(`/api/extract-recipe?url=${encodeURIComponent(trimmed)}`);
      const result: ExtractionResult = await response.json();
      if (result.ok) {
        setPendingExtractedRecipe(result.recipe);
        router.push({ pathname: '/add/preview', params: cookbookId ? { cookbookId } : {} });
      } else {
        setError(result.error.message);
      }
    } catch {
      setError("Couldn't reach SousChef to fetch that recipe. Check your connection and try again.");
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Paste a recipe link' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>Paste a recipe link</Text>

          <TextInput
            value={url}
            onChangeText={(text) => {
              setUrl(text);
              setError(null);
            }}
            placeholder="Paste recipe URL"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!isExtracting}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />

          {error ? (
            <Text style={[styles.error, { color: colors.text }]}>{error}</Text>
          ) : (
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              Example: paste a recipe URL from your favorite recipe website
            </Text>
          )}

          {isExtracting ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.textMuted} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>Fetching recipe…</Text>
            </View>
          ) : (
            <PrimaryButton title="Continue" onPress={handleContinue} style={styles.button} />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 16,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 26,
    lineHeight: 32,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
  },
  button: {
    marginTop: 8,
  },
  loadingRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
  },
});
