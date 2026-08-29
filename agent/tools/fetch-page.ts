/**
 * fetch_page — lets the agent look at a candidate URL (a search result, or
 * an external link found in Instagram metadata) closely enough to judge
 * whether it's the original recipe page, without dumping the whole page
 * into its context. Reuses extraction/fetch-html.ts's fetchHtml directly
 * (same fetch, same UA, same error shape) rather than a second fetcher —
 * this tool only adds the "turn HTML into a small readable summary" step
 * on top.
 *
 * Deliberately not extraction: this never runs JSON-LD parsing,
 * normalization, or validation. That's extract_recipe_from_url's job (see
 * ./extract-recipe.ts) once the agent has decided a page is worth it.
 */

import { fetchHtml } from '@/extraction/fetch-html';

import { extractTitle, htmlToPlainText } from '../lib/html';
import type { FetchPageResult } from '../types';

// Keeps a single fetch_page result comfortably small in the agent's
// context — enough to read a recipe intro / "originally published on" line
// / author bio, not enough to smuggle an entire page in under the guise of
// "content".
const MAX_CONTENT_CHARS = 4000;

export async function fetchPage(url: string): Promise<FetchPageResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    return { ok: false, error: { code: 'invalid-url', message: 'That does not look like a valid URL.' } };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, error: { code: 'invalid-url', message: 'Only http(s) URLs are supported.' } };
  }

  const fetched = await fetchHtml(parsedUrl);
  if (!fetched.ok) {
    return { ok: false, error: { code: 'fetch-failed', message: fetched.error.message } };
  }

  const { text, truncated } = htmlToPlainText(fetched.html, MAX_CONTENT_CHARS);
  const warnings: string[] = [];
  if (truncated) {
    warnings.push(`Page content truncated to ${MAX_CONTENT_CHARS} characters.`);
  }
  if (!text) {
    warnings.push('No readable text content found on the page.');
  }

  return {
    ok: true,
    page: {
      finalUrl: fetched.url.toString(),
      title: extractTitle(fetched.html),
      content: text,
      truncated,
      warnings,
    },
  };
}
