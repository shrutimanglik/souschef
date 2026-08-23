# SousChef

SousChef is a mobile-first personal cookbook app. The idea: the internet is
where you *discover* recipes, SousChef is where you actually *cook* them —
paste a link from any recipe site and get a clean, structured, editable
recipe saved into your own cookbooks.

This is an early-stage build. It's a working local-first prototype, not a
finished product — see "What currently works" below for the honest state of
things.

## Tech stack

- [Expo](https://expo.dev) (SDK 54) + [Expo Router](https://docs.expo.dev/router/introduction/) — file-based routing, including a server-side API route
- React Native + TypeScript
- `@react-native-async-storage/async-storage` — local, on-device persistence (no backend database)
- No authentication, no cloud sync, no AI

## What currently works

- **Cookbook Library** — a home screen showing your cookbooks (three seeded ones — Everyday Cooking, Baking, Dinner Parties — plus a system-generated "All Recipes" collection). Creating a new cookbook is not implemented yet (the "+ New Cookbook" card is a placeholder).
- **Cookbook detail** and **Recipe detail** screens, including deleting a saved recipe.
- **Add Recipe by URL**: paste a link → SousChef fetches the page and extracts a recipe → an **editable** review screen lets you correct the title, servings, times, ingredients, or instructions before saving → choose a cookbook (or save straight into the one you started from) → the recipe is saved, deduplicated by source URL if you'd already saved it elsewhere.
- Recipes and cookbooks persist locally via AsyncStorage and survive an app restart.
- Bottom navigation: **Cookbooks**, **+ Add Recipe**, **Discover** (placeholder — "coming soon"), **Profile** (placeholder).

Not implemented yet: creating new cookbooks, manual recipe entry, AI of any kind, recipe scaling/unit conversion, image downloading (an image URL is captured but not rendered), authentication, and cloud sync.

## Install & run

```bash
npm install
npx expo start
```

Open the result in Expo Go, an iOS/Android simulator, or a development
build. The app is designed for an iPhone-sized screen.

The Add Recipe flow depends on a server-side API route (`app/api/extract-recipe+api.ts`), which requires `web.output: "server"` in `app.json` — already configured. When running via `npx expo start`, this route is served automatically alongside the app.

## Recipe extraction

Pasting a URL doesn't call an AI — extraction is **deterministic** and
**domain-agnostic**:

1. The target page's HTML is fetched server-side.
2. SousChef looks for [Schema.org `Recipe`](https://schema.org/Recipe) data published as JSON-LD (`<script type="application/ld+json">`), which is how most recipe sites make their recipe data available to search engines — including recipes nested in `@graph`, arrays, or a page's `mainEntity`.
3. Whatever's found is normalized into SousChef's own recipe model (ingredient quantity/unit/name kept separate, durations converted to minutes, etc.).
4. If a page has no such data, or what's found is missing ingredients or instructions, extraction fails with a specific, honest error — SousChef never guesses or fabricates recipe content.

There's **no list of "supported" websites** — any public page with valid
Schema.org Recipe markup should work. Sites that don't publish this markup
(or block automated requests) currently fail to import; there's no AI or
scraping fallback for those cases yet.

### Testing extraction against real sites

A small corpus of real, diverse recipe URLs is used to spot-check the
extractor (not an automated test suite — it makes live network requests):

```bash
npm run test:extraction
```

This reports, per URL, whether extraction succeeded, what was extracted,
and any warnings (e.g. an ingredient line with no parseable quantity).
