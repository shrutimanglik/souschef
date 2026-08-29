/**
 * ScrapeCreators-backed implementation of InstagramTranscriptProvider (see
 * agent/types.ts). Now wired into the agent as get_instagram_transcript
 * (see instagram-recipe-agent.ts) — the agent decides when a transcript is
 * worth fetching based on evidence (e.g. a thin caption but a narrated
 * video), per the tool's own description, not a hard-coded rule.
 *
 * Verified against the current official docs
 * (docs.scrapecreators.com/v2/instagram/media/transcript/, fetched
 * directly):
 *
 *   GET https://api.scrapecreators.com/v2/instagram/media/transcript
 *   Header: x-api-key: <SCRAPECREATORS_API_KEY>
 *   Query:  url (required) — the ORIGINAL Instagram post/reel URL.
 *
 *   IMPORTANT: this does NOT take the mediaUrl (the CDN video link our
 *   metadata provider returns) — same `url` shape as the post/metadata
 *   endpoint (scrapecreators-instagram.ts), not the video file itself.
 *   ScrapeCreators resolves the video and transcribes it server-side.
 *
 *   Response: { success, credits_remaining, credits_charged,
 *               transcripts: [{ id, shortcode, text }] }
 *   - No timestamps/segments field — plain text per item.
 *   - transcripts is an array because a carousel post can have multiple
 *     video items; a single Reel/post is a one-element array.
 *   - Documented limitations: only works for videos under 2 minutes;
 *     ~10-30s processing time; returns null (no transcript) if no one is
 *     speaking; 1 credit per request (0 if served from cache).
 */

import type { AgentError, InstagramTranscriptItem, InstagramTranscriptProvider, InstagramTranscriptResult } from '../types';

const ENDPOINT = 'https://api.scrapecreators.com/v2/instagram/media/transcript';

function errorCodeForStatus(status: number): AgentError['code'] {
  if (status === 400 || status === 404) {
    return 'invalid-url';
  }
  return 'fetch-failed';
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const message = (body as Record<string, unknown>).message ?? (body as Record<string, unknown>).error;
      if (typeof message === 'string' && message) {
        return message;
      }
    }
  } catch {
    // Body wasn't JSON (or was empty) — fall through to the status text below.
  }
  return `ScrapeCreators returned HTTP ${response.status}.`;
}

function parseTranscriptItems(raw: unknown): InstagramTranscriptItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : null,
      shortcode: typeof item.shortcode === 'string' ? item.shortcode : null,
      text: typeof item.text === 'string' ? item.text : null,
    }));
}

export class ScrapeCreatorsTranscriptProvider implements InstagramTranscriptProvider {
  readonly name = 'scrapecreators';

  constructor(private readonly apiKey: string) {}

  async getTranscript(instagramUrl: string): Promise<InstagramTranscriptResult> {
    const requestUrl = new URL(ENDPOINT);
    requestUrl.searchParams.set('url', instagramUrl);

    let response: Response;
    try {
      response = await fetch(requestUrl.toString(), { headers: { 'x-api-key': this.apiKey } });
    } catch (error) {
      return {
        ok: false,
        error: { code: 'fetch-failed', message: error instanceof Error ? error.message : 'Could not reach ScrapeCreators.' },
      };
    }

    if (!response.ok) {
      return { ok: false, error: { code: errorCodeForStatus(response.status), message: await readErrorMessage(response) } };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: { code: 'fetch-failed', message: 'ScrapeCreators returned a response that was not valid JSON.' } };
    }

    if (!body || typeof body !== 'object' || (body as Record<string, unknown>).success !== true) {
      return { ok: false, error: { code: 'fetch-failed', message: 'ScrapeCreators reported the request was not successful.' } };
    }

    const record = body as Record<string, unknown>;
    return {
      ok: true,
      transcripts: parseTranscriptItems(record.transcripts),
      creditsCharged: typeof record.credits_charged === 'number' ? record.credits_charged : null,
    };
  }
}
