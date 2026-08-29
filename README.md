# SousChef

SousChef is a mobile-first personal cookbook app. The idea: the internet is
where you *discover* recipes, SousChef is where you actually *cook* them —
paste a link from a recipe site or an Instagram Reel and get a clean,
structured, editable recipe saved into your own cookbooks.

This is an early-stage build — a working local-first prototype, not a
finished product. See "Current limitations" for the honest state of things.

## Product principle

**Never invent recipe facts.**

Everything in this codebase follows from that. Ingredients, quantities,
units and instructions come from a real source or they don't exist. Where a
deterministic mechanism can do the job, it does; an LLM is used only where
judgment or genuine language understanding adds something a parser can't
provide — and even then its output is validated against the source before
it's trusted. When something can't be established from the evidence,
SousChef says so rather than guessing.

## Stack

- [Expo](https://expo.dev) SDK 54 + [Expo Router](https://docs.expo.dev/router/introduction/) — file-based routing, including server-side API routes (`app/api/*+api.ts`, enabled by `web.output: "server"`)
- React Native + TypeScript (strict)
- `@react-native-async-storage/async-storage` — local, on-device persistence
- `@anthropic-ai/sdk` — Claude, used server-side only
- [ScrapeCreators](https://app.scrapecreators.com) — public Instagram metadata and Reel transcripts

No backend database, no authentication, no cloud sync. All recipe and
cookbook state lives on the device.

## Architecture

```
                    ┌─ website URL ──→ extraction/ ──────────────┐
paste a link ──→ ?  │                  (deterministic)           ├──→ organizer ──→ preview ──→ save
                    └─ instagram URL ─→ agent/ ──→ ai/ or ───────┘   (best-effort,  (editable)   (AsyncStorage)
                                        (tool-use)  extraction/       structure only)
```

Four modules, each with a deliberate boundary:

| Module | Responsibility |
|---|---|
| `extraction/` | The deterministic pipeline: `URL → fetch → JSON-LD → normalize → validate → Recipe`. No model involved anywhere. The only place a Recipe is built from a webpage. |
| `ai/` | Provider-agnostic LLM interfaces (`ChatProvider`, `TextRecipeExtractor`, `RecipeOrganizer`) plus their Claude implementations. Never reads `process.env`. |
| `agent/` | The Instagram source-discovery agent and its tools/providers. Never parses recipes itself — it calls the two extractors as tools. |
| `app/api/*+api.ts` | The only place environment variables are read. Adapts every path down to one shared `ExtractionResult` shape. |

`constants/recipes.ts` holds the canonical `Recipe` model that all paths
converge on, so nothing downstream needs to know which pipeline produced a
given recipe.

### Website recipe extraction (deterministic)

Pasting a normal recipe URL calls no AI at all:

1. The page's HTML is fetched server-side.
2. SousChef looks for [Schema.org `Recipe`](https://schema.org/Recipe) data published as JSON-LD — including recipes nested in `@graph`, in arrays, or as a page's `mainEntity`.
3. What's found is normalized into SousChef's model (quantity/unit/name kept separate, ISO-8601 durations converted to minutes, `recipeYield` parsed from its many real-world spellings).
4. If ingredients or instructions are missing, extraction fails with a specific error rather than filling gaps.

There's no list of "supported" sites — any public page with valid
Schema.org Recipe markup should work. Pages without that markup, or that
block automated requests, currently fail; there's no scraping fallback.

### Instagram recipe extraction (agent)

Instagram URLs are detected (`agent/lib/instagram-url.ts`) and routed to a
small Claude tool-use loop instead. The agent's job is **finding where the
recipe actually lives**, not writing one.

It has six research tools — Instagram metadata, Reel transcript, web
search, page inspection, and the two extractors — and decides turn by turn
which to call, bounded to 8 turns. There is no fixed
`metadata → search → fetch → extract` sequence; tool choice is driven by
the evidence in hand:

- **Caption already contains the recipe** (ingredients + method) → extract straight from it. Don't search or transcribe to "confirm" what's already visible.
- **Caption says "link in bio" / names a blog** → search for the creator's own site rather than assuming it's unreachable.
- **Caption says "comment X and I'll DM you the recipe"** → the recipe isn't public anywhere in the caption. Use the creator + dish name to search for their own recipe page. DMs are genuinely inaccessible and are never guessed at.
- **Caption is thin but the creator narrates the method aloud** → a transcript may surface what the caption doesn't. Transcripts cost real credits, so this is a judgment call, not a default.
- **Recipe exists only as on-screen text** → no OCR tool exists, so this is treated as genuinely insufficient evidence rather than a reason to guess.

**Instagram comments are deliberately not a V1 capability.** Retrieving a
specific creator-authored comment requires either an unbounded search
(posts return comments newest-first with no filtering) or accepting a poor
hit rate. Neither fits a per-request tool budget. The agent's
`extract_recipe_from_text` schema therefore doesn't offer `comment` as a
source type at all — advertising a source the agent has no way to obtain is
how a model ends up claiming one.

Which extractor the agent uses matters:

- `extract_recipe_from_url` — the **deterministic** pipeline above. Preferred whenever a real recipe webpage exists.
- `extract_recipe_from_text` — an **LLM** extractor for recipes that never lived on a fetchable page (the recipe *is* the caption, or *is* what was said in the video). It never invents missing detail; gaps come back as warnings.

Both return the identical `ExtractionResult`, so nothing downstream knows
or cares which ran.

### Constrained recipe organization

After extraction, one best-effort LLM call may group a recipe into
components ("Kebabs" / "Chutney", "Crust" / "Filling" / "Topping"). This is
a single call, not an agent loop, and it is **structure-only**:

- The model never sees ingredient or instruction *text* to reproduce — it receives a numbered list and answers with **indexes and component names only**.
- `validateAndBuildComponents` is **fail-closed**. The proposal must form an exact, lossless partition — every ingredient and instruction covered exactly once, nothing out of range, nothing duplicated — or the entire proposal is discarded.
- Each component name must appear **verbatim** (case-insensitively) in that component's own assigned source text. A paraphrase is rejected. This exists because a real bug once turned a source's "spicy dumpling sauce" into "Spice Dumpling Sauce".
- Any failure returns the **original recipe unchanged**, with a warning. Organizing can never fail or alter an extraction that already succeeded.
- The same total-cover invariant is re-checked when a recipe is **loaded from storage** — the grouped UI renders items only through their components, so a grouping that has decayed into a partial cover is discarded rather than allowed to hide real ingredients.

Components survive the full lifecycle: extraction → preview → save →
reload. Recipes with no clear component structure — the common case — are
left completely alone.

## Current limitations

- Creating new cookbooks and manual recipe entry aren't implemented (the "+ New Cookbook" card is a placeholder).
- Discover and Profile tabs are placeholders.
- No recipe scaling or unit conversion, though quantity/unit are stored separately to make that possible later.
- An image URL is captured but never rendered or downloaded.
- No authentication, cloud sync, or multi-device support — state is local to one device.
- Sites without Schema.org markup can't be imported.
- Instagram import depends on a third-party API and takes ~30–85s; transcripts only work for videos under two minutes.
- No automated test runner — the test commands below are live inspection scripts, not a CI suite.

## Running locally

```bash
npm install
npx expo start
```

Open in Expo Go, a simulator, or a development build. Designed for an
iPhone-sized screen.

The Add Recipe and chat flows depend on server-side API routes, which
require `web.output: "server"` in `app.json` (already configured). Those
routes are served automatically by `npx expo start`.

### Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | Recipe organization, recipe chat, and Instagram import |
| `SCRAPECREATORS_API_KEY` | Instagram import only |

Both are **server-side only** and are read exclusively by the `+api.ts`
routes. Never prefix either with `EXPO_PUBLIC_` — that would bundle the
secret into the client. Website recipe extraction works with no keys
configured at all; without `ANTHROPIC_API_KEY`, recipes simply import
without component grouping.

## Test commands

None of these are a unit-test suite — this project has no test runner. They
are pass/fail inspection scripts.

```bash
npm run test:integrity     # data-integrity invariants (no network, no API key)
npm run test:extraction    # deterministic extractor vs. a live corpus of real recipe URLs
npm run test:organizer     # organizer end-to-end + validation boundary (needs ANTHROPIC_API_KEY)
```

`test:integrity` is the one to run most often — it's fast, offline, and
covers the rules that keep recipe facts from being silently lost:
component coverage on load, the save → storage → reload lifecycle, and the
agent's guarantee that a successful extraction is never discarded.

`test:extraction` makes live network requests; some corpus entries fail by
design (a paywalled site, a page with no structured data, a deliberately
malformed URL) — it reports coverage, it isn't a green/red gate.

Two dev CLIs are available for inspecting the Instagram path directly:

```bash
npm run agent:instagram -- <instagram-url>             # full agent run + evidence trail
npm run agent:instagram-transcript -- <instagram-url>  # transcript provider only
```
