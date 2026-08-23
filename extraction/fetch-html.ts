import type { ExtractionError } from './types';

export type FetchHtmlResult = { ok: true; html: string } | { ok: false; error: ExtractionError };

// A realistic browser UA — some recipe sites block or serve a stripped-down
// page to non-browser clients. This is a personal tool fetching one page a
// user explicitly pasted a link to, not a crawler; a real UA is about being
// treated like a normal reader, not about evading detection.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Fetches a page's HTML. The only I/O in the whole extraction pipeline — everything past this point is pure parsing. */
export async function fetchHtml(url: URL): Promise<FetchHtmlResult> {
  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) {
      return {
        ok: false,
        error: { code: 'fetch-failed', message: `The page returned an error (HTTP ${response.status}).` },
      };
    }
    const html = await response.text();
    return { ok: true, html };
  } catch {
    return {
      ok: false,
      error: { code: 'fetch-failed', message: 'Could not reach that page. Check the URL and try again.' },
    };
  }
}
