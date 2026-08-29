/**
 * Small, dependency-free HTML utilities for the fetch_page tool
 * (agent/tools/fetch-page.ts). Deliberately not a DOM parser — the same
 * regex-based, "just enough" approach extraction/json-ld.ts already uses
 * for this codebase's one other piece of raw-HTML scanning. No behavior
 * shared with that pipeline beyond the entity-decoding helper it exports.
 *
 * Instagram metadata no longer goes through here — direct HTML/meta-tag
 * scraping of Instagram consistently returned a stripped logged-out page
 * (see agent/providers/scrapecreators-instagram.ts for the replacement).
 * These helpers remain for fetch_page's generic "look at any candidate
 * webpage" job, which direct fetching still works fine for.
 */

import { decodeHtmlEntities } from '@/extraction/json-ld';

/** The page's `<title>` text, or null if absent/empty. */
export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return null;
  }
  const title = decodeHtmlEntities(match[1].trim());
  return title || null;
}

/**
 * Strips a page down to its readable text, truncated to `maxChars` — the
 * fetch_page tool's whole reason for existing rather than handing the
 * agent raw HTML: enough for the model to judge "is this the original
 * recipe page?" without dumping an entire page (styles, scripts, nav
 * chrome) into the context window. Not meant to compete with the
 * extraction pipeline's own JSON-LD parsing — this is for the agent's
 * judgment call, not for pulling structured data.
 */
export function htmlToPlainText(html: string, maxChars: number): { text: string; truncated: boolean } {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Block-level tags become line breaks so paragraphs/list items don't
    // run together into one unreadable line.
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeHtmlEntities(withoutNoise)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxChars).trim(), truncated: true };
}
