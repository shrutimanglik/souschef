import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ExternalLink } from '@/components/external-link';
import {
  formatIngredient,
  formatIngredientQuantity,
  formatServings,
  formatTimeSummary,
  type Recipe,
} from '@/constants/recipes';
import { Colors, Fonts } from '@/constants/theme';

type RecipeContentProps = {
  recipe: Recipe;
  /**
   * Rendered between the Ingredients and Method sections — currently used
   * for the "Ask about this recipe" entry point (see
   * app/recipe/[recipeId].tsx), placed there rather than above Ingredients
   * so it reads as attached to the recipe body instead of a generic CTA
   * before the reader has seen anything. Spacing matches the section
   * rhythm regardless of whether Ingredients rendered.
   */
  afterIngredients?: ReactNode;
};

/**
 * The shared reading layout for both the extraction preview and the saved
 * recipe detail screen, styled like a page from a physical cookbook rather
 * than a database record: source line, editorial title, understated
 * metadata and source link, then two clean editorial sections for
 * ingredients and method.
 *
 * A legacy recipe loaded from storage may predate some of these fields
 * (see `normalizeRecipe`, which fills unknown values with `0`/`''` rather
 * than leaving them `undefined`). Every optional piece here is only
 * rendered when it actually has something to show — an unknown value is
 * omitted, never displayed as "undefined" or a fake placeholder like
 * "0 min".
 *
 * Future: a hero recipe image would render above the header block below —
 * image extraction isn't implemented yet, but this is where it would slot
 * in without otherwise restructuring the screen.
 */
export function RecipeContent({ recipe, afterIngredients }: RecipeContentProps) {
  const colors = Colors.light;

  const hasSource = !!recipe.source && recipe.source.trim().length > 0;
  const hasSourceUrl = !!recipe.sourceUrl && recipe.sourceUrl.trim().length > 0;
  const servingsText = formatServings(recipe);
  const timeSummary = formatTimeSummary(recipe);
  const hasMeta = !!servingsText || !!timeSummary;

  // A row with no quantity, no unit, and no name has nothing to show —
  // skip it rather than rendering a blank divided row.
  const visibleIngredients = recipe.ingredients.filter(
    (ingredient) => ingredient.name.trim() || ingredient.unit.trim() || ingredient.quantity > 0
  );
  const visibleInstructions = recipe.instructions.filter((step) => step && step.trim().length > 0);

  return (
    <View>
      <View style={styles.header}>
        {hasSource ? (
          <Text style={[styles.source, { color: colors.textMuted }]}>{recipe.source}</Text>
        ) : null}
        <Text style={[styles.title, { color: colors.text, fontFamily: Fonts.serif }]}>
          {recipe.title}
        </Text>

        {hasMeta ? (
          <View style={styles.meta}>
            {servingsText ? (
              <Text style={[styles.servings, { color: colors.textMuted }]}>{servingsText}</Text>
            ) : null}
            {timeSummary ? (
              <Text style={[styles.times, { color: colors.textMuted }]}>{timeSummary}</Text>
            ) : null}
          </View>
        ) : null}

        {hasSourceUrl ? (
          <ExternalLink href={recipe.sourceUrl as Href & string} style={styles.sourceLinkWrap}>
            <Text style={[styles.sourceLink, { color: colors.tint }]}>View original recipe ↗</Text>
          </ExternalLink>
        ) : null}
      </View>

      {visibleIngredients.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>Ingredients</Text>
          <View style={[styles.sectionRule, { backgroundColor: colors.border }]} />
          {visibleIngredients.map((ingredient, index) => (
            <View
              key={ingredient.id}
              accessible
              accessibilityLabel={formatIngredient(ingredient)}
              style={[
                styles.ingredientRow,
                index < visibleIngredients.length - 1 && {
                  borderBottomColor: colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}>
              <Text style={[styles.ingredientQty, { color: colors.textMuted }]}>
                {formatIngredientQuantity(ingredient)}
              </Text>
              <Text style={[styles.ingredientName, { color: colors.text }]}>{ingredient.name}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {afterIngredients ? <View style={styles.afterIngredients}>{afterIngredients}</View> : null}

      {visibleInstructions.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>Method</Text>
          <View style={[styles.sectionRule, { backgroundColor: colors.border }]} />
          {visibleInstructions.map((step, index) => (
            <View key={step} style={styles.methodStep}>
              <Text style={[styles.stepNumber, { color: colors.textMuted, fontFamily: Fonts.serif }]}>
                {String(index + 1).padStart(2, '0')}
              </Text>
              <Text style={[styles.stepText, { color: colors.text }]}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 6,
  },
  source: {
    fontSize: 13,
    lineHeight: 18,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    marginTop: 2,
  },
  meta: {
    marginTop: 10,
    gap: 3,
  },
  servings: {
    fontSize: 13,
    lineHeight: 18,
  },
  times: {
    fontSize: 13,
    lineHeight: 18,
  },
  sourceLinkWrap: {
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  sourceLink: {
    fontSize: 13,
    lineHeight: 18,
  },
  section: {
    marginTop: 40,
  },
  afterIngredients: {
    marginTop: 40,
  },
  sectionLabel: {
    fontSize: 13,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  sectionRule: {
    height: StyleSheet.hairlineWidth,
    marginTop: 10,
    marginBottom: 4,
  },
  ingredientRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    gap: 16,
  },
  ingredientQty: {
    width: 84,
    fontSize: 15,
    lineHeight: 22,
  },
  ingredientName: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  methodStep: {
    marginTop: 28,
  },
  stepNumber: {
    fontSize: 20,
    lineHeight: 24,
  },
  stepText: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 25,
  },
});
