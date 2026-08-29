/**
 * Instagram URL detection — the one thing that decides whether a URL goes
 * through the Instagram agent (agent/instagram-recipe-agent.ts) instead of
 * straight to extractRecipeFromUrl. Deliberately narrow: only recognizes
 * instagram.com/instagr.am hosts, no guessing at share-link redirectors.
 */
export function isInstagramUrl(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  return hostname === 'instagram.com' || hostname === 'instagr.am';
}
