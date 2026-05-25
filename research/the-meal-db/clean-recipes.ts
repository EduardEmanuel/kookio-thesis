/**
 * clean-recipes.ts — Phase 2b: Clean & Enrich Recipes
 *
 * Reads raw-recipes.json (the snapshot produced by fetch-recipes) and writes
 * a cleaned, enriched snapshot to clean-recipes.json with three derived fields:
 *
 *   - steps[]      structured (order, title?, content) replacing the flat
 *                  instructions string; parsed via three fallback strategies
 *   - servings     estimated from ingredient bulk mass, clamped to [1, 12]
 *   - difficulty   EASY | MEDIUM | HARD bucketed against median complexity
 *
 * Two-pass: pass 1 parses steps + computes per-recipe complexity scores;
 * pass 2 buckets difficulty against the median.
 *
 * Recipes whose instructions cannot be segmented (single block, no
 * paragraph or line separators) are kept as a single step and added to
 * `reviewFlagged` for manual editing before seeding.
 *
 * Run via: npm run clean-recipes
 */

import type {
  CleanRecipeRow,
  Difficulty,
  MeasureUnit,
  RecipeIngredientRow,
  RecipeStepRow,
  RecipesCleanSnapshot,
  RecipesSnapshot,
  ReviewFlag,
} from './types.js';
import {
  cleanProseWhitespace,
  filterUsableRecipes,
  readJsonFile,
  runMain,
  writeJsonFile,
} from './utils.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INPUT_FILE = 'raw-recipes.json';
// Writes to clean-recipes.json (the pre-Phase-2d snapshot). The canonical
// recipes.json is hand-refined and intentionally NOT regenerable from this
// pipeline — see README Phase 2d for the rationale.
const OUTPUT_FILE = 'clean-recipes.json';

// Tunable: grams of bulk-edible mass that constitute one main-meal serving.
// 400g is a working assumption; rerun and re-tune if the servings distribution
// skews to one bucket (e.g. everything lands at 2 or 4).
const GRAMS_PER_PORTION = 400;

// Difficulty bucket thresholds. Bands are median ± 1/6 of the median, which
// gives an even split only if the score distribution is itself uniform —
// recipe complexity is right-skewed, so expect more EASY than HARD.
const EASY_THRESHOLD_FRACTION = 0.8335; // median × (1 − 1/6)
const HARD_THRESHOLD_FRACTION = 1.1665; // median × (1 + 1/6)

// ---------------------------------------------------------------------------
// Step parser
// ---------------------------------------------------------------------------

/**
 * Detects "noise" paragraphs that the recipe author used as visual scaffolding
 * but that carry no instructional content. Dropping them prevents the parser
 * from producing empty steps with bullet glyphs or bare digits as content.
 *
 * Caught:
 *   - Symbol-only paragraphs (▢, ▪, ●, *, etc.) used as list markers
 *   - Bare digit markers ("1", "2", "12") from numbered lists
 *   - Literal "step N" markers without trailing content
 *   - Short standalone section headers ≤ 30 chars with no sentence punctuation
 *     (e.g. "Shells", "Almond filling", "Glaze", "Instructions")
 */
const isNoiseParagraph = (p: string): boolean => {
  const s = p.trim();
  if (s.length === 0) return true;
  // No letters or digits → pure-symbol bullet (▢, ▪, ●, *, -, …)
  if (!/[a-zA-Z\d]/.test(s)) return true;
  // Bare digit list marker (with or without trailing punctuation)
  if (/^\d{1,3}[.):]?$/.test(s)) return true;
  // Literal "step N" / "STEP 2" / "Step 3:" with nothing after
  if (/^step\s+\d{1,3}\s*[:\-.]?$/i.test(s)) return true;
  // Short section header: letters-only, ≤ 30 chars, no sentence punctuation
  if (
    s.length <= 30 &&
    !/[.!?]/.test(s) &&
    /^[A-Za-z][A-Za-z\s&'-]*[A-Za-z:]?$/.test(s)
  ) {
    return true;
  }
  return false;
};

/**
 * Splits an instructions string into discrete steps with optional titles.
 *
 * Strategies, tried in order:
 *   1.  Split on blank-line paragraphs (`\n\s*\n`)
 *   1.5 If still one block but text contains numbered list markers
 *       (`\n1.`, `\n2.`, `\nstep 3:`), split on those — handles
 *       soft-wrapped recipes whose lines are visually wrapped but whose
 *       structure is carried by the numbering ("1. ... 2. ... 3. ...").
 *   2.  Fall back to single-newline split (last resort)
 *   3.  If still one block, return it as a single step and flag for review
 *
 * After splitting, any paragraph starting with a lowercase letter is
 * merged back into the previous one — these are sentence continuations
 * that an unexpected blank line in the source incorrectly broke off.
 *
 * For each resulting paragraph, three title-extraction patterns are tried:
 *   A. `"N. Title\nContent"` or `"N) Title\nContent"` — numbered with title
 *   B. `"Step N\nContent"`                            — "Step N" prefix only
 *   C. `"Step N: Content"`                            — "Step N" inline
 * If none match, the paragraph becomes content with `title: null`.
 */
const parseSteps = (
  instructions: string,
): { steps: RecipeStepRow[]; isFlat: boolean } => {
  const cleaned = cleanProseWhitespace(instructions) ?? '';

  // Strategy 1: paragraphs separated by blank lines.
  let paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Drop scaffolding paragraphs (bullets, bare digits, section headers).
  paragraphs = paragraphs.filter((p) => !isNoiseParagraph(p));

  // Strategy 1.5: if blank-line split produced just one block but the
  // source carries structure via numbered markers, split on those.
  if (paragraphs.length <= 1 && /\n\s*\d+[.):]\s+/.test(cleaned)) {
    paragraphs = cleaned
      .split(/(?:^|\n)\s*(?=\d+[.):]\s+)/)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !isNoiseParagraph(p));
  }

  // Strategy 2: last-resort fallback — split on every single newline.
  if (paragraphs.length <= 1) {
    paragraphs = cleaned
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((p) => !isNoiseParagraph(p));
  }

  // Merge sentence-continuation paragraphs into the previous one.
  // A paragraph counts as a continuation only when it starts with a
  // lowercase letter AND the previous paragraph doesn't end with a
  // sentence terminator — otherwise an editor genuinely intended two
  // separate steps even if the second one starts informally lowercase.
  if (paragraphs.length > 1) {
    const mergedParagraphs: string[] = [];
    for (const p of paragraphs) {
      const prev = mergedParagraphs[mergedParagraphs.length - 1];
      const isContinuation =
        prev !== undefined && /^[a-z]/.test(p) && !/[.!?]["')\]]?\s*$/.test(prev);
      if (isContinuation) {
        mergedParagraphs[mergedParagraphs.length - 1] = prev + ' ' + p;
      } else {
        mergedParagraphs.push(p);
      }
    }
    paragraphs = mergedParagraphs;
  }

  // Strategy 3: truly flat — single step + flag for manual review.
  if (paragraphs.length <= 1) {
    return {
      steps: [{ order: 1, title: null, content: cleaned }],
      isFlat: true,
    };
  }

  const steps: RecipeStepRow[] = paragraphs.map((p, i) => {
    // Pattern A: "N. Title\nContent" with title ≤ 80 chars, starts uppercase.
    const numberedSection = p.match(
      /^(\d{1,3})[.)]\s*\t?\s*([A-Z][^\n]{0,80})\n([\s\S]+)$/,
    );
    if (numberedSection) {
      return {
        order: i + 1,
        title: numberedSection[2].trim(),
        content: numberedSection[3].trim(),
      };
    }

    // Pattern B: "step N\nContent" — "step N" itself is a marker, not a title.
    const stepPrefix = p.match(/^step\s+\d+\s*[:\-.]?\s*\n([\s\S]+)$/i);
    if (stepPrefix) {
      return {
        order: i + 1,
        title: null,
        content: stepPrefix[1].trim(),
      };
    }

    // Pattern C: "Step N: Content" — strip prefix, content is the rest.
    const stepInline = p.match(/^step\s+\d+\s*[:\-.]?\s*(.+)$/i);
    if (stepInline) {
      return {
        order: i + 1,
        title: null,
        content: stepInline[1].trim(),
      };
    }

    return {
      order: i + 1,
      title: null,
      content: p,
    };
  });

  return { steps, isFlat: false };
};

// ---------------------------------------------------------------------------
// Step title generator
// ---------------------------------------------------------------------------

/**
 * Cooking verbs that anchor a title. Order doesn't matter — set membership
 * only. Diacritics-insensitive: ascii-folded forms are stored, so "sauté"
 * matches "saute" after normalisation.
 */
const COOKING_VERBS = new Set([
  // Heat / cook
  'heat', 'preheat', 'cook', 'bake', 'roast', 'fry', 'deepfry', 'saute',
  'simmer', 'boil', 'grill', 'toast', 'broil', 'steam', 'poach',
  'caramelize', 'caramelise', 'sear', 'braise', 'reduce', 'warm',
  // Combine
  'add', 'mix', 'stir', 'combine', 'whisk', 'beat', 'fold', 'blend',
  'toss', 'incorporate', 'pour', 'drizzle',
  // Prep
  'peel', 'chop', 'slice', 'dice', 'mince', 'cut', 'grate', 'shred',
  'crush', 'mash', 'puree', 'wash', 'rinse', 'drain', 'pat', 'trim',
  'remove', 'discard', 'crack', 'break', 'season', 'salt',
  'sprinkle', 'rub', 'marinate', 'soak', 'dust', 'coat', 'halve',
  'quarter', 'scrape', 'score', 'tear', 'rip', 'skin', 'devein',
  // Placement
  'place', 'transfer', 'arrange', 'spread', 'top', 'cover', 'wrap',
  'line', 'grease', 'butter', 'oil', 'flour', 'layer', 'fill', 'stuff',
  'lay', 'dot', 'scatter', 'tuck', 'submerge', 'skewer', 'sandwich',
  // Dough / baking
  'knead', 'roll', 'shape', 'form', 'flatten', 'press', 'sift',
  // Finishing
  'serve', 'garnish', 'finish', 'plate', 'enjoy', 'taste', 'check',
  'let', 'allow', 'set', 'rest', 'cool', 'chill', 'refrigerate',
  'freeze', 'reheat',
  // Action
  'divide', 'drop', 'ladle', 'swirl', 'dollop', 'smear', 'splash',
  'skim', 'deglaze', 'loosen', 'bash', 'pound', 'grind', 'whip',
  'whizz', 'gather', 'bring', 'melt', 'put',
  // Generic
  'prepare', 'make', 'turn', 'flip', 'tip', 'scoop', 'spoon', 'use',
]);

/**
 * Leading words that introduce a step but aren't the meaningful verb.
 * Skipped when looking for the title anchor.
 */
const CONNECTIVE_WORDS = new Set([
  'meanwhile', 'while', 'next', 'then', 'finally', 'now', 'first',
  'after', 'once', 'when', 'before', 'lastly', 'afterward', 'afterwards',
  'subsequently', 'immediately', 'gently', 'carefully', 'quickly',
  'slowly', 'firstly', 'secondly',
]);

/**
 * Words that mark a clause boundary — title construction stops when one is
 * reached, keeping titles short and focused on the leading action.
 */
const TITLE_STOP_WORDS = new Set([
  'and', 'or', 'but', 'in', 'into', 'on', 'onto', 'at', 'by', 'of',
  'off', 'out', 'up', 'down', 'apart', 'aside', 'alongside', 'beside',
  'near', 'throughout', 'until', 'with', 'within', 'without', 'over',
  'under', 'for', 'to', 'from', 'before', 'after', 'while', 'about',
  'around', 'through', 'between', 'against', 'during', 'as', 'so',
  'if', 'when', 'where', 'whilst', 'unless', 'because',
]);

const ARTICLES = new Set(['a', 'an', 'the']);

const MAX_TITLE_WORDS = 5;
const SHORT_CONTENT_THRESHOLD = 30;
const MIN_TITLE_LENGTH = 3;

/** ASCII-fold + lowercase for verb-dictionary matching. */
const foldToAscii = (word: string): string =>
  word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');

/** Title case with article lowercasing — but the first word always capitalises. */
const titleCase = (s: string): string =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (i > 0 && ARTICLES.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');

/**
 * Derives a short title from a step's content string.
 *
 * Strategy:
 *   1. If content is short (≤ 30 chars) just title-case the whole thing.
 *   2. Take the first sentence and skip any leading connectives.
 *   3. Find the first cooking verb in the next ~5 words; build the title
 *      from verb + up to 4 following words, stopping at clause boundaries.
 *   4. If no verb matches, fall back to first 4 words of the sentence.
 *   5. Return null only if nothing usable can be built (defensive).
 */
const generateTitle = (content: string): string | null => {
  if (!content || content.length < MIN_TITLE_LENGTH) return null;

  // Strip "Step N:" marker, bare "N."/"N)"/"N:" numeric prefixes, and any
  // leading non-alphanumeric chars (".  Prepare..." → "Prepare...").
  const stripped = content
    .replace(/^step\s+\d+\s*[:\-.]?\s*/i, '')
    .replace(/^\d{1,3}[.):]?\s+/, '')
    .replace(/^[^A-Za-z0-9]+/, '')
    .trim();

  if (stripped.length === 0) return null;

  if (stripped.length <= SHORT_CONTENT_THRESHOLD) {
    return trimTrailingFiller(titleCase(stripped.replace(/[.!?,;:]+$/, '')));
  }

  const firstSentence = stripped
    .split(/[.!?]\s/)[0]
    .trim()
    .replace(/[.,;:!?]+$/, '');

  const words = firstSentence.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  let cursor = 0;
  while (cursor < words.length && CONNECTIVE_WORDS.has(foldToAscii(words[cursor]))) {
    cursor++;
  }

  // Scan up to 12 words to catch verbs that follow long prepositional phrases
  // like "In a large cast iron skillet or sauté pan with a lid, heat oil...".
  let verbIdx = -1;
  for (let j = cursor; j < Math.min(cursor + 12, words.length); j++) {
    if (COOKING_VERBS.has(foldToAscii(words[j]))) {
      verbIdx = j;
      break;
    }
  }

  let titleWords: string[];

  if (verbIdx === -1) {
    // Fallback: first 4 words, but still respect stop-word boundaries.
    titleWords = [];
    for (let j = cursor; j < Math.min(cursor + 4, words.length); j++) {
      if (TITLE_STOP_WORDS.has(foldToAscii(words[j]))) break;
      titleWords.push(words[j]);
    }
    if (titleWords.length === 0) {
      // Stop word in the very first position — keep at least one word so
      // we don't return null on otherwise valid sentences ("In the bowl…").
      titleWords = words.slice(cursor, Math.min(cursor + 2, words.length));
    }
  } else {
    titleWords = [words[verbIdx]];
    for (let j = verbIdx + 1; j < Math.min(verbIdx + MAX_TITLE_WORDS, words.length); j++) {
      if (TITLE_STOP_WORDS.has(foldToAscii(words[j]))) break;
      titleWords.push(words[j]);
    }
  }

  if (titleWords.length === 0) return null;

  const raw = titleWords.join(' ').replace(/[,;:.]+$/, '').trim();
  if (raw.length < MIN_TITLE_LENGTH) return null;

  const titled = trimTrailingFiller(titleCase(raw));
  if (titled.length < MIN_TITLE_LENGTH || !/[a-zA-Z]/.test(titled)) return null;

  return titled;
};

/**
 * Strip trailing articles, prepositions, and conjunctions that survived
 * word-slicing — e.g. "Wash the Edge of the" → "Wash the Edge".
 */
const trimTrailingFiller = (s: string): string => {
  const trailingFillers = new Set([...ARTICLES, ...TITLE_STOP_WORDS]);
  const parts = s.split(/\s+/);
  while (parts.length > 1 && trailingFillers.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }
  return parts.join(' ');
};

// ---------------------------------------------------------------------------
// Servings heuristic
// ---------------------------------------------------------------------------

/**
 * Approximate mass of one unit of a `MeasureUnit`. Volumes use water density
 * (1 g/ml) — close enough for stocks, sauces, dairy; less accurate for oils.
 * Excludes PIECE / OTHER (handled via INGREDIENT_PIECE_GRAMS lookup) and the
 * flavour-only units TO_TASTE / TO_SERVE / GARNISH (skipped from bulk mass).
 */
const UNIT_TO_GRAMS: Partial<Record<MeasureUnit, number>> = {
  G: 1,
  KG: 1000,
  ML: 1,
  L: 1000,
  TSP: 5,
  TBSP: 15,
  CUP: 240,
  OZ: 28,
  LB: 454,
  SLICE: 30,
  CLOVE: 5,
  BUNCH: 50,
  PINCH: 0.5,
};

/**
 * Grams-per-piece for common ingredients when the recipe uses PIECE / OTHER
 * or omits the unit entirely. Keys match the snake_case normalizedName
 * produced by fetch-recipes / fetch-catalog.
 */
const INGREDIENT_PIECE_GRAMS: Record<string, number> = {
  // Eggs & dairy
  egg: 60,
  eggs: 60,
  large_egg: 65,

  // Alliums
  onion: 150,
  red_onion: 130,
  shallot: 25,
  spring_onion: 15,
  scallion: 15,
  leek: 200,
  garlic: 50,
  garlic_clove: 5,

  // Roots & tubers
  potato: 200,
  sweet_potato: 250,
  carrot: 80,
  celery: 40,
  parsnip: 130,
  turnip: 150,
  beetroot: 150,
  ginger: 50,

  // Solanaceae
  tomato: 120,
  cherry_tomato: 15,
  vine_tomato: 100,
  plum_tomato: 60,
  bell_pepper: 150,
  red_pepper: 150,
  green_pepper: 150,
  yellow_pepper: 150,
  chilli: 10,
  chillies: 10,
  chili: 10,
  red_chilli: 10,
  jalapeno: 10,
  scotch_bonnet: 10,
  eggplant: 300,
  aubergine: 300,

  // Cucurbits
  cucumber: 300,
  zucchini: 200,
  courgette: 200,
  pumpkin: 1000,
  butternut_squash: 1000,

  // Leafy & cruciferous
  lettuce: 300,
  cabbage: 900,
  cauliflower: 800,
  broccoli: 600,
  pak_choi: 200,
  bok_choi: 200,

  // Fungi
  mushroom: 20,
  mushrooms: 20,
  portobello_mushroom: 80,

  // Citrus
  lemon: 100,
  lime: 60,
  orange: 180,

  // Other fruit
  apple: 180,
  banana: 120,
  pear: 170,
  peach: 150,
  avocado: 200,
  mango: 300,
  pineapple: 900,

  // Proteins (whole or large cut)
  chicken: 1500,
  chicken_breast: 200,
  chicken_thigh: 150,
  chicken_leg: 200,
  duck: 2000,
  turkey: 5000,
  fish: 400,
  salmon: 400,
  cod: 200,
  tuna: 200,
  prawn: 15,
  shrimp: 15,
  squid: 200,

  // Bread & baked
  bread: 500,
  bread_slice: 30,
  baguette: 250,
  bun: 60,
  tortilla: 50,
  pita: 60,

  // Other common pieces
  bay_leaf: 0.5,
  cinnamon_stick: 2,
  star_anise: 0.5,
  vanilla_pod: 2,
};

const DEFAULT_PIECE_GRAMS = 100;

/**
 * Pure-flavouring ingredients excluded from bulk mass — they don't contribute
 * to the "amount you eat" axis the servings calculation is trying to estimate.
 */
const BULK_EXCLUDED_PATTERNS: RegExp[] = [
  /\b(salt|pepper|sugar|spice|herb|seasoning)\b/i,
  /^water$/i,
  /\boil\b/i,
  /vinegar/i,
  /soy_sauce|fish_sauce|worcestershire/i,
];

const isBulkIngredient = (normalizedName: string): boolean => {
  const searchable = normalizedName.replace(/_/g, ' ');
  return !BULK_EXCLUDED_PATTERNS.some((p) => p.test(searchable));
};

/**
 * Estimates servings by summing bulk-edible mass across the ingredient list
 * and dividing by `GRAMS_PER_PORTION`. Returns `hasReliableData: false` and
 * a fallback of 2 when fewer than 2 bulk ingredients carry usable mass data,
 * letting the caller flag the recipe if needed.
 */
const estimateServings = (
  ingredients: RecipeIngredientRow[],
): { servings: number; hasReliableData: boolean } => {
  let totalGrams = 0;
  let bulkIngredientCount = 0;

  for (const ing of ingredients) {
    const qty = ing.quantity ?? 0;
    if (qty <= 0) continue;
    if (!isBulkIngredient(ing.ingredientNormalizedName)) continue;

    let grams: number | null = null;

    if (ing.unit && UNIT_TO_GRAMS[ing.unit] !== undefined) {
      grams = qty * (UNIT_TO_GRAMS[ing.unit] as number);
    } else if (
      ing.unit === 'PIECE' ||
      ing.unit === 'OTHER' ||
      ing.unit === null
    ) {
      const lookup = INGREDIENT_PIECE_GRAMS[ing.ingredientNormalizedName];
      grams = qty * (lookup ?? DEFAULT_PIECE_GRAMS);
    }

    if (grams !== null && grams > 0) {
      totalGrams += grams;
      bulkIngredientCount++;
    }
  }

  const hasReliableData = bulkIngredientCount >= 2 && totalGrams >= 200;

  if (!hasReliableData) {
    return { servings: 2, hasReliableData: false };
  }

  const raw = totalGrams / GRAMS_PER_PORTION;
  const servings = Math.max(1, Math.min(12, Math.round(raw)));

  return { servings, hasReliableData: true };
};

// ---------------------------------------------------------------------------
// Ingredient unit normalization
// ---------------------------------------------------------------------------

/**
 * Promotes `unit: "OTHER"` to a typed MeasureUnit when the `notes` field
 * carries enough signal to interpret the quantity. Three buckets:
 *
 *   1. Known unit-name typos / abbreviations leaked into notes by the
 *      raw measure-string parser ("tblsp", "tbls" → TBSP, "tsp" → TSP,
 *      "dash" → PINCH). Strip the unit word from notes.
 *   2. Container references ("can", "jar", "packet", "x 400g") — leave
 *      OTHER intact; the recipe author is referring to whole containers
 *      and the actual volume is genuinely opaque.
 *   3. Prep descriptors ("chopped", "large", "sprigs", "finely diced",
 *      anything that doesn't match buckets 1 or 2) — quantity is a
 *      discrete piece count → PIECE. Keep notes so the UI can show
 *      "1 onion, chopped" instead of just "1 onion".
 *
 * No-op when unit is anything other than OTHER, or when notes is empty
 * (no signal to interpret).
 */
const normalizeIngredientUnit = (
  ing: RecipeIngredientRow,
): RecipeIngredientRow => {
  if (ing.unit !== 'OTHER' || !ing.notes) return ing;

  const note = ing.notes.toLowerCase().trim();

  // Bucket 1: unit-name leaks
  const tbsp = note.match(/^(?:tblsp|tbls|tbsp)\b\s*(.*)$/);
  if (tbsp) {
    const rest = tbsp[1].trim();
    return { ...ing, unit: 'TBSP', notes: rest.length > 0 ? rest : null };
  }
  const tsp = note.match(/^(?:tsp|teaspoon)\b\s*(.*)$/);
  if (tsp) {
    const rest = tsp[1].trim();
    return { ...ing, unit: 'TSP', notes: rest.length > 0 ? rest : null };
  }
  if (/^(?:dash|dashes|pinch|pinches)$/.test(note)) {
    return { ...ing, unit: 'PINCH', notes: null };
  }

  // Bucket 2: bare container references (kept as OTHER — size unknown)
  if (
    /^(?:can|cans|tin|tins?|packet|pack|pkt|sachet|jar|bag|pot|bottle|tub|tubs?|box|carton)\b/.test(
      note,
    )
  ) {
    return ing;
  }

  // Bucket 3a: "x Ng" / "x Nkg" / "x Nml" / "x Nl" / "x Noz" / "x Nlb" —
  // container/piece-size descriptor with a known mass/volume. Convert
  // qty × N to the typed unit so the pantry-subtraction step has real
  // numbers to work with. Trailing context ("tins", "cans") preserved
  // in notes so the UI can still render "2 × 400g tins of beans".
  const xNUnit = note.match(
    /^x\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|oz|lb)\b\s*(.*)$/i,
  );
  if (xNUnit) {
    const unitMap: Record<string, RecipeIngredientRow['unit']> = {
      g: 'G',
      kg: 'KG',
      ml: 'ML',
      l: 'L',
      oz: 'OZ',
      lb: 'LB',
    };
    const factor = parseFloat(xNUnit[1]);
    const newUnit = unitMap[xNUnit[2].toLowerCase()];
    const trailing = xNUnit[3].trim();
    const origQty = ing.quantity ?? 1;
    const sizeFragment = `${xNUnit[1]}${xNUnit[2].toLowerCase()}`;
    const noteParts = [
      `${origQty} × ${sizeFragment}`,
      trailing,
    ].filter((s) => s.length > 0);
    return {
      ...ing,
      quantity: origQty * factor,
      unit: newUnit,
      notes: noteParts.join(' '),
    };
  }

  // Bucket 3b: "qt" / "quart" / "quarts" — US quart = 946 ml exact.
  // Standard conversion; any trailing descriptor ("neutral frying") is
  // kept in notes.
  const qt = note.match(/^(?:qt|quart|quarts)\b\s*(.*)$/);
  if (qt) {
    const trailing = qt[1].trim();
    return {
      ...ing,
      quantity: (ing.quantity ?? 1) * 946,
      unit: 'ML',
      notes: trailing.length > 0 ? trailing : null,
    };
  }

  // Bucket 3c: other volume literals (pint / shot / fl oz) genuinely
  // lack a single defensible conversion — keep OTHER.
  if (/\b(?:pint|pints|shot|fl\s*oz)\b/.test(note)) {
    return ing;
  }

  // Bucket 4: everything else — quantity refers to discrete pieces
  return { ...ing, unit: 'PIECE' };
};

// ---------------------------------------------------------------------------
// Difficulty classifier
// ---------------------------------------------------------------------------

/**
 * Units that signal a flavour-only ingredient — these don't count toward the
 * "complexity to prep" axis the score is trying to capture.
 */
const MEANINGFUL_INGREDIENT_EXCLUDED_UNITS: Array<MeasureUnit | null> = [
  'TO_TASTE',
  'TO_SERVE',
  'GARNISH',
];

const countMeaningfulIngredients = (ings: RecipeIngredientRow[]): number =>
  ings.filter(
    (i) => !MEANINGFUL_INGREDIENT_EXCLUDED_UNITS.includes(i.unit ?? null),
  ).length;

/**
 * Composite complexity score: ingredients + 2 × steps. Active steps are
 * weighted twice the ingredient axis because they capture effort, not just
 * shopping list size.
 */
const computeScore = (ingredientCount: number, stepCount: number): number =>
  ingredientCount + 2 * stepCount;

const classifyDifficulty = (score: number, median: number): Difficulty => {
  if (score < median * EASY_THRESHOLD_FRACTION) return 'EASY';
  if (score > median * HARD_THRESHOLD_FRACTION) return 'HARD';
  return 'MEDIUM';
};

// For even-length arrays this picks the upper-median (index n/2 rather than
// averaging the two middle values). Acceptable approximation here — the
// thresholds round into the same bucket for a typical complexity histogram.
const medianOf = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = (): void => {
  console.log('🧹 clean-recipes — Phase 2b: Clean & Enrich Recipes');
  console.log('');

  const snapshot = readJsonFile<RecipesSnapshot>(
    INPUT_FILE,
    'Run fetch-recipes first.',
  );

  console.log(`📁 Loaded ${snapshot.recipes.length} recipes from ${INPUT_FILE}`);
  console.log('');

  // ---- Pass 1: parse steps + compute complexity scores ----------------------
  console.log('🧠 Pass 1: parsing steps + computing complexity scores...');

  const reviewFlagged: ReviewFlag[] = [];

  type Processed = {
    raw: (typeof snapshot.recipes)[number];
    steps: RecipeStepRow[];
    servings: number;
    score: number;
    isFlat: boolean;
    hasReliableServings: boolean;
  };

  let titlesGenerated = 0;
  let titlesPreserved = 0;
  let titlesStillNull = 0;

  const processed: Processed[] = snapshot.recipes.map((r) => {
    const { steps: parsedSteps, isFlat } = parseSteps(r.instructions);

    const steps: RecipeStepRow[] = parsedSteps.map((s) => {
      if (s.title) {
        titlesPreserved++;
        return s;
      }
      const generated = generateTitle(s.content);
      if (generated) {
        titlesGenerated++;
        return { ...s, title: generated };
      }
      titlesStillNull++;
      return s;
    });

    const meaningfulCount = countMeaningfulIngredients(r.ingredients);
    const score = computeScore(meaningfulCount, steps.length);
    const { servings, hasReliableData } = estimateServings(r.ingredients);

    if (isFlat) {
      reviewFlagged.push({
        externalId: r.externalId,
        title: r.title,
        reason: 'flat-instructions',
      });
    }

    return {
      raw: r,
      steps,
      servings,
      score,
      isFlat,
      hasReliableServings: hasReliableData,
    };
  });

  const median = medianOf(processed.map((p) => p.score));

  console.log(`   Median complexity score: ${median}`);
  console.log(
    `   Easy threshold  (<): ${(median * EASY_THRESHOLD_FRACTION).toFixed(2)}`,
  );
  console.log(
    `   Hard threshold  (>): ${(median * HARD_THRESHOLD_FRACTION).toFixed(2)}`,
  );
  console.log('');

  // ---- Pass 2: classify difficulty based on median --------------------------
  console.log('🧠 Pass 2: classifying difficulty...');

  const difficultyDist: Record<Difficulty, number> = {
    EASY: 0,
    MEDIUM: 0,
    HARD: 0,
  };
  const servingsDist: Record<number, number> = {};

  const unitNormalizationDist: Record<string, number> = {
    'OTHER → PIECE': 0,
    'OTHER → TBSP': 0,
    'OTHER → TSP': 0,
    'OTHER → PINCH': 0,
    'OTHER → G': 0,
    'OTHER → KG': 0,
    'OTHER → ML': 0,
    'OTHER → L': 0,
    'OTHER → OZ': 0,
    'OTHER → LB': 0,
    'OTHER kept': 0,
  };

  const cleanRecipes: CleanRecipeRow[] = processed.map((p) => {
    const difficulty = classifyDifficulty(p.score, median);
    difficultyDist[difficulty]++;
    servingsDist[p.servings] = (servingsDist[p.servings] ?? 0) + 1;

    const normalizedIngredients = p.raw.ingredients.map((ing) => {
      if (ing.unit !== 'OTHER' || !ing.notes) return ing;
      const next = normalizeIngredientUnit(ing);
      const bucket =
        next.unit === 'OTHER' ? 'OTHER kept' : `OTHER → ${next.unit}`;
      if (bucket in unitNormalizationDist) unitNormalizationDist[bucket]++;
      else unitNormalizationDist['OTHER kept']++;
      return next;
    });

    return {
      externalId: p.raw.externalId,
      slug: p.raw.slug,
      title: p.raw.title,
      imageUrl: p.raw.imageUrl,
      videoUrl: p.raw.videoUrl,
      sourceUrl: p.raw.sourceUrl,
      categoryExternalId: p.raw.categoryExternalId,
      areaExternalId: p.raw.areaExternalId,
      servings: p.servings,
      difficulty,
      steps: p.steps,
      tags: p.raw.tags,
      ingredients: normalizedIngredients,
    };
  });

  // ---- Stats summary --------------------------------------------------------
  console.log('');
  console.log('📊 Results:');
  console.log(`   Total recipes:            ${cleanRecipes.length}`);
  console.log(`   Review-flagged (flat):    ${reviewFlagged.length}`);
  console.log('');
  console.log('   Step titles:');
  console.log(`     Preserved (from parser): ${titlesPreserved}`);
  console.log(`     Auto-generated:          ${titlesGenerated}`);
  console.log(`     Still null:              ${titlesStillNull}`);
  console.log('');
  console.log('   Ingredient unit normalization (OTHER + notes):');
  for (const [label, count] of Object.entries(unitNormalizationDist)) {
    console.log(`     ${label.padEnd(16)} ${String(count).padStart(4)}`);
  }
  console.log('');
  console.log('   Difficulty distribution:');
  for (const d of ['EASY', 'MEDIUM', 'HARD'] as const) {
    const count = difficultyDist[d];
    const pct = ((count / cleanRecipes.length) * 100).toFixed(1);
    console.log(`     ${d.padEnd(7)} ${String(count).padStart(4)}  (${pct}%)`);
  }
  console.log('');
  console.log('   Servings distribution:');
  for (const s of Object.keys(servingsDist)
    .map(Number)
    .sort((a, b) => a - b)) {
    const count = servingsDist[s];
    const pct = ((count / cleanRecipes.length) * 100).toFixed(1);
    console.log(
      `     ${String(s).padStart(2)} servings: ${String(count).padStart(4)}  (${pct}%)`,
    );
  }
  console.log('');

  if (reviewFlagged.length > 0) {
    console.log(
      '⚠️  Review-flagged recipes (single block, no step separators):',
    );
    for (const f of reviewFlagged) {
      console.log(`     - ${f.externalId}: ${f.title}`);
    }
    console.log('');
  }

  // ---- Write output ---------------------------------------------------------

  // Safety net: parseSteps always emits at least one step (even the
  // flat-fallback path), but the step content can still be the empty
  // string if `cleanProseWhitespace` collapses everything away. Drop
  // any such recipes so the downstream consumers (apply-* scripts,
  // seed) never see a step-less row.
  const usableRecipes = filterUsableRecipes('clean-recipes', cleanRecipes);

  const cleanSnapshot: RecipesCleanSnapshot = {
    fetchedAt: snapshot.fetchedAt,
    cleanedAt: new Date().toISOString(),
    source: snapshot.source,
    stats: {
      total: usableRecipes.length,
      reviewFlagged: reviewFlagged.length,
      medianComplexityScore: median,
      difficultyDistribution: difficultyDist,
      servingsDistribution: servingsDist,
    },
    recipes: usableRecipes,
    reviewFlagged,
  };

  writeJsonFile(OUTPUT_FILE, cleanSnapshot);
  console.log('');
  console.log(
    '👉 Next: run apply-flat-splits to patch flagged recipes, then review clean-recipes.json against the canonical recipes.json before promoting changes.',
  );
};

runMain('clean-recipes', main);
