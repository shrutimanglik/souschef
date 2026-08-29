import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

// Direct file import, not the `@/agent` barrel — the barrel also re-exports
// runInstagramRecipeAgent, which pulls in the Anthropic SDK and every
// ScrapeCreators provider. isInstagramUrl itself has zero dependencies
// (see agent/lib/instagram-url.ts), but importing it via the barrel would
// still drag that whole server-only graph into the client bundle. This is
// the exact same file path the agent's own tools import it from.
import { isInstagramUrl } from '@/agent/lib/instagram-url';
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
  // Drives which loading copy shows below — the two paths have very
  // different latency (website: usually under a couple seconds; Instagram:
  // a multi-step agent loop, ~30-85s) and the user should know why.
  const [isInstagramExtraction, setIsInstagramExtraction] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // A live "how long has this been running" counter — not a fake progress
  // bar (we have no real step-by-step signal to show honestly), just
  // enough live feedback that a 30-85s wait doesn't read as a frozen
  // screen. Only runs while extracting; resets between attempts.
  useEffect(() => {
    if (!isExtracting) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => clearInterval(interval);
  }, [isExtracting]);

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

    // Same URL, same "Continue" button — the app decides which pipeline to
    // use, not the user. Both endpoints return the identical ExtractionResult
    // shape below, so nothing past this point needs to know which one ran.
    const instagram = isInstagramUrl(trimmed);
    const endpoint = instagram ? '/api/extract-instagram-recipe' : '/api/extract-recipe';

    setError(null);
    setIsInstagramExtraction(instagram);
    setIsExtracting(true);
    try {
      const response = await fetch(`${endpoint}?url=${encodeURIComponent(trimmed)}`);
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
            placeholder="Paste a recipe or Instagram link"
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
              Works with a recipe website, or an Instagram Reel or post
            </Text>
          )}

          {isExtracting ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.textMuted} />
              <View style={styles.loadingTextGroup}>
                <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                  {isInstagramExtraction ? 'Reading the Instagram post…' : 'Fetching recipe…'}
                </Text>
                {isInstagramExtraction ? (
                  <Text style={[styles.loadingSubtext, { color: colors.textMuted }]}>
                    This can take up to a minute — {elapsedSeconds}s
                  </Text>
                ) : null}
              </View>
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
  loadingTextGroup: {
    alignItems: 'center',
    gap: 2,
  },
  loadingText: {
    fontSize: 14,
  },
  loadingSubtext: {
    fontSize: 12,
  },
});
