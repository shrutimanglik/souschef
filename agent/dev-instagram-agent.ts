/**
 * Dev entry point for the Instagram recipe-source-discovery agent — run
 * with a single Instagram URL and inspect the full evidence trail: every
 * tool call the agent made, the source URL it settled on, the existing
 * deterministic pipeline's extraction result for that URL, and any
 * warnings. Same spirit as extraction/test-corpus.ts (a coverage/inspection
 * script, not a test runner this project doesn't have).
 *
 * Run with: npm run agent:instagram -- <instagram-url>
 * (needs ANTHROPIC_API_KEY and SCRAPECREATORS_API_KEY — both loaded from
 * .env via the npm script's `--env-file=.env`.)
 */

import { runInstagramRecipeAgent } from './instagram-recipe-agent';

function printField(label: string, value: string) {
  console.log(`  ${label.padEnd(16)} ${value}`);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npm run agent:instagram -- <instagram-url>');
    process.exit(1);
  }

  console.log(`Instagram recipe agent\n`);
  printField('input', url);
  console.log('');

  const start = Date.now();
  const result = await runInstagramRecipeAgent(url, process.env.ANTHROPIC_API_KEY, process.env.SCRAPECREATORS_API_KEY);
  const elapsedMs = Date.now() - start;

  console.log(`Tool calls (${result.toolCalls.length}):`);
  for (const call of result.toolCalls) {
    const inputPreview = JSON.stringify(call.input);
    console.log(`  [turn ${call.turn}] ${call.ok ? '✅' : '❌'} ${call.tool}(${inputPreview})`);
    if (call.tool === 'get_instagram_metadata' && call.ok) {
      // Full normalized metadata, pretty-printed — the whole point of this
      // dev CLI is to make this specific object inspectable.
      try {
        console.log(
          JSON.stringify(JSON.parse(call.summary), null, 2)
            .split('\n')
            .map((line) => `      ${line}`)
            .join('\n')
        );
      } catch {
        console.log(`      -> ${call.summary}`);
      }
    } else {
      console.log(`      -> ${call.summary}`);
    }
  }
  console.log('');

  if (!result.ok) {
    console.log(`Result: ❌ agent failed (${elapsedMs}ms)`);
    printField('code', result.error.code);
    printField('message', result.error.message);
    process.exit(1);
  }

  console.log(`Result (${elapsedMs}ms):`);
  printField('selected URL', result.selectedSourceUrl ?? '(none found)');
  printField('confidence', result.confidence);
  printField('discovery', result.discovery);

  if (result.warnings.length > 0) {
    console.log('  warnings:');
    for (const warning of result.warnings) {
      console.log(`    - ${warning}`);
    }
  }

  console.log('');
  console.log('Final extraction result:');
  if (!result.extraction) {
    printField('extraction', '(none — no source was extracted)');
  } else if (!result.extraction.ok) {
    printField('extraction', `❌ [${result.extraction.error.code}] ${result.extraction.error.message}`);
  } else {
    const recipe = result.extraction.recipe;
    printField('title', recipe.title);
    printField('source', recipe.source);
    printField('ingredients', `${recipe.ingredients.length} lines`);
    printField('instructions', `${recipe.instructions.length} steps`);
    if (recipe.extraction && recipe.extraction.warnings.length > 0) {
      console.log('  extraction warnings:');
      for (const warning of recipe.extraction.warnings) {
        console.log(`    - [${warning.field}] ${warning.message}`);
      }
    }
  }
}

main().catch((error) => {
  console.error('Agent run threw unexpectedly:', error);
  process.exit(1);
});
