/**
 * ScrapeCreators-backed implementation of InstagramMetadataProvider (see
 * agent/types.ts). This is the ONLY file in the codebase that knows
 * anything about ScrapeCreators' request/response shape — the tool
 * (agent/tools/instagram-metadata.ts) and the agent loop only ever see the
 * normalized InstagramMetadata type.
 *
 * Verified against the current official docs (docs.scrapecreators.com,
 * fetched directly — not taken from the earlier research summary, which
 * this confirms/corrects):
 *
 *   GET https://api.scrapecreators.com/v1/instagram/post
 *   Header: x-api-key: <SCRAPECREATORS_API_KEY>
 *   Query:  url (required) — the exact public Reel/post URL, passed through
 *           unchanged; include_play_count=false — we don't need view/play
 *           counts, and the docs note this skips an extra internal fetch.
 *
 *   Response: { success, credits_remaining, credits_charged,
 *               data: { xdt_shortcode_media: { ...Instagram's own
 *               internal GraphQL media node... } }, status }
 *   This is Instagram's own private GraphQL shape (note the `xdt_` /
 *   `__typename: XDTGraphVideo` naming) proxied through ScrapeCreators, not
 *   a schema ScrapeCreators invented — so it's read defensively here
 *   (every field optional-chained) rather than trusted as a stable
 *   contract.
 *
 * `download_media` (NOT used here): the docs describe it as re-hosting the
 * video/image to a permanent URL, costing 10 credits if media is found (1
 * otherwise) — separate from the `video_url`/`display_url` fields below,
 * which are Instagram's own CDN links and typically short-lived/signed.
 * V1 has no video/audio/OCR tool that would consume a permanent copy, so
 * this tool never sets `download_media=true` — costs stay at 1 credit per
 * lookup. Flip it on (see the request below) when a later stage actually
 * downloads media.
 *
 * Error handling: ScrapeCreators documents 400 (bad params), 401 (bad/
 * missing key), 402 (insufficient credits), 403 (blocked content), 404
 * (not found), 500 (server error) — no documented error-body shape, so a
 * non-200 response is handled by status code alone, with a best-effort
 * message read from the body if it happens to be JSON with a message.
 */

import type { AgentError, InstagramMetadata, InstagramMetadataProvider, InstagramMetadataResult } from '../types';

const ENDPOINT = 'https://api.scrapecreators.com/v1/instagram/post';

const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;

/** Links mentioned in the caption that point off Instagram — candidate original-recipe URLs. Not ScrapeCreators-specific (operates on plain text), kept here since this is where the caption first exists; move to agent/lib/ if a second provider needs it too. */
function findExternalUrls(text: string | null): string[] {
  if (!text) {
    return [];
  }
  const found = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    try {
      const url = new URL(match[0].replace(/[.,;]+$/, ''));
      const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      if (hostname !== 'instagram.com' && hostname !== 'instagr.am') {
        found.add(url.toString());
      }
    } catch {
      // Not a real URL (trailing punctuation swallowed something) — skip it.
    }
  }
  return [...found];
}

function errorCodeForStatus(status: number): AgentError['code'] {
  // 400/404: something about the URL itself (malformed, deleted, not
  // found). Everything else (auth, credits, blocked, server error) is a
  // provider-access problem, not a bad URL.
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

type XdtMediaNode = {
  is_video?: boolean;
  video_url?: string;
  display_url?: string;
  title?: string;
  owner?: {
    username?: string;
    full_name?: string;
  };
  edge_media_to_caption?: {
    edges?: Array<{ node?: { text?: string } }>;
  };
};

function extractCaption(media: XdtMediaNode): string | null {
  const text = media.edge_media_to_caption?.edges?.[0]?.node?.text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

export class ScrapeCreatorsInstagramProvider implements InstagramMetadataProvider {
  readonly name = 'scrapecreators';

  constructor(private readonly apiKey: string) {}

  async getMetadata(url: string): Promise<InstagramMetadataResult> {
    const requestUrl = new URL(ENDPOINT);
    requestUrl.searchParams.set('url', url);
    requestUrl.searchParams.set('include_play_count', 'false');

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

    const media = (body as Record<string, unknown>).data as { xdt_shortcode_media?: XdtMediaNode } | undefined;
    const node = media?.xdt_shortcode_media;
    if (!node) {
      return {
        ok: false,
        error: { code: 'fetch-failed', message: 'ScrapeCreators response did not include media data for this URL.' },
      };
    }

    const warnings: string[] = [];

    const caption = extractCaption(node);
    if (!caption) {
      warnings.push('No caption returned for this Reel.');
    }

    const creatorUsername = typeof node.owner?.username === 'string' ? node.owner.username : null;
    if (!creatorUsername) {
      warnings.push('No creator username returned for this Reel.');
    }
    const creatorFullName = typeof node.owner?.full_name === 'string' && node.owner.full_name.trim() ? node.owner.full_name.trim() : null;

    const mediaUrl =
      typeof node.video_url === 'string' ? node.video_url : typeof node.display_url === 'string' ? node.display_url : null;
    if (!mediaUrl) {
      warnings.push('No media (video/image) URL returned for this Reel.');
    }

    const metadata: InstagramMetadata = {
      instagramUrl: url,
      creatorUsername,
      creatorFullName,
      creatorProfileUrl: creatorUsername ? `https://www.instagram.com/${creatorUsername}/` : null,
      caption,
      title: typeof node.title === 'string' && node.title.trim() ? node.title.trim() : null,
      // ScrapeCreators' post payload has no separate description field
      // distinct from the caption — nothing to map here.
      description: null,
      externalUrls: findExternalUrls(caption),
      mediaUrl,
      mediaType: mediaUrl ? (node.is_video ? 'video' : 'image') : null,
      warnings,
    };

    return { ok: true, metadata };
  }
}
