/**
 * get_instagram_metadata — the agent's first move on any Instagram URL.
 *
 * This file is the tool boundary, not a provider: URL validation lives
 * here (generic to any provider), while all ScrapeCreators-specific
 * request/response knowledge lives in
 * agent/providers/scrapecreators-instagram.ts, reached only through the
 * InstagramMetadataProvider interface (agent/types.ts). A future provider
 * swap or fallback chain changes the provider passed in here — never this
 * function's signature or the agent loop.
 */

import { isInstagramUrl } from '../lib/instagram-url';
import type { InstagramMetadataProvider, InstagramMetadataResult } from '../types';

export async function getInstagramMetadata(provider: InstagramMetadataProvider, url: string): Promise<InstagramMetadataResult> {
  if (!isInstagramUrl(url)) {
    return { ok: false, error: { code: 'invalid-url', message: 'That does not look like an instagram.com URL.' } };
  }
  return provider.getMetadata(url);
}
