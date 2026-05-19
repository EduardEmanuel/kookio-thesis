# 🏛️ Kookio Thesis · University of Bucharest

Kookio: A Modular Full-Stack Gastronomic Service Built on the PAN Architecture (Prisma – Analog – Nx)

> 📁 This repository contains the academic thesis associated with the [Kookio application](https://github.com/EduardEmanuel/kookio), including:
>
> - LaTeX sources for the thesis manuscript
> - TypeScript build automation (`build.ts`, `install-tex-deps.ts`)
> - University assets (logos, styles)
> - Research scripts for data acquisition (TheMealDB)

## 📦 Prerequisites

| Tool | Purpose | How to Install |
|------|---------|----------------|
| **LuaLaTeX** (via TeX Live, MacTeX, or MikTeX) | Compile thesis in LaTeX | See [LaTeX Installation](#-latex-installation) below |
| **Node.js** ≥ 20.11.1 + **npm** | Run TypeScript build scripts and research tools | [nodejs.org](https://nodejs.org) |
| **TheMealDB** | Open, crowd-sourced recipe database | Premium API key $10 lifetime — [themealdb.com](https://www.themealdb.com) |

### 📌 LaTeX Installation

The thesis is built with **LuaLaTeX** (not XeLaTeX) for better Unicode handling and direct Lua scripting support. Verified with TeX Live 2025 (LuaHBTeX 1.21.0).

- **macOS:** `brew install --cask mactex` — full scheme, includes LuaLaTeX, `biber`, and all required packages.
- **Ubuntu/Debian:** `sudo apt install texlive-luatex texlive-fonts-recommended texlive-latex-extra texlive-bibtex-extra` (or `texlive-full` for everything).
- **Windows:** install [MikTeX](https://miktex.org/download) — it auto-installs missing packages on first compilation.

The complete list of TeX Live packages required is versioned in [`tex-requirements.txt`](./tex-requirements.txt).

The `TreeVerb` environment additionally requires the **FreeMono** font (part of GNU FreeFont) for Unicode box-drawing characters:

- **macOS:** `brew install --cask font-gnu-freefont-freemono`
- **Ubuntu/Debian:** `sudo apt install fonts-freefont-ttf`
- **Windows:** download from [gnu.org/software/freefont](https://www.gnu.org/software/freefont/)

## 🚀 Building the Thesis

The thesis is compiled through TypeScript scripts that orchestrate the full `lualatex → makeglossaries → biber → lualatex → lualatex` pipeline. Both scripts share common helpers from [`utils.ts`](./utils.ts).

### Install TeX dependencies

```bash
# Install all packages listed in tex-requirements.txt
tsx install-tex-deps.ts

# Verify which packages are installed/missing (no changes)
tsx install-tex-deps.ts --check

# Update tlmgr and all installed packages
tsx install-tex-deps.ts --update
```

On macOS with MacTeX (full scheme), all packages are typically already installed; running `--check` will confirm.

### Compile the thesis

```bash
# Full compile with bibliography, glossary, and cross-references
tsx build.ts ro

# Quick draft (skips bibliography and second pass — much faster)
tsx build.ts ro --draft

# Clean auxiliary files only (no compilation)
tsx build.ts ro --delete
```

The compiled PDF is written to `dist/kookio_thesis_ro.pdf`, with timestamped backups on subsequent builds.

### Optional npm scripts

If you prefer `npm run` shortcuts, add to `package.json`:

```json
{
  "scripts": {
    "build": "tsx build.ts",
    "install-tex": "tsx install-tex-deps.ts",
    "check-tex": "tsx install-tex-deps.ts --check",
    "update-tex": "tsx install-tex-deps.ts --update"
  }
}
```

Then run:

```bash
npm run install-tex
npm run build -- ro --draft
```

## 🎓 Academic Program

Bachelor's Thesis – Computer Science
Faculty of Mathematics and Computer Science
University of Bucharest

## ✍️ Author

Eduard-Emanuel Dinea

## 🧑‍🏫 Supervisor

Conf. univ. dr. Marius Iulian Mihăilescu

## 📄 Thesis Abstract

This thesis presents the design and implementation of Kookio, a full-stack web application developed as a case study for analyzing the PAN architecture in the context of modern web applications. Kookio combines three core domestic flows — pantry management, daily meal planning, and automated derivation of grocery lists — with the intent of indirectly reducing household food waste through more efficient organization of available resources.

The PAN architecture is investigated as a full-stack model grounded in the TypeScript ecosystem, in which application layers share types and validation schemas derived from a single source of truth. The application uses SSR with Angular through the Analog meta-framework, type-safe client–server communication via tRPC, and data persistence through Prisma and CockroachDB. The project is organized as an Nx monorepo with an acyclic library topology enforced at CI via `enforce-module-boundaries`, eliminating the intermediate repository layer between tRPC procedures and the Prisma client.

The implementation is validated through unit tests with Vitest and end-to-end tests with Playwright, accompanied by an empirical evaluation of persistence-layer latencies and CI runtime. Measured results indicate that the PAN architecture constitutes a coherent and extensible model for full-stack web application development.

All academic materials — manuscript, bibliography, LaTeX sources, and compiled PDFs — are maintained in the [`kookio-thesis`](https://github.com/EduardEmanuel/kookio-thesis) repository to ensure version control and integrity prior to public defense.

## 🔍 Research Scripts

The `research/the-meal-db/` directory contains TypeScript utilities for fetching, cleaning, and shaping the seed dataset used by the Kookio application. These run independently of the thesis compilation.

### Data provider — [![pasta icon](https://www.themealdb.com/images/icons/favicon/favicon-16x16.png) TheMealDB](https://www.themealdb.com/)

An open, crowd-sourced database of recipes from around the world. A free recipe API is available, with premium features for $10 lifetime.

### Setup

```bash
cd ./research/the-meal-db
npm install
```

### `fetch-catalog.ts`

Fetches the base catalog data from TheMealDB API and writes a typed JSON snapshot to disk. Covers three resource types — meal categories, cuisine areas, and ingredients — each retrieved from a dedicated API endpoint and transformed into a Prisma-compatible shape.

Ingredient names are normalized to a stable `snake_case` key (diacritics stripped, whitespace collapsed) used as a unique identifier throughout the seeding pipeline. Duplicates produced by normalization are detected and skipped with a warning.

Output is a single `raw-catalog.json` file containing all three collections alongside a `fetchedAt` timestamp and source URL. The file serves as the input artifact for the subsequent cleaning and seeding phases. No database interaction occurs at this stage.

### `clean-catalog.ts`

Reads `raw-catalog.json` and `merge-candidates.json`, applies approved transformations, and writes a cleaned snapshot to `catalog.json`.

Two transformation types are supported. `MERGE` removes the plural form of an ingredient entirely, with recipes expected to reference the singular. `RENAME` keeps the entry but updates both `normalizedName` and the display `name` to the singular form, reconstructing title case from the normalized key.

All description fields are sanitized: Windows line endings are normalized to Unix, runs of three or more blank lines are collapsed to two, and leading or trailing whitespace is stripped.

Each ingredient is then auto-categorized via an ordered list of regex rules covering thirteen categories — `MEAT`, `FISH`, `DAIRY`, `HERBS`, `SPICES`, `NUTS`, `SWEETS`, `LEGUMES`, `GRAINS`, `CONDIMENTS`, `BEVERAGES`, and `PRODUCE` as catch-all. First match wins; ingredients that match no rule retain `category: null` for manual review.

### `fetch-recipes.ts`

Fetches full recipe data from TheMealDB and writes a typed JSON snapshot to disk. Meal IDs are discovered by scanning all 26 letters of the alphabet via `search.php?f=<letter>`, with each response validated for HTTP errors, empty bodies, and malformed JSON before being collected. A configurable delay between requests prevents rate limiting.

For each discovered meal, full details are retrieved via `lookup.php?i={id}`. Meals without instructions are skipped and counted separately. Each valid meal is transformed into a seed-compatible row: instructions are sanitized (line endings normalized, excess blank lines collapsed), tags are split and lowercased, and up to 20 ingredient slots are parsed from the TheMealDB flat structure into typed `{ ingredientNormalizedName, quantity, unit, notes }` objects.

Ingredient names go through the same normalization pipeline as `fetch-catalog.ts` to guarantee key consistency across both snapshots. Raw measure strings such as `"2 tbsp heaped"` or `"1/2 cup"` are parsed into a structured quantity, a `MeasureUnit` enum value, and an optional notes field — with ranges taking the lower bound and unrecognized units folded into `notes`.

Output is a single `recipes.json` snapshot containing all collected recipes alongside fetch metadata. No database interaction occurs at this stage.

### Workflow

#### Phase 1a.1 — Fetch catalog

```bash
THEMEALDB_API_KEY=your_key npm run fetch-catalog
```

Outputs: `raw-catalog.json`

#### Phase 1a.2 — Generate merge candidates

```bash
npm run generate-candidates
```

Outputs: `merge-candidates.json` — open it and set `approve: true/false` for each entry.

#### Phase 1b — Clean & normalize

Review `merge-candidates.json` and set `approve: true/false` for each entry, then:

```bash
npm run clean-catalog
```

Outputs: `catalog.json`

#### Phase 2a — Fetch recipes

```bash
THEMEALDB_API_KEY=your_key npm run fetch-recipes
```

Outputs: `recipes.json`

### Copying outputs to Kookio

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

### Files

| File | Description |
|---|---|
| `types.ts`                     | Shared TypeScript types (mirror Prisma schema, no `@prisma/client` dependency)   |
| `fetch-catalog.ts`             | Fetches categories, areas, ingredients from TheMealDB                            |
| `generate-merge-candidates.ts` | Analyzes `raw-catalog.json` and detects plural→singular candidate pairs for review |
| `clean-catalog.ts`             | Normalizes plurals, deduplicates, auto-categorizes ingredients                   |
| `fetch-recipes.ts`             | Fetches all recipes via premium list endpoint                                    |
| `merge-candidates.json`        | Approved plural→singular normalization decisions                                 |
| `raw-catalog.json`             | Raw snapshot from TheMealDB (generated, not committed)                           |
| `catalog.json`                 | Cleaned snapshot (generated, not committed)                                      |
| `recipes.json`                 | Recipes snapshot (generated, not committed)                                      |

## 📂 Repository Structure

```
kookio-thesis/
├── build.ts                 # TypeScript build script (lualatex pipeline)
├── install-tex-deps.ts      # TypeScript installer for TeX Live packages
├── utils.ts                 # Shared helpers (color, log, checkTool, run)
├── tex-requirements.txt     # TeX Live package list
├── package.json
├── ro/                      # Romanian thesis sources
│   ├── kookio_thesis.tex
│   ├── 0-title.tex
│   ├── 0-abstract.tex
│   ├── 1-introducere.tex
│   ├── 2-preliminarii.tex
│   ├── 3-implementare.tex
│   ├── 3-concluzii.tex
│   ├── 4-anexe.tex
│   ├── 5-glosar.tex
│   ├── bibliography.bib
│   └── images/
├── dist/                    # Compiled PDFs (generated, not committed)
└── research/
    └── the-meal-db/         # Data acquisition scripts (see Research Scripts above)
```
