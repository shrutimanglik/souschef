/**
 * Standalone capability CLI for Instagram transcripts — originally built
 * to answer "Can we reliably obtain a useful transcript from
 * ScrapeCreators?" in isolation (finding: the transcript endpoint does NOT
 * accept mediaUrl — it takes the same original Instagram URL the metadata
 * endpoint does; see agent/providers/scrapecreators-transcript.ts). The
 * transcript is also now a real agent tool (get_instagram_transcript — see
 * instagram-recipe-agent.ts); this script exercises the same provider
 * directly, without the agent's reasoning in the loop, for quick
 * inspection during development.
 *
 * Run with: npm run agent:instagram-transcript -- <instagram-url>
 * (needs SCRAPECREATORS_API_KEY — loaded from .env via the npm script's
 * `--env-file=.env`. Does not need ANTHROPIC_API_KEY — no Claude call here.)
 */

import { ScrapeCreatorsInstagramProvider } from './providers/scrapecreators-instagram';
import { ScrapeCreatorsTranscriptProvider } from './providers/scrapecreators-transcript';

const DEFAULT_URL = 'https://www.instagram.com/reel/Db3Lx8pIQq4/';

function printField(label: string, value: string) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

async function main() {
  const url = process.argv[2] ?? DEFAULT_URL;
  const apiKey = process.env.SCRAPECREATORS_API_KEY;

  console.log('Instagram media/transcript capability test\n');
  printField('input', url);
  console.log('');

  if (!apiKey) {
    console.error('SCRAPECREATORS_API_KEY is not configured — add it to .env.');
    process.exit(1);
  }

  // --- Step 1: retrieve the Reel's mediaUrl through the existing,
  // already-integrated Instagram metadata provider. ---
  console.log('Step 1 — get_instagram_metadata (existing provider)');
  const metadataProvider = new ScrapeCreatorsInstagramProvider(apiKey);
  const metadataStart = Date.now();
  const metadataResult = await metadataProvider.getMetadata(url);
  const metadataLatencyMs = Date.now() - metadataStart;

  if (!metadataResult.ok) {
    console.log(`  ❌ failed (${metadataLatencyMs}ms): [${metadataResult.error.code}] ${metadataResult.error.message}`);
    process.exit(1);
  }

  printField('latency', `${metadataLatencyMs}ms`);
  printField('mediaUrl', metadataResult.metadata.mediaUrl ? metadataResult.metadata.mediaUrl.slice(0, 80) + '…' : '(none)');
  printField('mediaType', metadataResult.metadata.mediaType ?? '(none)');
  console.log('');

  // --- Step 2: the transcript endpoint's documented input is the
  // ORIGINAL Instagram URL, not mediaUrl — confirmed against the official
  // docs (see scrapecreators-transcript.ts's header). We pass `url`, the
  // same input already used for metadata, not `metadataResult.metadata.mediaUrl`. ---
  console.log('Step 2 — transcript endpoint (isolated, not agent-integrated)');
  console.log('  Note: ScrapeCreators\' transcript endpoint does not accept mediaUrl — it');
  console.log('  takes the same Instagram post/Reel URL as the metadata endpoint and');
  console.log('  resolves/transcribes the video server-side. Passing the mediaUrl CDN link');
  console.log('  itself is not a documented input, so this test does not attempt that.');
  console.log('');

  const transcriptProvider = new ScrapeCreatorsTranscriptProvider(apiKey);
  const transcriptStart = Date.now();
  const transcriptResult = await transcriptProvider.getTranscript(url);
  const transcriptLatencyMs = Date.now() - transcriptStart;

  printField('latency', `${transcriptLatencyMs}ms`);

  if (!transcriptResult.ok) {
    printField('result', `❌ [${transcriptResult.error.code}] ${transcriptResult.error.message}`);
    console.log('');
    console.log('Failure modes this could mean (per the documented API contract):');
    console.log('  - Video is 2 minutes or longer (documented hard limit — no transcript at all, not a partial one)');
    console.log('  - Invalid/expired API key or insufficient credits');
    console.log('  - The URL is not a valid public Instagram post/Reel');
    process.exit(1);
  }

  printField('credits charged', transcriptResult.creditsCharged !== null ? String(transcriptResult.creditsCharged) : '(unknown)');
  printField('items returned', String(transcriptResult.transcripts.length));
  // Documented fact, not something this response could ever show either
  // way — the API returns plain `text` per item, no segments/timing.
  printField('timestamps available', 'no — endpoint returns plain text only, no segment/word timing');
  console.log('');

  if (transcriptResult.transcripts.length === 0) {
    console.log('No transcript items returned. Per the docs, this usually means no one is');
    console.log('speaking in the video (a normal outcome, not an error) — or the request');
    console.log('silently matched nothing usable.');
    return;
  }

  transcriptResult.transcripts.forEach((item, index) => {
    console.log(`Transcript item ${index + 1}:`);
    printField('id', item.id ?? '(none)');
    printField('shortcode', item.shortcode ?? '(none)');
    if (!item.text) {
      printField('text', '(null — no speech detected in this item, per the API\'s documented behavior)');
      return;
    }
    printField('length', `${item.text.length} chars`);
    // No API-provided "complete" flag exists — the closest honest signal
    // is whether the text trails off mid-sentence (no terminal
    // punctuation) versus ending cleanly. Reported as an observation, not
    // a guarantee — the 2-minute cutoff is a hard cliff, not a partial cut.
    const endsCleanly = /[.!?]["')\]]?\s*$/.test(item.text.trim());
    printField('appears complete', endsCleanly ? 'likely — ends on terminal punctuation' : 'uncertain — does not end on terminal punctuation');
    console.log('  text:');
    console.log(
      item.text
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n')
    );
  });
}

main().catch((error) => {
  console.error('Transcript test threw unexpectedly:', error);
  process.exit(1);
});
