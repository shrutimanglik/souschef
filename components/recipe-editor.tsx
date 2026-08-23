import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { Ingredient, Recipe } from '@/constants/recipes';
import { Colors, Fonts } from '@/constants/theme';

type RecipeEditorProps = {
  recipe: Recipe;
  onChange: (recipe: Recipe) => void;
};

/**
 * The editable counterpart to RecipeContent (components/recipe-content.tsx)
 * — same editorial layout (title, servings/time metadata, Ingredients,
 * Method), but every field is a controlled input instead of static text.
 * Used only by the Preview screen while reviewing a freshly extracted
 * recipe; RecipeContent itself stays read-only and untouched for the
 * saved-recipe detail screen.
 *
 * Ingredient quantity/unit/name are kept as three separate fields here —
 * matching the canonical Ingredient model — rather than one free-text
 * line, so editing never needs to re-parse text (that's extraction's job,
 * not this screen's).
 */
export function RecipeEditor({ recipe, onChange }: RecipeEditorProps) {
  const colors = Colors.light;

  const updateField = <K extends keyof Recipe>(key: K, value: Recipe[K]) => {
    onChange({ ...recipe, [key]: value });
  };

  const updateIngredient = (index: number, patch: Partial<Ingredient>) => {
    onChange({
      ...recipe,
      ingredients: recipe.ingredients.map((ingredient, i) =>
        i === index ? { ...ingredient, ...patch } : ingredient
      ),
    });
  };

  const updateInstruction = (index: number, text: string) => {
    onChange({
      ...recipe,
      instructions: recipe.instructions.map((step, i) => (i === index ? text : step)),
    });
  };

  const inputProps = {
    placeholderTextColor: colors.textMuted,
    underlineColorAndroid: 'transparent',
  } as const;

  return (
    <View>
      <View style={styles.header}>
        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Title</Text>
        <TextInput
          {...inputProps}
          value={recipe.title}
          onChangeText={(text) => updateField('title', text)}
          placeholder="Recipe title"
          style={[styles.titleInput, { color: colors.text, borderBottomColor: colors.border }]}
        />

        <View style={styles.row}>
          <View style={styles.servingsField}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Servings</Text>
            <View style={styles.servingsRow}>
              <NumberInput
                value={recipe.servings}
                onChangeNumber={(value) => updateField('servings', value)}
                style={[styles.servingsCount, { color: colors.text, borderBottomColor: colors.border }]}
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                {...inputProps}
                value={recipe.servingsLabel}
                onChangeText={(text) => updateField('servingsLabel', text)}
                placeholder="servings"
                style={[styles.servingsLabel, { color: colors.text, borderBottomColor: colors.border }]}
              />
            </View>
          </View>
        </View>

        <View style={styles.row}>
          <TimeField
            label="Prep"
            value={recipe.prepTime}
            onChangeNumber={(value) => updateField('prepTime', value)}
            colors={colors}
          />
          <TimeField
            label="Cook"
            value={recipe.cookTime}
            onChangeNumber={(value) => updateField('cookTime', value)}
            colors={colors}
          />
          <TimeField
            label="Total"
            value={recipe.totalTime}
            onChangeNumber={(value) => updateField('totalTime', value)}
            colors={colors}
          />
        </View>
      </View>

      {recipe.ingredients.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>Ingredients</Text>
          <View style={[styles.sectionRule, { backgroundColor: colors.border }]} />
          {recipe.ingredients.map((ingredient, index) => (
            <View
              key={ingredient.id}
              style={[
                styles.ingredientRow,
                index < recipe.ingredients.length - 1 && {
                  borderBottomColor: colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}>
              <NumberInput
                value={ingredient.quantity}
                onChangeNumber={(value) => updateIngredient(index, { quantity: value })}
                placeholder="qty"
                placeholderTextColor={colors.textMuted}
                style={[styles.ingredientQty, { color: colors.textMuted, borderBottomColor: colors.border }]}
              />
              <TextInput
                {...inputProps}
                value={ingredient.unit}
                onChangeText={(text) => updateIngredient(index, { unit: text })}
                placeholder="unit"
                style={[styles.ingredientUnit, { color: colors.textMuted, borderBottomColor: colors.border }]}
              />
              <TextInput
                {...inputProps}
                value={ingredient.name}
                onChangeText={(text) => updateIngredient(index, { name: text })}
                placeholder="ingredient"
                multiline
                style={[styles.ingredientName, { color: colors.text, borderBottomColor: colors.border }]}
              />
            </View>
          ))}
        </View>
      ) : null}

      {recipe.instructions.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>Method</Text>
          <View style={[styles.sectionRule, { backgroundColor: colors.border }]} />
          {recipe.instructions.map((step, index) => (
            <View key={index} style={styles.methodStep}>
              <Text style={[styles.stepNumber, { color: colors.textMuted, fontFamily: Fonts.serif }]}>
                {String(index + 1).padStart(2, '0')}
              </Text>
              <TextInput
                {...inputProps}
                value={step}
                onChangeText={(text) => updateInstruction(index, text)}
                placeholder="Step text"
                multiline
                style={[styles.stepInput, { color: colors.text, borderBottomColor: colors.border }]}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// A time in minutes shows as blank rather than "0" — 0 means "unknown" in
// this app's convention (see constants/recipes.ts formatters), so an
// empty field reads correctly as "not set" instead of a fake zero.
function TimeField({
  label,
  value,
  onChangeNumber,
  colors,
}: {
  label: string;
  value: number;
  onChangeNumber: (value: number) => void;
  colors: (typeof Colors)['light'];
}) {
  return (
    <View style={styles.timeField}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <View style={styles.timeInputRow}>
        <NumberInput
          value={value}
          onChangeNumber={onChangeNumber}
          placeholderTextColor={colors.textMuted}
          style={[styles.timeInput, { color: colors.text, borderBottomColor: colors.border }]}
        />
        <Text style={[styles.timeUnit, { color: colors.textMuted }]}>min</Text>
      </View>
    </View>
  );
}

function parseNonNegativeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return 0;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * A numeric TextInput bound to a `number` field — 0 displays as empty,
 * invalid keystrokes are ignored rather than clearing the field.
 *
 * Keeps its own local text buffer rather than deriving displayed text
 * straight from `value` on every keystroke: while typing something like
 * "0.5", the intermediate states "0" and "0." aren't valid committed
 * numbers, and re-deriving text from a committed value would snap the
 * field back to blank mid-keystroke, making a leading-zero decimal
 * impossible to type. The local buffer always shows exactly what was
 * typed; `onChangeNumber` (and therefore the parent's Recipe draft) only
 * updates once the text parses to a real number.
 */
function NumberInput({
  value,
  onChangeNumber,
  style,
  placeholder,
  placeholderTextColor,
}: {
  value: number;
  onChangeNumber: (value: number) => void;
  style?: object;
  placeholder?: string;
  placeholderTextColor?: string;
}) {
  const [text, setText] = useState(() => (value === 0 ? '' : String(value)));

  return (
    <TextInput
      value={text}
      onChangeText={(nextText) => {
        setText(nextText);
        const parsed = parseNonNegativeNumber(nextText);
        if (parsed !== null) {
          onChangeNumber(parsed);
        }
      }}
      keyboardType="decimal-pad"
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      underlineColorAndroid="transparent"
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 14,
  },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  titleInput: {
    fontFamily: Fonts.serif,
    fontSize: 26,
    lineHeight: 32,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 20,
  },
  servingsField: {
    flex: 1,
  },
  servingsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  servingsCount: {
    fontSize: 15,
    width: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  servingsLabel: {
    fontSize: 15,
    flex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  timeField: {
    flex: 1,
  },
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeInput: {
    fontSize: 15,
    width: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  timeUnit: {
    fontSize: 13,
  },
  section: {
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
    alignItems: 'flex-start',
    paddingVertical: 10,
    gap: 10,
  },
  ingredientQty: {
    width: 44,
    fontSize: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  ingredientUnit: {
    width: 56,
    fontSize: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  ingredientName: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  methodStep: {
    marginTop: 24,
  },
  stepNumber: {
    fontSize: 18,
    lineHeight: 22,
  },
  stepInput: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
});
