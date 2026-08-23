/**
 * Runs the extraction pipeline against a small, deliberately diverse set of
 * real recipe URLs and reports what happened. Not a unit test suite (this
 * project has no test runner installed, and adding one just for this felt
 * like the wrong tradeoff for V1) — this is a coverage report: which real
 * sites work, which don't, and why.
 *
 * Run with: npm run test:extraction
 *
 * These URLs are test cases for measuring coverage, not a supported-site
 * allowlist — the extractor itself has no knowledge of this list.
 */

import { extractRecipeFromUrl } from './extract-recipe';

type CorpusCase = {
  label: string;
  url: string;
  /** Why this case is in the corpus. */
  reason: string;
};

const CORPUS: CorpusCase[] = [
  {
    label: 'Dish by Rish — Pistachio Kulfi Cookies',
    url: 'https://www.dishbyrish.co.uk/2021/03/pistachio-kulfi-cookies/',
    reason: 'independent WordPress food blog — the app\'s known reference case',
  },
  {
    label: 'Serious Eats — Corned Beef Hash',
    url: 'https://www.seriouseats.com/corned-beef-hash-recipe-5509275',
    reason: 'major food-media platform, custom CMS',
  },
  {
    label: 'Budget Bytes — Turkey Taco Skillet',
    url: 'https://www.budgetbytes.com/turkey-taco-skillet/',
    reason: 'independent WordPress food blog, different recipe plugin than Dish by Rish',
  },
  {
    label: 'Minimalist Baker — Best Vegan Biscuits',
    url: 'https://minimalistbaker.com/the-best-damn-vegan-biscuits/',
    reason: 'independent WordPress food blog',
  },
  {
    label: 'Food Network — Ina Garten\'s Meatloaf',
    url: 'https://www.foodnetwork.com/recipes/ina-garten/meat-loaf-recipe-1921718',
    reason: 'major TV/media brand, custom CMS',
  },
  {
    label: "Sally's Baking Addiction — Banana Bread",
    url: 'https://sallysbakingaddiction.com/best-banana-bread-recipe/',
    reason: 'independent WordPress food blog',
  },
  {
    label: 'AllRecipes — Banana Banana Bread',
    url: 'https://www.allrecipes.com/recipe/20144/banana-banana-bread/',
    reason: 'major UGC recipe platform',
  },
  {
    label: 'Smitten Kitchen — Lemon Bars',
    url: 'https://smittenkitchen.com/2008/01/lemon-bars/',
    reason: 'long-running independent food blog, older post',
  },
  {
    label: 'BBC Good Food (ME) — Ultimate Chocolate Cake',
    url: 'https://www.bbcgoodfoodme.com/recipes/ultimate-chocolate-cake/',
    reason: 'major media-brand recipe platform, different region/CMS',
  },
  {
    label: 'NYT Cooking — Roast Chicken',
    url: 'https://cooking.nytimes.com/recipes/1015812-roast-chicken',
    reason: 'gated major platform — included to see how it fails, whatever the reason turns out to be',
  },
  {
    label: 'Wikipedia — Chocolate chip cookie (not a recipe page)',
    url: 'https://en.wikipedia.org/wiki/Chocolate_chip_cookie',
    reason: 'expected-failure case: real page, zero Recipe structured data',
  },
  {
    label: 'Malformed input',
    url: 'not a url',
    reason: 'expected-failure case: validates the invalid-url path with no network call',
  },
];

function printField(label: string, value: string) {
  console.log(`    ${label.padEnd(12)} ${value}`);
}

async function run() {
  console.log(`Recipe extraction — test corpus (${CORPUS.length} cases)\n`);

  let successCount = 0;
  const failures: { label: string; code: string; message: string }[] = [];

  for (const testCase of CORPUS) {
    process.stdout.write(`▶ ${testCase.label}\n`);
    console.log(`    url          ${testCase.url}`);
    console.log(`    why          ${testCase.reason}`);

    const start = Date.now();
    const result = await extractRecipeFromUrl(testCase.url);
    const elapsedMs = Date.now() - start;

    if (result.ok) {
      successCount++;
      const r = result.recipe;
      console.log(`    result       ✅ success (${elapsedMs}ms)`);
      printField('title', r.title);
      printField('source', r.source);
      printField('servings', r.servings > 0 ? `${r.servings} ${r.servingsLabel}` : '(unknown)');
      printField(
        'time',
        r.prepTime || r.cookTime || r.totalTime
          ? `prep ${r.prepTime}m / cook ${r.cookTime}m / total ${r.totalTime}m`
          : '(unknown)'
      );
      printField('ingredients', `${r.ingredients.length} lines`);
      printField('instructions', `${r.instructions.length} steps`);
      printField('image', r.imageUrl ? 'found' : '(none)');
      if (r.extraction && r.extraction.warnings.length > 0) {
        printField('warnings', String(r.extraction.warnings.length));
        for (const warning of r.extraction.warnings) {
          console.log(`      - [${warning.field}] ${warning.message}`);
        }
      }
      // A couple of sample lines, so correctness can be eyeballed, not just counted.
      if (r.ingredients[0]) {
        printField('e.g. ingredient', `${r.ingredients[0].quantity} ${r.ingredients[0].unit} ${r.ingredients[0].name}`.trim());
      }
      if (r.instructions[0]) {
        printField('e.g. step 1', r.instructions[0].slice(0, 90) + (r.instructions[0].length > 90 ? '…' : ''));
      }
    } else {
      failures.push({ label: testCase.label, code: result.error.code, message: result.error.message });
      console.log(`    result       ❌ ${result.error.code} (${elapsedMs}ms)`);
      printField('message', result.error.message);
    }
    console.log('');
  }

  console.log('─'.repeat(60));
  console.log(`${successCount}/${CORPUS.length} succeeded, ${failures.length}/${CORPUS.length} failed\n`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const failure of failures) {
      console.log(`  - ${failure.label}: [${failure.code}] ${failure.message}`);
    }
  }
}

run();
