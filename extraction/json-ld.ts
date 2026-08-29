/**
 * Finds Schema.org Recipe data published as JSON-LD on a page — the
 * primary, highest-reliability extraction source (see the Pass 1 research
 * doc: Google rewards valid Recipe JSON-LD with rich search results, which
 * is a standing incentive for publishers to keep it accurate).
 *
 * A page can publish its structured data in several shapes even though
 * it's all "the same" JSON-LD in spirit:
 *   - a single { "@type": "Recipe", ... } object
 *   - an array of such objects (one script tag can contain several)
 *   - nested inside a top-level { "@graph": [...] } wrapper
 *   - as the `mainEntity` of a `WebPage`/`Article` node, with no direct
 *     "@type": "Recipe" node at the top level at all
 * `findRecipeNode` walks all of these; `findJsonLdRecipe` is the only
 * export other modules need.
 */

const JSON_LD_SCRIPT_RE = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

// Exported for reuse by agent/lib/html.ts (Instagram agent's Open Graph tag
// parsing needs the same handful of entities) — no behavior change here.
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const value = node['@type'];
  return value === type || (Array.isArray(value) && value.includes(type));
}

function findRecipeNode(data: unknown): Record<string, unknown> | null {
  if (!data) {
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeNode(item);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof data !== 'object') {
    return null;
  }
  const node = data as Record<string, unknown>;

  if (hasType(node, 'Recipe')) {
    return node;
  }
  if (Array.isArray(node['@graph'])) {
    const found = findRecipeNode(node['@graph']);
    if (found) {
      return found;
    }
  }
  // Some pages publish the Recipe as the mainEntity of a WebPage/Article
  // node rather than as a top-level type.
  if (node.mainEntity) {
    const found = findRecipeNode(node.mainEntity);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Scans every `<script type="application/ld+json">` block on the page and returns the first Recipe node found, or null. */
export function findJsonLdRecipe(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(JSON_LD_SCRIPT_RE)) {
    const raw = decodeHtmlEntities(match[1].trim());
    if (!raw) {
      continue;
    }
    try {
      const found = findRecipeNode(JSON.parse(raw));
      if (found) {
        return found;
      }
    } catch {
      // Malformed JSON-LD block on the page — skip it and keep looking;
      // one broken <script> tag shouldn't sink an otherwise-good page.
    }
  }
  return null;
}
