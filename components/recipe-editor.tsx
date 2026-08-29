import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  resolveComponentIngredients,
  resolveComponentInstructions,
  type Ingredient,
  type Recipe,
} from '@/constants/recipes';
import { Colors, Fonts } from '@/constants/theme';

type RecipeEditorProps = {
  recipe: Recipe;
  onChange: (recipe: Recipe) => void;
};

type Colors_ = (typeof Colors)['light'];
type InputProps = { placeholderTextColor: string; underlineColorAndroid: 'transparent' };

/**
 * The editable counterpart to RecipeContent (components/recipe-content.tsx)
 * — same editorial layout (title, servings/time metadata, Ingredients,
 * Method), but every field is a controlled input instead of static text.
 * Used only by the Preview screen while reviewing a freshly extracted
 * recipe; RecipeContent renders the same recipe read-only for the saved-
 * recipe detail screen. Both share the component-grouping logic below
 * (see resolveComponentIngredients/resolveComponentInstructions in
 * constants/recipes.ts) so a recipe's structure renders identically
 * whether it's being edited or just read.
 *
 * Ingredient quantity/unit/name are kept as three separate fields here —
 * matching the canonical Ingredient model — rather than one free-text
 * line, so editing never needs to re-parse text (that's extraction's job,
 * not this screen's).
 *
 * Component rendering: when `recipe.components` is present (see
 * constants/recipes.ts and ai/providers/anthropic-recipe-organizer.ts),
 * ingredients and instructions are grouped under their component's name
 * instead of one flat list each — still all ingredients before all
 * instructions, per component, matching the source recipe's own
 * structure. `updateIngredient`/`updateInstruction` always address the
 * recipe's real flat arrays by their true index; grouping is purely a
 * rendering concern layered on top; editing a field is identical either
 * way. No `components` (the common case) renders exactly as before.
 */
export function RecipeEditor({ recipe, onChange }: RecipeEditorProps) {
  const colors = Colors.light;
  const components = recipe.components && recipe.components.length > 0 ? recipe.components : null;

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

  const inputProps: InputProps = {
    placeholderTextColor: colors.textMuted,
    underlineColorAndroid: 'transparent',
  };

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
          {components
            ? components.map((component, componentIndex) => (
                <View key={component.name} style={componentIndex > 0 ? styles.componentGroup : undefined}>
                  <Text style={[styles.componentLabel, { color: colors.textMuted }]}>{component.name}</Text>
                  {resolveComponentIngredients(recipe, component).map(({ ingredient, index }, i, entries) => (
                    <IngredientEditorRow
                      key={ingredient.id}
                      ingredient={ingredient}
                      isLast={i === entries.length - 1}
                      colors={colors}
                      inputProps={inputProps}
                      onChange={(patch) => updateIngredient(index, patch)}
                    />
                  ))}
                </View>
              ))
            : recipe.ingredients.map((ingredient, index) => (
                <IngredientEditorRow
                  key={ingredient.id}
                  ingredient={ingredient}
                  isLast={index === recipe.ingredients.length - 1}
                  colors={colors}
                  inputProps={inputProps}
                  onChange={(patch) => updateIngredient(index, patch)}
                />
              ))}
        </View>
      ) : null}

      {recipe.instructions.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>Method</Text>
          <View style={[styles.sectionRule, { backgroundColor: colors.border }]} />
          {components
            ? components.map((component, componentIndex) => (
                <View key={component.name} style={componentIndex > 0 ? styles.componentGroup : undefined}>
                  <Text style={[styles.componentLabel, { color: colors.textMuted }]}>{component.name}</Text>
                  {resolveComponentInstructions(recipe, component).map(({ step, index }, i) => (
                    <InstructionEditorRow
                      key={index}
                      step={step}
                      displayNumber={i + 1}
                      colors={colors}
                      inputProps={inputProps}
                      onChange={(text) => updateInstruction(index, text)}
                    />
                  ))}
                </View>
              ))
            : recipe.instructions.map((step, index) => (
                <InstructionEditorRow
                  key={index}
                  step={step}
                  displayNumber={index + 1}
                  colors={colors}
                  inputProps={inputProps}
                  onChange={(text) => updateInstruction(index, text)}
                />
              ))}
        </View>
      ) : null}
    </View>
  );
}

function IngredientEditorRow({
  ingredient,
  isLast,
  colors,
  inputProps,
  onChange,
}: {
  ingredient: Ingredient;
  isLast: boolean;
  colors: Colors_;
  inputProps: InputProps;
  onChange: (patch: Partial<Ingredient>) => void;
}) {
  return (
    <View
      style={[
        styles.ingredientRow,
        !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}>
      <NumberInput
        value={ingredient.quantity}
        onChangeNumber={(value) => onChange({ quantity: value })}
        placeholder="qty"
        placeholderTextColor={colors.textMuted}
        style={[styles.ingredientQty, { color: colors.textMuted, borderBottomColor: colors.border }]}
      />
      <TextInput
        {...inputProps}
        value={ingredient.unit}
        onChangeText={(text) => onChange({ unit: text })}
        placeholder="unit"
        style={[styles.ingredientUnit, { color: colors.textMuted, borderBottomColor: colors.border }]}
      />
      <TextInput
        {...inputProps}
        value={ingredient.name}
        onChangeText={(text) => onChange({ name: text })}
        placeholder="ingredient"
        multiline
        style={[styles.ingredientName, { color: colors.text, borderBottomColor: colors.border }]}
      />
    </View>
  );
}

function InstructionEditorRow({
  step,
  displayNumber,
  colors,
  inputProps,
  onChange,
}: {
  step: string;
  displayNumber: number;
  colors: Colors_;
  inputProps: InputProps;
  onChange: (text: string) => void;
}) {
  return (
    <View style={styles.methodStep}>
      <Text style={[styles.stepNumber, { color: colors.textMuted, fontFamily: Fonts.serif }]}>
        {String(displayNumber).padStart(2, '0')}
      </Text>
      <TextInput
        {...inputProps}
        value={step}
        onChangeText={onChange}
        placeholder="Step text"
        multiline
        style={[styles.stepInput, { color: colors.text, borderBottomColor: colors.border }]}
      />
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
  colors: Colors_;
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
  // A component's name, e.g. "Kebabs" — a sub-heading under Ingredients/
  // Method, quieter than sectionLabel (that's the Ingredients/Method
  // heading itself; this is one level down).
  componentLabel: {
    fontFamily: Fonts.serif,
    fontSize: 15,
    marginTop: 14,
    marginBottom: 2,
  },
  componentGroup: {
    marginTop: 10,
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
