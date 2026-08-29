/**
 * Exercises AnthropicRecipeOrganizer end to end (live Claude calls) plus
 * the pure validateAndBuildComponents boundary (no network) against the
 * five cases called out when this feature was built:
 *
 *   1. a normal, single-component recipe
 *   2. a 2-component recipe (the "kebabs" / "chutney" example)
 *   3. a 3+ component recipe
 *   4. an ambiguous recipe with no real component structure
 *   5. deliberately invalid/hallucinated LLM output
 *
 * Not a unit test suite (this project has no test runner installed — see
 * extraction/test-corpus.ts for the same tradeoff) — this is a pass/fail
 * report. Cases 1-4 need ANTHROPIC_API_KEY (a real model call is the only
 * way to check what the organizer actually decides to group); case 5 needs
 * no key at all, since it tests validateAndBuildComponents directly.
 *
 * Run with: npm run test:organizer
 */

import Anthropic from '@anthropic-ai/sdk';

import type { Ingredient, Recipe, RecipeComponent } from '@/constants/recipes';

import { createAnthropicClient } from './providers/anthropic';
import {
  AnthropicRecipeOrganizer,
  isNameGroundedInSource,
  validateAndBuildComponents,
} from './providers/anthropic-recipe-organizer';

let ingredientCounter = 0;
function ing(quantity: number, unit: string, name: string): Ingredient {
  ingredientCounter += 1;
  return { id: `ing-${ingredientCounter}`, quantity, unit, name };
}

function recipe(overrides: Partial<Recipe> & Pick<Recipe, 'title' | 'ingredients' | 'instructions'>): Recipe {
  return {
    id: 'test-recipe',
    source: 'Test',
    sourceUrl: 'https://example.com/test',
    servings: 4,
    servingsLabel: 'servings',
    prepTime: 10,
    cookTime: 10,
    totalTime: 20,
    ...overrides,
  };
}

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `\n       ${detail}` : ''}`);
}

/**
 * The hard constraints from the spec, checked against organize()'s actual
 * output rather than trusted from the type system alone: ingredients and
 * instructions must be byte-for-byte unchanged, and if components are
 * present they must exactly partition both arrays (every original entry
 * covered exactly once, nothing invented).
 */
function checkHardConstraints(original: Recipe, actual: Recipe): string | null {
  if (JSON.stringify(actual.ingredients) !== JSON.stringify(original.ingredients)) {
    return 'ingredients were changed';
  }
  if (JSON.stringify(actual.instructions) !== JSON.stringify(original.instructions)) {
    return 'instructions were changed';
  }
  if (!actual.components) {
    return null;
  }
  const seenIngredientIds = new Set<string>();
  const seenInstructionIndexes = new Set<number>();
  for (const component of actual.components) {
    if (!component.name.trim()) {
      return 'a component has an empty name';
    }
    // The bug this file regression-tests: a component name that isn't
    // actually lifted verbatim from the recipe's own text (e.g. a
    // paraphrase like "Spice Dumpling Sauce" for source wording "spicy
    // dumpling sauce"). Resolve ids/indexes to their true array positions
    // first, since ingredientIds aren't in flat-array-index order.
    const ingredientIndexes = component.ingredientIds.map((id) =>
      original.ingredients.findIndex((i) => i.id === id)
    );
    if (!isNameGroundedInSource(original, component.name, ingredientIndexes, component.instructionIndexes)) {
      return `component name "${component.name}" is not grounded in its own assigned ingredient/instruction text`;
    }
    for (const id of component.ingredientIds) {
      if (!original.ingredients.some((i) => i.id === id)) {
        return `component "${component.name}" references unknown ingredient id ${id}`;
      }
      if (seenIngredientIds.has(id)) {
        return `ingredient id ${id} referenced by more than one component`;
      }
      seenIngredientIds.add(id);
    }
    for (const index of component.instructionIndexes) {
      if (index < 0 || index >= original.instructions.length) {
        return `component "${component.name}" references out-of-range instruction index ${index}`;
      }
      if (seenInstructionIndexes.has(index)) {
        return `instruction index ${index} referenced by more than one component`;
      }
      seenInstructionIndexes.add(index);
    }
  }
  if (seenIngredientIds.size !== original.ingredients.length) {
    return `components cover ${seenIngredientIds.size}/${original.ingredients.length} ingredients — not an exact partition`;
  }
  if (seenInstructionIndexes.size !== original.instructions.length) {
    return `components cover ${seenInstructionIndexes.size}/${original.instructions.length} instructions — not an exact partition`;
  }
  return null;
}

// ---- Fixtures --------------------------------------------------------

const singleComponentRecipe = recipe({
  title: 'Banana Bread',
  ingredients: [
    ing(2, 'cup', 'flour'),
    ing(1, 'tsp', 'baking soda'),
    ing(0.5, 'tsp', 'salt'),
    ing(0.5, 'cup', 'butter, softened'),
    ing(0.75, 'cup', 'sugar'),
    ing(2, '', 'eggs'),
    ing(3, '', 'ripe bananas, mashed'),
  ],
  instructions: [
    'Preheat the oven to 350F and grease a loaf pan.',
    'Whisk together the flour, baking soda, and salt in a bowl.',
    'In a separate bowl, cream the butter and sugar until fluffy.',
    'Beat in the eggs one at a time, then stir in the mashed bananas.',
    'Fold the dry ingredients into the wet ingredients until just combined.',
    'Pour the batter into the prepared pan and bake for 60 minutes.',
  ],
});

const twoComponentRecipe = recipe({
  title: 'Lamb Kebabs with Mint Chutney',
  ingredients: [
    ing(500, 'g', 'ground lamb, for the kebabs'),
    ing(1, 'tsp', 'ground cumin, for the kebabs'),
    ing(1, '', 'small onion, grated, for the kebabs'),
    ing(1, 'cup', 'fresh mint leaves, for the chutney'),
    ing(1, 'cup', 'fresh cilantro, for the chutney'),
    ing(1, 'tbsp', 'lemon juice, for the chutney'),
  ],
  instructions: [
    'For the kebabs, combine the lamb, cumin, and onion in a bowl and mix well.',
    'Shape the mixture around skewers.',
    'Grill the kebabs for 4 minutes per side, until cooked through.',
    'For the chutney, blend the mint, cilantro, and lemon juice until smooth.',
    'Season the chutney with salt to taste.',
  ],
});

const threeComponentRecipe = recipe({
  title: 'Caramel Chocolate Oat Bars',
  ingredients: [
    ing(1, 'cup', 'rolled oats, for the crust'),
    ing(0.5, 'cup', 'butter, melted, for the crust'),
    ing(0.25, 'cup', 'brown sugar, for the crust'),
    ing(1, 'cup', 'caramel sauce, for the filling'),
    ing(0.5, 'tsp', 'flaky salt, for the filling'),
    ing(0.5, 'cup', 'chocolate chips, for the topping'),
    ing(0.25, 'cup', 'chopped toasted nuts, for the topping'),
  ],
  instructions: [
    'For the crust, mix the oats, melted butter, and brown sugar, press into a lined pan, and bake for 10 minutes.',
    'For the filling, pour the caramel sauce over the baked crust and sprinkle with flaky salt.',
    'For the topping, scatter the chocolate chips and nuts over the caramel layer, then chill for at least 2 hours before slicing.',
  ],
});

const ambiguousRecipe = recipe({
  title: 'Weeknight Pasta',
  ingredients: [
    ing(8, 'oz', 'pasta'),
    ing(1, 'cup', 'marinara sauce'),
    ing(0.5, 'cup', 'grated parmesan'),
    ing(1, 'tbsp', 'olive oil'),
    ing(1, 'pinch', 'salt and pepper, to taste'),
  ],
  instructions: [
    'Cook the pasta according to package directions, then drain.',
    'Heat the olive oil in a pan and warm the marinara sauce.',
    'Toss the pasta with the sauce and parmesan, and season with salt and pepper.',
  ],
});

// Real extraction output for the exact recipe the "Spice Dumpling Sauce"
// bug was reported against (dishbyrish.co.uk/2025/05/tofu-and-vegetable-
// wontons) — captured verbatim via extractRecipeFromUrl so this is a true
// regression test, not a synthetic approximation. The source page's own
// ingredient-list heading ("For the Spicy Wonton Sauce:") lives only in
// page HTML and was never part of this extracted data (see the JSON-LD
// dump from the investigation) — the nearest grounding available to the
// organizer is instructions 9/10's own wording.
const wontonsRecipe = recipe({
  title: 'Tofu and Vegetable Wontons',
  ingredients: [
    ing(0, '', '~45 wonton wrappers'),
    ing(2, 'tbsp', 'neutral oil (sunflower/rapeseed/avocado/peanut)'),
    ing(340, 'g', 'extra firm tofu'),
    ing(170, 'g', 'carrot (~1 medium sized)'),
    ing(50, 'g', 'edamame beans'),
    ing(125, 'g', 'shiitake mushrooms'),
    ing(2, 'clove', 'garlic, minced'),
    ing(2, '', '" piece of ginger, minced'),
    ing(2, 'tbsp', 'mushroom sauce/vegetarian oyster sauce'),
    ing(2, 'tbsp', 'light soy sauce'),
    ing(1, 'tsp', 'mushroom stock powder/vegetable stock powder (optional)'),
    ing(0.5, 'tsp', 'white pepper'),
    ing(0.25, 'tsp', 'Chinese 5 spice powder'),
    ing(4, '', 'garlic chives (spring onions/scallions can be used in lieu)'),
    ing(1, 'tsp', 'toasted sesame oil'),
    ing(2, 'tbsp', 'cornflour (cornflour for UK readers and corn starch for US readers)'),
    ing(6, 'tbsp', 'Chinese chilli oil'),
    ing(1, '', "+1/2 tbsp toasted white sesame seeds (not needed if it's in the chilli oil already)"),
    ing(6, 'tbsp', 'Chinese black vinegar (Chinkiang vinegar)'),
    ing(6, 'tbsp', 'light soy sauce'),
    ing(3, 'clove', 'garlic, grated'),
    ing(1, '', '+1/2 tbsp sugar'),
    ing(6, '', 'spring onion greens, finely chopped'),
    ing(0, '', 'Handful of coriander (~30g), finely chopped'),
    ing(3, 'tsp', 'toasted sesame oil'),
  ],
  instructions: [
    'First start by prepping all the vegetables and tofu. This is a quick cooking process so I recommend having everything prepped and ready',
    "Blitz the carrots, edamame, and shiitake mushrooms in a food processor until they're all very finely chopped. I recommend doing each one separately to ensure even sizes. For the extra firm tofu, this can either be blitzed in a food processor as well, or simply just crushed by hand",
    'To make the filling, heat the oil in a large pan over a medium heat. Add the tofu and mushrooms and sauté until the moisture has dried up and you start to see a small amount of caramelisation. At this point, add in the carrots, edamame, garlic, and ginger',
    'Continue to cook the mixture together for 2-3 minutes before adding the mushroom sauce, light soy sauce, 5 spice, stock powder, and white pepper',
    'Continue you to cook the tofu and vegetable filling for a further 1-2 minutes. Turn the heat off, and while still hot, add in the garlic chives, toasted sesame oil, and cornflour (this is corn starch for US readers and cornflour for UK). I prefer to transfer the mixture into a separate bowl to cool down',
    'Once cooled completely, place a tablespoon of filling right in the centre of a wonton wrapper. Then, using a wet finger tip, lightly wet the edges of the wrapper - this will help it to seal. I always keep a small bowl of water beside my folding area for this',
    'Fold the wonton in half, sealing around the filling tightly. Try and avoid air bubbles here as they can puff up and burst during cooking (especially if boiled too rapidly)',
    'Next, wet one edge of the folded wonton and bring both edges together - pinch tightly to seal. To prevent the wontons from drying out, place them into a tray lined with baking paper and cover with a lightly damp kitchen towel',
    'When ready to cook, bring a saucepan of water up to a rolling boil. Add in the wontons and reduce the heat to a gentle simmer. Simmer the wontons for 3-4 minutes, then remove using a spider or slotted spoon. The wontons can also be steamed for 6-7 minutes. If pan frying, heat oil in a frying pan and place the wontons in a single layer. Once the base has browned, add enough water to cover the base of the pan and cover with a lid. Allow the wontons to steam until all the water has evaporated',
    'To make the spicy dumpling sauce, simply mix together the chilli oil, black vinegar, light soy sauce, sugar, garlic, coriander, spring onions, and toasted sesame oil',
    'Next, add in the steaming hot wontons and gently toss them in the spicy wonton sauce to coat',
    'Finally, finish with sliced spring onions and enjoy your spicy saucy tofu and vegetable wontons!',
  ],
});

// ---- Live-call scenarios (1-4) ----------------------------------------

async function runLiveScenarios(client: Anthropic) {
  const organizer = new AnthropicRecipeOrganizer(client);

  {
    // The reported bug's exact repro. checkHardConstraints below enforces
    // both the lossless-partition invariant AND (via isNameGroundedInSource)
    // that any component name it comes back with is lifted verbatim from
    // the recipe's own text — so a repeat of "Spice Dumpling Sauce" for
    // source wording "spicy dumpling sauce" fails this test rather than
    // silently passing.
    const result = await organizer.organize(wontonsRecipe);
    const constraintError = checkHardConstraints(wontonsRecipe, result);
    if (constraintError) {
      record('0. reported-bug repro — tofu & vegetable wontons', false, constraintError);
    } else {
      record(
        '0. reported-bug repro — tofu & vegetable wontons',
        true,
        result.components
          ? `components: ${result.components.map(describeComponent).join(' | ')}`
          : 'no components proposed'
      );
    }
  }

  {
    const result = await organizer.organize(singleComponentRecipe);
    const constraintError = checkHardConstraints(singleComponentRecipe, result);
    if (constraintError) {
      record('1. normal single-component recipe', false, constraintError);
    } else if (result.components) {
      record(
        '1. normal single-component recipe',
        false,
        `expected no components, got ${result.components.length}: ${result.components.map((c) => c.name).join(', ')}`
      );
    } else {
      record('1. normal single-component recipe', true, 'no components proposed, as expected');
    }
  }

  {
    const result = await organizer.organize(twoComponentRecipe);
    const constraintError = checkHardConstraints(twoComponentRecipe, result);
    if (constraintError) {
      record('2. two-component recipe (kebabs / chutney)', false, constraintError);
    } else if (!result.components || result.components.length !== 2) {
      record(
        '2. two-component recipe (kebabs / chutney)',
        false,
        `expected 2 components, got ${result.components?.length ?? 0}`
      );
    } else {
      const names = result.components.map((c) => c.name.toLowerCase());
      const hasKebab = names.some((n) => n.includes('kebab'));
      const hasChutney = names.some((n) => n.includes('chutney'));
      record(
        '2. two-component recipe (kebabs / chutney)',
        hasKebab && hasChutney,
        `components: ${result.components.map(describeComponent).join(' | ')}`
      );
    }
  }

  {
    const result = await organizer.organize(threeComponentRecipe);
    const constraintError = checkHardConstraints(threeComponentRecipe, result);
    if (constraintError) {
      record('3. three-component recipe (crust / filling / topping)', false, constraintError);
    } else if (!result.components || result.components.length !== 3) {
      record(
        '3. three-component recipe (crust / filling / topping)',
        false,
        `expected 3 components, got ${result.components?.length ?? 0}`
      );
    } else {
      record(
        '3. three-component recipe (crust / filling / topping)',
        true,
        `components: ${result.components.map(describeComponent).join(' | ')}`
      );
    }
  }

  {
    const result = await organizer.organize(ambiguousRecipe);
    const constraintError = checkHardConstraints(ambiguousRecipe, result);
    if (constraintError) {
      record('4. ambiguous recipe with no real component structure', false, constraintError);
    } else if (result.components) {
      record(
        '4. ambiguous recipe with no real component structure',
        false,
        `expected no components, got ${result.components.length}: ${result.components.map((c) => c.name).join(', ')}`
      );
    } else {
      record('4. ambiguous recipe with no real component structure', true, 'no components proposed, as expected');
    }
  }
}

function describeComponent(c: RecipeComponent): string {
  return `${c.name} [ingredients ${c.ingredientIds.length}, instructions ${c.instructionIndexes.length}]`;
}

// ---- Pure validation scenario (5) — no network -------------------------

function runHallucinationScenarios() {
  const base = recipe({
    title: 'Simple Salad',
    ingredients: [ing(2, 'cup', 'lettuce'), ing(1, '', 'tomato'), ing(0.25, 'cup', 'dressing'), ing(1, 'tbsp', 'olive oil')],
    instructions: ['Chop the lettuce and tomato.', 'Toss with dressing and olive oil.', 'Serve immediately.'],
  });

  const cases: Array<{ label: string; parsed: unknown }> = [
    {
      label: 'out-of-range ingredient index',
      parsed: [{ name: 'Salad', ingredientIndexes: [0, 1, 2, 99], instructionIndexes: [0, 1, 2] }],
    },
    {
      label: 'out-of-range instruction index',
      parsed: [{ name: 'Salad', ingredientIndexes: [0, 1, 2, 3], instructionIndexes: [0, 1, 2, 7] }],
    },
    {
      label: 'duplicate ingredient index across components',
      parsed: [
        { name: 'Greens', ingredientIndexes: [0, 1], instructionIndexes: [0] },
        { name: 'Dressing', ingredientIndexes: [1, 2, 3], instructionIndexes: [1, 2] },
      ],
    },
    {
      label: 'incomplete partition (an ingredient left uncovered)',
      parsed: [{ name: 'Salad', ingredientIndexes: [0, 1, 2], instructionIndexes: [0, 1, 2] }],
    },
    {
      label: 'empty component name',
      parsed: [{ name: '   ', ingredientIndexes: [0, 1, 2, 3], instructionIndexes: [0, 1, 2] }],
    },
    {
      label: 'malformed shape (ingredientIndexes not an array)',
      parsed: [{ name: 'Salad', ingredientIndexes: 'all', instructionIndexes: [0, 1, 2] }],
    },
    {
      // The exact shape of the reported bug: valid, fully-covering
      // indexes, but a name that paraphrases rather than reuses the
      // recipe's own wording verbatim (base's text never says "salad").
      label: 'ungrounded/paraphrased component name (e.g. "Spice Dumpling Sauce" for source "spicy dumpling sauce")',
      parsed: [{ name: 'Caesar Salad', ingredientIndexes: [0, 1, 2, 3], instructionIndexes: [0, 1, 2] }],
    },
  ];

  for (const { label, parsed } of cases) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcome = validateAndBuildComponents(base, parsed as any);
    record(`5. hallucinated LLM output — ${label}`, outcome === null, outcome === null ? 'rejected, as expected' : 'was NOT rejected');
  }

  // Positive control: confirms rejection above is actually discriminating
  // bad input, not just always returning null. "Dressing" is grounded —
  // it's a literal substring of ingredient index 2's own name.
  const validParsed = [{ name: 'Dressing', ingredientIndexes: [0, 1, 2, 3], instructionIndexes: [0, 1, 2] }];
  const validOutcome = validateAndBuildComponents(base, validParsed);
  record(
    '5. positive control — well-formed, grounded proposal is accepted',
    validOutcome !== null && validOutcome.length === 1,
    validOutcome ? describeComponent(validOutcome[0]) : 'rejected unexpectedly'
  );
}

async function main() {
  runHallucinationScenarios();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('\nANTHROPIC_API_KEY not set — skipping live scenarios 1-4 (run with `tsx --env-file=.env ...` to include them).');
  } else {
    await runLiveScenarios(createAnthropicClient(apiKey));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((f) => f.name).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
