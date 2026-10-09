# 🏛️ Kookio Thesis · University of Bucharest

The PAN Architecture as a Model for Full-Stack Web Applications: A Case Study on Reducing Food Waste

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
| **Node.js** ≥ 20.19.0 + **npm** | Run TypeScript build scripts and research tools | [nodejs.org](https://nodejs.org) |
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

The English edition lives in `en/` and builds the same way — `tsx build.ts en` (or `npm run build:en`, `build:en:draft`, `build:en:delete`) — writing `dist/kookio_thesis_en.pdf`.

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

This thesis proposes and analyzes the **PAN** (Prisma–Analog–Nx) architecture, a full-stack model for modern web applications built entirely within the TypeScript ecosystem, in which the application layers share types and validation schemas derived from a single source of truth. To validate this model, I designed and implemented *Kookio*, a full-stack web application that serves as a case study of the PAN architecture. *Kookio* addresses a concrete driver of household food waste — buying food without a meal plan — through an integrated flow of pantry management, meal planning and automatic derivation of the shopping list, so that purchases are tied to the planned meals instead of accumulating redundantly.

The architectural motivation stems from the need for web stacks that ensure coherence between frontend and backend, as well as a unified development process. PAN answers this need not by reducing the number of tools, but by integrating them under a single language and by formalizing the boundaries between components.

Concretely, each layer of this unified TypeScript stack covers a distinct responsibility: server-side rendering (SSR) is provided by Angular through the Analog meta-framework, typed client–server communication by tRPC, and data persistence by Prisma and CockroachDB. Organizing the project as a monorepo managed with Nx enforces an acyclic library topology, checked in continuous integration (CI) by the Nx `enforce-module-boundaries` rule, and makes it possible to drop the *repository* layer between the tRPC procedures and the Prisma client.

The implementation is validated through unit tests with Vitest and end-to-end testing (E2E) with Playwright, together with an empirical evaluation of the persistence-layer latencies, front-end performance and test coverage. The measured median latency (warm calls) was 1.71 ms for CockroachDB and 0.56 ms for Redis, while image optimization reduces the delivered payload by approximately 60% across the entire catalog. The evaluation shows that the implemented stack achieves performance suitable for a production environment; the coherence and extensibility of the PAN architecture, however, are structural properties — supported by the acyclic topology checked in CI and by deriving the contracts from a single source of truth — not consequences of these latency measurements.

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

Output is a single `raw-recipes.json` snapshot containing all collected recipes alongside fetch metadata. No database interaction occurs at this stage.

### `clean-recipes.ts`

Reads `raw-recipes.json` and writes a cleaned, enriched snapshot to `clean-recipes.json`. Three derived fields are added to every recipe and the flat `instructions` string is dropped. The canonical `recipes.json` is never touched — only manual Phase 2d edits write to it (see workflow below).

The `steps` array replaces `instructions`. A three-strategy parser splits the source text into discrete steps: paragraphs separated by blank lines first, single newlines as a fallback, and a single-block "flat" representation as a last resort. For each resulting paragraph, three title-extraction patterns are tried — numbered headings (`"N. Title\nContent"`), "Step N" markers (`"Step N\nContent"`), and inline step prefixes (`"Step N: Content"`). Paragraphs that match none retain `title: null`. Recipes that fall through all three split strategies are kept as a single step and added to a `reviewFlagged` list for manual editing before seeding.

The `servings` field is estimated from ingredient bulk mass. Each ingredient is mapped to grams via either its `MeasureUnit` (volumes use water density) or a per-piece lookup for `PIECE` / `OTHER` / unitless quantities. Pure flavouring ingredients (salt, oil, vinegar, soy sauce, etc.) and flavour-only units (`TO_TASTE`, `TO_SERVE`, `GARNISH`) are excluded from the bulk total. The total is divided by a tunable grams-per-portion constant and clamped to `[1, 12]`. Recipes with fewer than two bulk ingredients or under 200g of usable data fall back to 2 servings.

The `difficulty` field is a three-way bucket — `EASY`, `MEDIUM`, `HARD` — derived in a second pass after the median complexity score across all recipes is known. The complexity score for each recipe is `ingredientCount + 2 × stepCount`, with steps weighted twice the ingredient axis. Scores below `median × 0.8335` bucket as `EASY`, above `median × 1.1665` as `HARD`, everything else as `MEDIUM`. The bands deliver an even split only if the score distribution is uniform — recipe complexity is right-skewed in practice, so expect slightly more `EASY` than `HARD`.

Output is a single `clean-recipes.json` snapshot containing all cleaned recipes alongside fetch and clean metadata, complexity stats (median, difficulty distribution, servings distribution), and the `reviewFlagged` list.

### `apply-flat-splits.ts`

Manual post-processing step that replaces the single-step entries of the recipes flagged as `flat-instructions` with hand-written multi-step splits. These recipes' source instructions lack the paragraph or numbered-line structure the parser relies on, so `clean-recipes.ts` can only emit one big step per recipe; this script fills the gap by carrying the editorial splits as a static `FLAT_OVERRIDES` map keyed by `externalId`.

The script reads `clean-recipes.json` in place, replaces each patched recipe's `steps` array verbatim (re-numbering `order` 1..N), drops the recipe from the `reviewFlagged` array, refreshes `stats.reviewFlagged` and `cleanedAt`, and writes the file back. It is idempotent — re-running on already-patched JSON produces the same output. It never touches the canonical `recipes.json`.

### `apply-residual-fixes.ts`

Post-Phase-2d quality patch run directly against the canonical `recipes.json` and `catalog.json`. Thirteen mechanical fixes that surfaced from cross-field quality sweeps after Phase 2d, each idempotent so re-running on already-fixed data is a no-op:

1. **Plural → singular ingredient rewrite.** `clean-catalog.ts` applies the `merge-candidates.json` plan to the catalog (catalog ends up holding only the singular forms), but the recipes are not retouched and keep referencing the now-removed plural keys. This script rewrites every `ingredients[].ingredientNormalizedName` in `recipes.json` from the plural form to its catalog singular, using the same merge plan as the source of truth. Required for the recipes to FK cleanly against `Ingredient.normalizedName` at seed time.
2. **`gruyere_cheese` catalog backfill.** One recipe (`52879` Chicken Parmentier) references an ingredient that is in neither the catalog nor the merge plan. The script appends a new catalog entry (`DAIRY`, next free `externalId`) with a hand-written description so the FK resolves.
3. **Tag typo renames.** Three crowd-sourced tag typos from TheMealDB rewritten in place: `desert` → `dessert` (22 recipes), `cheasy` → `cheesy` (3 recipes), `haloween` → `halloween` (1 recipe). The corrected forms already exist in the vocabulary so renames merge into the canonical bucket.
4. **Embedded numbered sub-step split.** Three recipes (`52829`, `52967`, `52805`) have step content that contains internal numbered sub-steps (`"2. While the pasta is cooking…"`) — the Phase 2b splitter missed the boundary because the parent step lacked its own leading number. The script re-emits the affected recipes' `steps` arrays verbatim from a static `STEP_REWRITES` map keyed by `externalId`, splitting each parent into its natural sub-steps with hand-written titles in sentence case.
5. **Intra-recipe ingredient dedup.** 223 recipes carry duplicate `ingredients[].ingredientNormalizedName` entries — either because the upstream recipe lists the ingredient twice for two different purposes (e.g., Battenberg Cake duplicates every base ingredient across its two coloured halves) or because the same ingredient appears once as a bulk measure and once as a finishing flavour. The schema's `@@unique([recipeId, ingredientCatalogId])` constraint would reject these at seed time. Strategy: group by normalized name, pick the highest-signal member as canonical (non-flavour unit + positive quantity > positive quantity > first member), sum quantities when every member shares the same unit, otherwise keep the canonical's measure and fold the other members' measure descriptions and notes into `notes` (e.g., `"plus 2 TBSP; for glazing"`) so no information is lost. No unit conversion is attempted — mixed-unit groups (e.g. `2 TBSP + 125 G plain_flour`) are documented in `notes` rather than coerced.
6. **Slug regeneration from title.** All 594 recipes have `slug == externalId` (e.g., `slug: "53262"` for "Adana kebab"). URLs become unreadable. The script derives a fresh kebab-case slug from the title — Latin-extended characters mapped explicitly (`æ→ae`, `ø→o`, `ß→ss`, `ł→l`, `þ→th`, `đ→d`), NFD-decomposable diacritics stripped (`Pabellón→pabellon`, `Halušky→halusky`, `Fårikål→farikal`), apostrophes dropped (`Tom's→toms`), every other non-alphanumeric collapsed to a single `-`. Collisions are disambiguated deterministically by sorting on `externalId` (lowest keeps the bare slug; later ones get `-2`, `-3`, etc.) — the cross-recipe title set happens to be unique today, so no suffixing fires, but the logic stays in case a future Phase 2d edit introduces a clash.
7. **Typographic-character normalization in step content.** Curly apostrophes (`U+2019`) and curly left/right double and single quotes (`U+2018`, `U+201C`, `U+201D`) normalized to straight ASCII for grep-friendly, JSON-safe content; Unicode fraction slash (`U+2044`) normalized to regular `/` so `1⁄2` and `1/2` match in searches; decorative smiley (`U+263A`) dropped along with its leading space; single right angle quote (`U+203A`) used as a metadata-line separator (`Prep:15min › Cook:30min › Ready in:45min`) replaced with ` · `. The same pass collapses internal double-spaces to single. The degree-fahrenheit symbol (`U+2109`, `℉`) is intentionally preserved.
8. **`"Serves N"` metadata step removal.** Recipe `52994` had `"Serves 2"` as the literal content of step 1 — leaked recipe metadata, not a cooking instruction. The script filters any step whose content matches `^serves\s+\d+\.?$` and re-numbers the remaining steps to close the gap. Servings already lives on `Recipe.servings`.
9. **Unicode-fraction quantity parsing in notes.** The upstream measure parser in `fetch-recipes.ts` does not recognize Unicode fraction characters (`½ ¼ ¾ ⅓ ⅔ ⅛ ⅜ ⅝ ⅞`), so notes like `"½ tsp"` and `"¼ cup"` survived with `quantity: null, unit: null`. The script parses `{fraction} {unit-word} [trailing modifier]` patterns and re-emits as `(quantity, unit, notes?)` — `"½ tsp"` becomes `(0.5, TSP, null)`, `"½ cup freshly grated"` becomes `(0.5, CUP, "freshly grated")`.
10. **Flavor-phrase note mapping.** Notes like `"Sprinkling"`, `"For brushing"`, `"Handful"`, `"Bunch"`, `"Sprigs of fresh"`, `"Juice of 1/2"`, `"Half"`, `"Can"`, `"Chopped"`, `"Knob"`, prep-adjectives (`"Ground"`, `"Crushed"`, `"Halved"`, etc.) — all collapsed into the appropriate `MeasureUnit` (`TO_TASTE`, `TO_SERVE`, `GARNISH`, `BUNCH`, `PINCH`, `PIECE`) with the original prep direction preserved on `notes` when it carries semantic value (`"chopped"`, `"large"`, `"juice"`, etc.). Common typos (`"Sprinking"`, `"spinkling"`, `"handfull"`) are matched alongside the canonical spellings.
11. **Title casing for lowercase recipe titles.** Two recipes shipped with all-lowercase titles (`kabse` → `Kabse`, `kofta burgers` → `Kofta Burgers`). The script title-cases every word in any title that contains lowercase letters and no uppercase ones.
12. **Restore lost `videoUrl` values.** The `youtubeUrl` field on `Recipe` was generalised to `videoUrl` so the platform now accepts any video host (TikTok, Bing video search, etc.). An earlier nullify-non-YouTube pass in this script had already discarded four such URLs (`53122`, `53121`, `53097` Bing video searches and `53231` a TikTok video); the script now restores them from a hardcoded `LOST_VIDEO_URLS` map keyed by `externalId`. The fifth historical case (`53102`) had a `youtubeUrl` identical to its `sourceUrl`, so nothing was lost there.
13. **Rewrite truncated step titles.** 80 step titles were cut mid-phrase by the upstream splitter (`"Bake in the preheated"`, `"Heat 1 tbsp"`, etc.). The script carries a static `TRUNCATED_TITLE_REWRITES` map keyed by `${externalId}:${order}` with hand-written sentence-case replacements.
14. **Restore 25 recipes that arrived with broken or undersplit step lists.** Several distinct failure modes share the same restoration path through a single hardcoded `DAMAGED_RECIPES_RESTORE` map (one entry per recipe with the complete final step list, reconstructed in Phase-2d house style: one instruction per step, sentence-case titles ~3-5 words, leading `"N."` enumeration stripped from content). Idempotency: skip if the recipe's current step count and first/last titles already match the restored list. The modes:
    - **Idempotency-bug damage** — Four recipes (`53188` Fašírky, `53354` Jamaican Curry Goat, `53187` Šúĺlance s Makom, `53075` Tortang Talong) were damaged by an earlier section-header removal pass keyed by `${externalId}:${order}`; on a second consecutive run it re-targeted renumbered survivors and lost nine real instructions. Restored from `clean-recipes.json`.
    - **▢-divider** — Two recipes (`53131` Fyrstekake, `53124` Raspeballer) used the U+25A2 empty-checkbox `▢` character as a between-step divider in their upstream `instructions`; Phase 2d glued all sub-instructions into two oversized parent steps. Split on `▢`, drop section headers, retitle in sentence case.
    - **Hybrid recipe with sub-recipe anchor** — One recipe (`52784` Smoky Lentil Chili with Squash) contains a main chili (step 1, 5 paragraphs) plus a cashew sour cream sub-recipe (step 2 = intentional ingredient-list anchor, step 3 = 3 paragraphs). Split paragraphs into discrete steps; the ingredient-list anchor is preserved verbatim since its title acts as a section label for the sub-recipe.
    - **Tier 1 — "Header: instructions" + "Pro Tips" tail** — Ten recipes share an identical upstream shape (53138 Alfajores, 53133 Asado, 53141 Carbonada Criolla, 53136 Choripán, 53137 Dulce de Leche, 53134 Empanadas, 53139 Fainá, 53146 Locro, 53140 Matambre a la Pizza, 53135 Milanesa). Step 1 packs the entire cooking method as `Header: instructions` lines with a trailing `Pro Tips:` label; step 2 (occasionally step 3) holds bullet-style tips. Split step 1 on section labels and consolidate the tips into one closing `Tips and substitutions` step.
    - **Tier 2 — variably labeled** — Four recipes (52812 Beef Brisket Pot Roast, 52938 Jamaican Beef Patties, 53352 Jamaican Instant Pot Rice and Beans, 52820 Katsu Chicken Curry) carry labeled or numbered sub-instructions packed into 1-2 oversized steps; restorations are hand-tailored to each. 52820's stale metadata step (`Prep:15min · Cook:30min · Ready in:45min`) is dropped entirely.
    - **Tier 3 — multi-paragraph without labels** — Four recipes (53027 Koshari, 53029 Mulukhiyah, 53054 Seri muka kuih, 53325 Venezuelan Arepas) have unlabelled multi-paragraph steps; paragraphs split into discrete steps. 53325's image-caption noise (`arepa making` ×2) and 53027's section-header step (`Make the crispy onion topping.`) are dropped.
15. **Remove section-header steps.** Eight steps across three recipes (`53188` ×6, `53354` ×1, `53187` ×1) survived as glorified divider headers (title == content, short, no terminator). They are matched by `externalId + content` equality — once removed the content is gone and subsequent runs cannot re-match. The remaining steps in each affected recipe are re-numbered to close the gap.
16. **Trim leading/trailing whitespace on recipe titles** (one case: `52969` `"Chakchouka "`).
17. **Strip zero-width spaces (U+200B) from step content** (one step in `53057`).
18. **Strip leading punctuation** (`.`, `,`, `;`, `:`, `-`, en/em dash) followed by whitespace from step content (one case: `53074` step 1 began with `". "`).
19. **Parse measures carried in ingredient notes when quantity is set but unit is null.** 124 ingredients had `quantity != null, unit == null` and a `notes` string carrying the real measure (`"½ tbsp"`, `"1/2 cup"`, `"(400g) tin"`, `"Juice of 1"`, `"14-ounce can"`, etc.). The parser splits notes on `;` (drop dedup leftovers like `"plus 1"`), strips leading dashes from range fragments, and matches against fraction-unit, parenthetical-mass, hyphenated-unit, juice/zest, and unit-only patterns. Quantity is overridden with the parsed value, unit is set, notes are cleared or trimmed to residual context.
20. **Default countable ingredients to PIECE (or CLOVE).** ~720 ingredients survived with `quantity != null, unit == null, notes == null` after every other pass — countable items (`6 egg`, `4 tomato`, `1 bay_leaf`, `2 garlic_clove`, etc.) where the upstream parser had only a number. The script sets `unit = PIECE` for these, with `garlic_clove` getting the dedicated `CLOVE` unit.
21. **Reclassify `difficulty` against the post-restoration median.** The step rewrites in step 14 changed the step counts on 25 recipes, which shifted the global complexity distribution. This pass replays the original `clean-recipes` formula (`ingredients + 2 × steps`, with flavour-only units `TO_TASTE`/`TO_SERVE`/`GARNISH` excluded), recomputes the upper-median across all 594 recipes, and re-buckets each recipe (`EASY` if `score < median × 0.8335`, `HARD` if `score > median × 1.1665`, else `MEDIUM`). `stats.medianComplexityScore` and `stats.difficultyDistribution` on the snapshot are refreshed to match. Post-pass the median sits at 19 and the distribution lands at `EASY: 179 / MEDIUM: 238 / HARD: 177`; 55 recipes shifted buckets in total (mostly consolidating toward `MEDIUM` as the median grew with the restored step counts).

Reads and writes `recipes.json` + `catalog.json` in place. Every pass is idempotent — patterns only match their unfixed form, the lookup maps no-op on already-rewritten keys, and the URL/title/dedup/slug passes short-circuit when the current state matches the target. A second consecutive run prints zeros across every counter.

Run after every Phase 2d manual refinement that touches ingredients, tags, step structure, slugs, recipe titles, or YouTube URLs.

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

Outputs: `raw-recipes.json`

#### Phase 2b — Clean & enrich recipes

```bash
npm run clean-recipes
```

Outputs: `clean-recipes.json` — adds parsed `steps[]`, estimated `servings`, and bucketed `difficulty`; drops the flat `instructions` string. **Never writes to `recipes.json`** — the canonical seed source is hand-refined and only updated through deliberate manual review (Phase 2d).

#### Phase 2c — Apply manual flat-instruction splits

```bash
npm run apply-flat-splits
```

In-place edit of `clean-recipes.json` — replaces the single-step entries of the recipes flagged as `flat-instructions` with hand-written multi-step splits and clears them from `reviewFlagged`. Run after every `clean-recipes`. Like Phase 2b, this script only touches `clean-recipes.json`.

#### Phase 2d — Manual refinement (post-pipeline, committed as `recipes.json`)

The committed `recipes.json` is the canonical seed source. It is further hand-refined beyond what Phases 2b and 2c produce — refinements include additional structural repairs (re-segmenting recipes whose splitter output was incorrect, fixing transcription typos like leading missing letters, removing image-caption alt-text that leaked into the instructions, merging fragments split across step boundaries), removal of all-caps section header steps and outro "Enjoy!" steps, stripping leading enumeration prefixes (`"1. "`, `"Step 2: "`) from content since the UI re-numbers, and a full title regeneration in sentence case with subordinate-clause skipping.

Rerunning `clean-recipes` + `apply-flat-splits` on the current `raw-recipes.json` produces `clean-recipes.json` — a close but **not identical** regeneration of `recipes.json`. The Phase 2d refinements live only in the committed `recipes.json`. To diff the two, compare `clean-recipes.json` (latest pipeline output) against `recipes.json` (canonical).

When promoting pipeline changes to the canonical: review the diff manually, apply selected changes by hand, then commit `recipes.json`. The pipeline scripts intentionally never overwrite the canonical file.

#### Phase 2e — Residual fixes (idempotent, on canonical files)

```bash
npm run apply-residual-fixes
```

In-place edit of both `recipes.json` and `catalog.json`. Applies the four mechanical fixes documented under [`apply-residual-fixes.ts`](#apply-residual-fixests): plural→singular ingredient rewrite, `gruyere_cheese` catalog backfill, `desert`→`dessert` tag rename, and the three embedded-sub-step splits. Unlike Phases 2b and 2c, this script writes to the canonical `recipes.json` directly — its scope is restricted to deterministic mechanical rewrites that survive idempotency checks, so any future Phase 2d edits that touch the same surfaces will be picked up the next time this script runs.

Run after every Phase 2d manual refinement that touches ingredients, tags, or step structure.

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
| `types.ts` | Shared TypeScript types (mirror Prisma schema, no `@prisma/client` dependency) |
| `fetch-catalog.ts` | Fetches categories, areas, ingredients from TheMealDB |
| `generate-merge-candidates.ts` | Analyzes `raw-catalog.json` and detects plural→singular candidate pairs for review |
| `clean-catalog.ts` | Normalizes plurals, deduplicates, auto-categorizes ingredients |
| `fetch-recipes.ts` | Fetches all recipes via premium list endpoint |
| `clean-recipes.ts` | Parses steps, estimates servings, classifies difficulty |
| `apply-flat-splits.ts` | Manual post-processing — splits flat-instruction recipes into multi-step entries |
| `apply-residual-fixes.ts` | Post-Phase-2d residual quality fixes — plural ingredient rewrite, catalog backfill, tag typo, sub-step splits; idempotent |
| `merge-candidates.json` | Approved plural→singular normalization decisions |
| `raw-catalog.json` | Raw snapshot from TheMealDB (generated, not committed) |
| `catalog.json` | Cleaned snapshot (generated, not committed) |
| `raw-recipes.json` | Raw recipes snapshot from TheMealDB (generated, not committed) |
| `clean-recipes.json` | Pre-Phase-2d snapshot — output of `clean-recipes` + `apply-flat-splits`, kept for diffing |
| `recipes.json` | Canonical seed source — Phase 2d hand-refined; committed |

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
├── en/                      # English thesis sources (same structure, English file names)
├── dist/                    # Compiled PDFs (generated, not committed)
└── research/
    └── the-meal-db/         # Data acquisition scripts (see Research Scripts above)
```

## 📜 License

- **Thesis text and figures** — the LaTeX sources in `ro/` and `en/`, the images in `images/` and the thesis PDFs in `dist/` — are licensed under [CC BY-SA 4.0](LICENSE-CC-BY-SA-4.0).
- **Code** — the build scripts and the TypeScript research scripts in `research/` — is licensed under [Apache-2.0](LICENSE).
- **Third-party material is covered by neither license:** the University of Bucharest and FMI logos (`images/logo-ub.png`, `images/logo-fmi.png`) belong to the university, and the recipe data in `research/the-meal-db/` — including the recipe photos visible in the app screenshots — comes from [TheMealDB](https://www.themealdb.com) under its own terms.
