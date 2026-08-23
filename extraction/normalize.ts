/**
 * Normalizes a raw Schema.org Recipe node into SousChef's canonical
 * `NormalizedRecipeFields` — the one place that absorbs schema.org's
 * real-world inconsistency (recipeYield as a bare number vs. "Serves 4-6";
 * recipeInstructions as a string vs. HowToStep[] vs. nested HowToSection
 * groups; durations as ISO-8601) so nothing downstream has to know schema.org
 * exists at all.
 *
 * Shared by every extraction strategy (see types.ts) — normalization logic
 * is never duplicated per strategy.
 */

import type { Ingredient, ExtractionWarning } from '@/constants/recipes';
import type { NormalizedRecipeFields, NormalizeResult } from './types';

export function normalizeSchemaOrgRecipe(node: Record<string, unknown>, url: URL): NormalizeResult {
  const warnings: ExtractionWarning[] = [];

  const title = typeof node.name === 'string' && node.name.trim() ? node.name.trim() : 'Untitled recipe';

  const ingredientLines = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [];
  const ingredients = ingredientLines
    .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    .map((line, index) => parseIngredientLine(line, index));
  ingredients.forEach((ingredient, index) => {
    if (ingredient.quantity <= 0 && !ingredient.unit) {
      warnings.push({
        field: `ingredients[${index}]`,
        message: `Couldn't find a quantity/unit for "${ingredient.name}" — kept the full text as the name.`,
      });
    }
  });

  const instructions = extractInstructionSteps(node.recipeInstructions);

  const { servings, servingsLabel } = normalizeServings(node.recipeYield);
  if (servings <= 0) {
    warnings.push({ field: 'servings', message: 'No servings/yield found on the page.' });
  }

  const prepTime = parseIso8601DurationMinutes(node.prepTime);
  const cookTime = parseIso8601DurationMinutes(node.cookTime);
  const totalTime = parseIso8601DurationMinutes(node.totalTime);
  if (prepTime <= 0 && cookTime <= 0 && totalTime <= 0) {
    warnings.push({ field: 'time', message: 'No prep/cook/total time found on the page.' });
  }

  const imageUrl = extractImageUrl(node.image);

  const fields: NormalizedRecipeFields = {
    title,
    source: extractSourceName(node, url),
    sourceUrl: url.toString(),
    servings,
    servingsLabel,
    prepTime,
    cookTime,
    totalTime,
    ingredients,
    instructions,
    ...(imageUrl ? { imageUrl } : {}),
  };

  return { fields, warnings };
}

// ---------------------------------------------------------------------------
// Field normalizers
// ---------------------------------------------------------------------------

function extractNameFrom(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const name = extractNameFrom(item);
      if (name) {
        return name;
      }
    }
    return '';
  }
  if (raw && typeof raw === 'object') {
    const name = (raw as Record<string, unknown>).name;
    if (typeof name === 'string') {
      return name;
    }
  }
  return '';
}

/** Prefers the recipe's credited author; falls back to a name guessed from the site's domain, so `source` is never empty. */
function extractSourceName(node: Record<string, unknown>, url: URL): string {
  const authorName = extractNameFrom(node.author);
  if (authorName) {
    return authorName;
  }
  const hostname = url.hostname.replace(/^www\./, '');
  const base = hostname.split('.')[0];
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractImageUrl(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = extractImageUrl(item);
      if (found) {
        return found;
      }
    }
    return '';
  }
  if (raw && typeof raw === 'object') {
    const url = (raw as Record<string, unknown>).url;
    if (typeof url === 'string') {
      return url;
    }
  }
  return '';
}

/** "PT20M" / "PT1H5M" -> minutes. Also handles a {minValue,maxValue} duration range, taking maxValue. Returns 0 (unknown) for anything unparseable. */
function parseIso8601DurationMinutes(raw: unknown): number {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const range = raw as Record<string, unknown>;
    if (typeof range.maxValue === 'string') {
      return parseIso8601DurationMinutes(range.maxValue);
    }
  }
  if (typeof raw !== 'string') {
    return 0;
  }
  const match = raw.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) {
    return 0;
  }
  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days || 0) * 24 * 60 +
    Number(hours || 0) * 60 +
    Number(minutes || 0) +
    Math.round(Number(seconds || 0) / 60);
  return Number.isFinite(total) ? total : 0;
}

/** recipeYield is one of the least standardized schema.org fields in practice — a bare number, "4", "4 servings", "Serves 4-6", or an array of these. */
function normalizeServings(raw: unknown): { servings: number; servingsLabel: string } {
  const value = Array.isArray(raw) ? raw.find((item) => item !== undefined && item !== null) : raw;

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { servings: value, servingsLabel: 'servings' };
  }
  if (typeof value !== 'string') {
    return { servings: 0, servingsLabel: '' };
  }
  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match) {
    return { servings: 0, servingsLabel: '' };
  }
  const servings = parseFloat(match[0]);
  const remainder = value
    .slice((match.index ?? 0) + match[0].length)
    .replace(/^[\s\-–to]+/i, '')
    .trim();
  return { servings, servingsLabel: remainder || 'servings' };
}

/** Flattens recipeInstructions: a plain string, an array of strings, an array of HowToStep, or HowToSection groups containing either. */
function extractInstructionSteps(raw: unknown): string[] {
  if (!raw) {
    return [];
  }
  if (typeof raw === 'string') {
    return raw
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => extractInstructionSteps(item));
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.itemListElement)) {
      return extractInstructionSteps(obj.itemListElement);
    }
    if (typeof obj.text === 'string') {
      return obj.text.trim() ? [obj.text.trim()] : [];
    }
    if (typeof obj.name === 'string') {
      return obj.name.trim() ? [obj.name.trim()] : [];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Ingredient line parsing (free text -> quantity/unit/name)
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};
const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');

const UNIT_ALIASES: Record<string, string> = {
  tablespoons: 'tbsp',
  tablespoon: 'tbsp',
  tbsps: 'tbsp',
  tbs: 'tbsp',
  teaspoons: 'tsp',
  teaspoon: 'tsp',
  tsps: 'tsp',
  cups: 'cup',
  grams: 'g',
  gram: 'g',
  kilograms: 'kg',
  kilogram: 'kg',
  ounces: 'oz',
  ounce: 'oz',
  pounds: 'lb',
  lbs: 'lb',
  milliliters: 'ml',
  milliliter: 'ml',
  liters: 'l',
  liter: 'l',
  litres: 'l',
  litre: 'l',
  pinches: 'pinch',
  dashes: 'dash',
  cloves: 'clove',
  cans: 'can',
  sticks: 'stick',
  slices: 'slice',
  pieces: 'piece',
  packages: 'package',
  pkgs: 'package',
  pkg: 'package',
  bunches: 'bunch',
  heads: 'head',
};
// UNIT_ALIASES only maps *variant* spellings to their canonical form (e.g.
// "tablespoons" -> "tbsp") — the canonical forms themselves ("tbsp", "cup",
// "pinch", ...) are its *values*, not its keys, and need including
// explicitly or a recipe that already writes the canonical singular form
// (real ones do — "1 cup", "Pinch of salt") would never match at all.
const UNIT_WORDS = [
  ...new Set([
    ...Object.keys(UNIT_ALIASES),
    ...Object.values(UNIT_ALIASES),
    'g',
    'kg',
    'oz',
    'lb',
    'ml',
    'l',
    'large',
    'medium',
    'small',
  ]),
].sort((a, b) => b.length - a.length);
const UNIT_PATTERN = new RegExp(`^(${UNIT_WORDS.join('|')})\\b\\.?`, 'i');

function parseLeadingQuantity(text: string): { quantity: number; rest: string } | null {
  const trimmed = text.trim();

  let match = trimmed.match(new RegExp(`^(\\d+)\\s*([${UNICODE_FRACTION_CHARS}])`));
  if (match) {
    return {
      quantity: parseInt(match[1], 10) + UNICODE_FRACTIONS[match[2]],
      rest: trimmed.slice(match[0].length).trim(),
    };
  }
  match = trimmed.match(new RegExp(`^([${UNICODE_FRACTION_CHARS}])`));
  if (match) {
    return { quantity: UNICODE_FRACTIONS[match[1]], rest: trimmed.slice(match[0].length).trim() };
  }
  match = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)\b/);
  if (match) {
    return {
      quantity: parseInt(match[1], 10) + parseInt(match[2], 10) / parseInt(match[3], 10),
      rest: trimmed.slice(match[0].length).trim(),
    };
  }
  match = trimmed.match(/^(\d+)\/(\d+)\b/);
  if (match) {
    return { quantity: parseInt(match[1], 10) / parseInt(match[2], 10), rest: trimmed.slice(match[0].length).trim() };
  }
  // A range like "2-3" or "2 to 3" — takes the lower bound as an approximation.
  match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*\d+(?:\.\d+)?/);
  if (match) {
    return { quantity: parseFloat(match[1]), rest: trimmed.slice(match[0].length).trim() };
  }
  // A plain number, possibly with no space before a unit ("180g").
  match = trimmed.match(/^(\d+(?:\.\d+)?)/);
  if (match) {
    return { quantity: parseFloat(match[1]), rest: trimmed.slice(match[0].length).trim() };
  }
  return null;
}

function parseLeadingUnit(text: string): { unit: string; rest: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(UNIT_PATTERN);
  if (!match) {
    return null;
  }
  const word = match[1].toLowerCase();
  return { unit: UNIT_ALIASES[word] ?? word, rest: trimmed.slice(match[0].length).trim() };
}

function parseIngredientLine(raw: string, index: number): Ingredient {
  const text = raw.replace(/\s+/g, ' ').trim();
  const qtyResult = parseLeadingQuantity(text);
  const quantity = qtyResult?.quantity ?? 0;
  let rest = qtyResult?.rest ?? text;

  const unitResult = parseLeadingUnit(rest);
  const unit = unitResult?.unit ?? '';
  if (unitResult) {
    rest = unitResult.rest;
  }

  const name = rest.replace(/^of\s+/i, '').trim() || text;
  return { id: `ingredient-${index}`, quantity, unit, name };
}
