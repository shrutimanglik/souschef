# SousChef

SousChef is a mobile-first personal cookbook for saving and cooking recipes from the web.

Paste a recipe URL or an Instagram post, review the recipe that was extracted, make any edits, and save it to your cookbook.

## Why I built it

I cook from recipes online a lot and wanted a better way to save, organize, and actually use them while cooking.

I started SousChef as a personal project and have been using it to explore recipe extraction, messy web content, and where agents are useful when deterministic code starts to fall short.

## What it does

* Import recipes from recipe websites
* Import recipes from Instagram posts
* Extract and normalize recipe data into a common structure
* Review and edit recipes before saving
* Organize recipes into cookbooks
* Scale ingredient quantities
* Convert between common kitchen measurements
* Use timers while cooking
* Store recipes locally

## How it works

There are two paths into the recipe import flow. Recipe URLs can go directly through the extraction pipeline. Instagram posts first go through an agent that investigates the post and looks for the underlying recipe source.

Once the source has been identified, both paths use the same extraction and recipe processing code.

```text
                         SousChef
                            │
                            ▼
                       Add a recipe
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
           Recipe URL               Instagram URL
                │                       │
                │                       ▼
                │                Instagram agent
                │                       │
                │              Inspect the post
                │                       │
                │                       ▼
                │               Find recipe source
                │                       │
                └───────────┬───────────┘
                            ▼
                 Shared extraction pipeline
                            │
                            ▼
               Extract → Normalize → Validate
                            │
                            ▼
                      Canonical recipe
                            │
                            ▼
                       Review and edit
                            │
                            ▼
                         Save locally
                            │
                            ▼
                           Cookbook
```

### Recipe extraction

For recipe websites, the importer first looks for structured recipe data such as JSON-LD. The extracted data is then normalized into SousChef's recipe format and validated before it reaches the app.

The extraction pipeline is designed to work across different recipe sites rather than relying on a scraper for a single domain.

### Instagram

Instagram is a different problem because the post may contain the recipe itself, a link to a recipe website, or enough information to identify the source without containing the full recipe.

The Instagram agent handles this source discovery step. It inspects the post, looks for a recipe source, and then hands the result back to the shared extraction pipeline.

Once a recipe page has been found, the existing extraction code is reused rather than maintaining a separate Instagram extraction path.

## Tech stack

* React Native / Expo for the mobile app
* Expo Router for navigation and API routes
* TypeScript throughout the project
* Node.js for extraction and agent tooling
* Claude for the Instagram agent
* JSON-LD as the primary source for structured recipe data
* Local storage for the current cookbook

## Project structure

```text
souschef/
├── app/                    # Expo app and routes
├── components/             # Reusable UI components
├── constants/              # Theme and app constants
├── lib/                    # Recipe extraction and processing
├── agent/                  # Instagram source discovery
└── tests/                  # Extraction test corpus
```

The extraction code is kept separate from the mobile UI so that it can be tested independently and reused by different import flows.

## Running locally

Install dependencies:

```bash
npm install
```

Start the Expo development server:

```bash
npx expo start
```

The Instagram agent can also be run directly during development:

```bash
npm run agent:instagram -- "<instagram-url>"
```

## Current limitations

This is still an early version of the project.

* Recipe site coverage is not universal
* Some ingredient formats require additional parsing
* Instagram source discovery can fail when a post does not provide enough information to identify the recipe
* Local storage is currently used instead of a backend
* Social features are not yet implemented
* Some parts of the cooking experience are still being refined