# 🏛️ Kookio Thesis · University of Bucharest

Kookio: A Modular Full-Stack Gastronomic Service Built on the PAN Architecture (Prisma – Analog – Nx)

> 📁 This repository contains the academic thesis associated with the [Kookio application](https://github.com/EduardEmanuel/kookio), including:

> - LaTeX sources
> - Compilation scripts
> - University assets (logos, styles)

## 📦 Prerequisites

| Tool | Purpose | How to Install |
|------|---------|----------------|
| **XeLaTeX** (via TeX Live, MacTeX, or MikTeX) | Compile thesis in LaTeX           | See below                                                                 |
| **Node.js** ≥ 20.11.1 + **npm**               | Run Typescript                    | [nodejs.org](https://nodejs.org)                                          |
| TheMealDB                                     | an open, crowd-sourced database   | premium API key $10 lifetime — [themealdb.com](https://www.themealdb.com) |

### 📌 XeLaTeX Note

To compile the thesis using LaTeX + Unicode fonts:

- **macOS:** `brew install --cask mactex`
- **Ubuntu/Debian:** `sudo apt install texlive-xetex texlive-fonts-recommended texlive-latex-extra`
- **Windows:** install [MikTeX](https://miktex.org/download) and enable `xetex` + `biblatex` in the package manager.

### [![pasta icon](https://www.themealdb.com/images/icons/favicon/favicon-16x16.png) TheMealDB](https://www.themealdb.com/) Tools

- Setup

```bash
cd ./research/the-meal-db
npm install
```

## 🎓 Academic Program

Bachelor’s Thesis – Computer Science
Faculty of Mathematics and Computer Science
University of Bucharest

## ✍️ Author

Eduard - Emanuel Dinea

## 🧑‍🏫 Supervisor

Conf. dr. Radu Boriga

## 📄 Thesis Abstract

This thesis presents the design and implementation of Kookio, an interactive gastronomic web platform developed using a modern, modular, and type-safe full-stack architecture referred to as PAN—composed of Prisma for data access, Analog for Angular SSR capabilities, and Nx for scalable project orchestration in a monorepo context.

The application enables users to manage personal ingredient inventories, receive intelligent recipe suggestions, and locate missing items in nearby stores. Kookio leverages cutting-edge tools such as tRPC for end-to-end type safety, Zod for validation, and PostgreSQL as the underlying relational database. Testing and automation are orchestrated via Vitest, Playwright, and Nx workflows.

The thesis explores key architectural decisions, component integrations, and developer experience enhancements. It also outlines a future-proof roadmap that includes CockroachDB for distributed persistence, Redis for caching, and AI-driven recommendation engines.

All academic materials, including the thesis manuscript, bibliography, LaTeX source files, and compiled PDFs, are maintained in repository (kookio-thesis) to ensure version control and integrity prior to public defense.

## 🔍 Research

### Data provider — [![pasta icon](https://www.themealdb.com/images/icons/favicon/favicon-16x16.png) TheMealDB](https://www.themealdb.com/)

#### Introduction

An open, crowd-sourced database of recipes from around the world.
We offer a free recipe API for anyone wanting to use it, with additional premium features if required.

#### `fetch-catalog.ts`

Fetches the base catalog data from TheMealDB API and writes a typed JSON snapshot to disk. Covers three resource types — meal categories, cuisine areas, and ingredients — each retrieved from a dedicated API endpoint and transformed into a Prisma-compatible shape.

Ingredient names are normalized to a stable `snake_case` key (diacritics stripped, whitespace collapsed) used as a unique identifier throughout the seeding pipeline. Duplicates produced by normalization are detected and skipped with a warning.

Output is a single `raw-catalog.json` file containing all three collections alongside a `fetchedAt` timestamp and source URL. The file serves as the input artifact for the subsequent cleaning and seeding phases. No database interaction occurs at this stage.

#### `clean-catalog.ts`

Reads `raw-catalog.json` and `merge-candidates.json`, applies approved transformations, and writes a cleaned snapshot to `catalog.json`.

Two transformation types are supported. `MERGE` removes the plural form of an ingredient entirely, with recipes expected to reference the singular. `RENAME` keeps the entry but updates both `normalizedName` and the display `name` to the singular form, reconstructing title case from the normalized key.

All description fields are sanitized: Windows line endings are normalized to Unix, runs of three or more blank lines are collapsed to two, and leading or trailing whitespace is stripped.

Each ingredient is then auto-categorized via a ordered list of regex rules covering thirteen categories — `MEAT`, `FISH`, `DAIRY`, `HERBS`, `SPICES`, `NUTS`, `SWEETS`, `LEGUMES`, `GRAINS`, `CONDIMENTS`, `BEVERAGES`, and `PRODUCE` as catch-all. First match wins; ingredients that match no rule retain `category: null` for manual review.

#### `fetch-recipes.ts`

Fetches full recipe data from TheMealDB and writes a typed JSON snapshot to disk. Meal IDs are discovered by scanning all 26 letters of the alphabet via `search.php?f=<letter>`, with each response validated for HTTP errors, empty bodies, and malformed JSON before being collected. A configurable delay between requests prevents rate limiting.

For each discovered meal, full details are retrieved via `lookup.php?i={id}`. Meals without instructions are skipped and counted separately. Each valid meal is transformed into a seed-compatible row: instructions are sanitized (line endings normalized, excess blank lines collapsed), tags are split and lowercased, and up to 20 ingredient slots are parsed from the TheMealDB flat structure into typed `{ ingredientNormalizedName, quantity, unit, notes }` objects.

Ingredient names go through the same normalization pipeline as `fetch-catalog.ts` to guarantee key consistency across both snapshots. Raw measure strings such as `"2 tbsp heaped"` or `"1/2 cup"` are parsed into a structured quantity, a `MeasureUnit` enum value, and an optional notes field — with ranges taking the lower bound and unrecognized units folded into `notes`.

Output is a single `recipes.json` snapshot containing all collected recipes alongside fetch metadata. No database interaction occurs at this stage.

### Workflow

### Phase 1a.1 — Fetch catalog

```bash
THEMEALDB_API_KEY=your_key npm run fetch-catalog
```

Outputs: `raw-catalog.json`

### Phase 1a.2 — Generate merge candidates

```bash
npm run generate-candidates
```

Outputs: `merge-candidates.json` — open it and set `approve: true/false` for each entry.

### Phase 1b — Clean & normalize

Review `merge-candidates.json` and set `approve: true/false` for each entry, then:

```bash
npm run clean-catalog
```

Outputs: `catalog.json`

### Phase 2a — Fetch recipes

```bash
THEMEALDB_API_KEY=your_key npm run fetch-recipes
```

Outputs: `recipes.json`

## Copying outputs to Kookio

After running the scripts, copy the final outputs to the Kookio repo:

```bash
cp catalog.json ../../kookio/libs/prisma/client/seed-data/
cp recipes.json ../../kookio/libs/prisma/client/seed-data/
```

Then run the seed scripts from the Kookio repo:

```bash
cd ../../kookio
npm run with:env -- --env=development -- npx tsx scripts/seeds/seed-catalog.ts
npm run with:env -- --env=development -- npx tsx scripts/seeds/seed-recipes.ts
```

## Files

| File | Description |
|---|---|
| `types.ts`                     | Shared TypeScript types (mirror Prisma schema, no @prisma/client dependency)     |
| `fetch-catalog.ts`             | Fetches categories, areas, ingredients from TheMealDB                            |
| `generate-merge-candidates.ts` | Analyzes raw-catalog.json and detects plural→singular candidate pairs for review |
| `clean-catalog.ts`             | Normalizes plurals, deduplicates, auto-categorizes ingredients                   |
| `fetch-recipes.ts`             | Fetches all recipes via premium list endpoint                                    |
| `merge-candidates.json`        | Approved plural→singular normalization decisions                                 |
| `raw-catalog.json`             | Raw snapshot from TheMealDB (generated, not committed)                           |
| `catalog.json`                 | Cleaned snapshot (generated, not committed)                                      |
| `recipes.json`                 | Recipes snapshot (generated, not committed)                                      |
