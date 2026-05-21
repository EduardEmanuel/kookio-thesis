/**
 * fetch-recipes.ts — Phase 2a: Fetch & Transform Recipes
 *
 * Strategy B (Premium):
 *   1. Fetch all meal IDs via list.php?m=list (premium endpoint)
 *   2. Fetch full details for each meal via lookup.php?i={id}
 *   3. Transform to seed-compatible rows
 *   4. Write raw-recipes.json to disk
 *
 * No database interaction — works entirely with local files.
 *
 * Run via: npm run fetch-recipes
 */

import type {
  MeasureUnit,
  RecipeIngredientRow,
  RecipeTagRow,
  RecipeRow,
  RecipesSnapshot,
} from './types.js';
import {
  cleanProseWhitespace,
  normalizeIngredientName,
  runMain,
  sleep,
  themealdbBaseUrl,
  writeJsonFile,
} from './utils.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = themealdbBaseUrl();
const OUTPUT_FILE = 'raw-recipes.json';

// Delay between requests to avoid rate limiting (ms)
const REQUEST_DELAY_MS = 100;

// ---------------------------------------------------------------------------
// TheMealDB response types
// ---------------------------------------------------------------------------

interface TmdbMealSummary {
  idMeal: string;
  strMeal: string;
}

interface TmdbMealDetail {
  idMeal: string;
  strMeal: string;
  strCategory: string | null;
  strArea: string | null;
  strInstructions: string | null;
  strMealThumb: string | null;
  strTags: string | null;
  strYoutube: string | null;
  strSource: string | null;
  [key: string]: string | null | undefined;
}

// ---------------------------------------------------------------------------
// MeasureUnit parser
// ---------------------------------------------------------------------------

const UNIT_MAP: Record<string, MeasureUnit> = {
  g: 'G', grams: 'G', gram: 'G',
  kg: 'KG', kilogram: 'KG', kilograms: 'KG',
  ml: 'ML', milliliter: 'ML', milliliters: 'ML', millilitre: 'ML', millilitres: 'ML',
  l: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
  tsp: 'TSP', 'tea spoon': 'TSP', teaspoon: 'TSP', teaspoons: 'TSP',
  tbsp: 'TBSP', tbs: 'TBSP', 'table spoon': 'TBSP', tablespoon: 'TBSP', tablespoons: 'TBSP',
  cup: 'CUP', cups: 'CUP',
  oz: 'OZ', ounce: 'OZ', ounces: 'OZ',
  lb: 'LB', lbs: 'LB', pound: 'LB', pounds: 'LB',
  piece: 'PIECE', pieces: 'PIECE', pcs: 'PIECE',
  slice: 'SLICE', slices: 'SLICE',
  clove: 'CLOVE', cloves: 'CLOVE',
  bunch: 'BUNCH', bunches: 'BUNCH',
  pinch: 'PINCH', pinches: 'PINCH',
  garnish: 'GARNISH',
  'to taste': 'TO_TASTE',
  'to serve': 'TO_SERVE',
};

const parseMeasure = (
  rawMeasure: string,
): { quantity: number | null; unit: MeasureUnit | null; notes: string | null } => {
  const raw = rawMeasure.trim();
  if (!raw) return { quantity: null, unit: null, notes: null };

  const lowerRaw = raw.toLowerCase();
  if (lowerRaw === 'to taste') return { quantity: null, unit: 'TO_TASTE', notes: null };
  if (lowerRaw === 'to serve') return { quantity: null, unit: 'TO_SERVE', notes: null };
  if (lowerRaw === 'garnish' || lowerRaw === 'for garnish') return { quantity: null, unit: 'GARNISH', notes: null };
  if (lowerRaw === 'pinch' || lowerRaw === 'a pinch') return { quantity: null, unit: 'PINCH', notes: null };

  const match = raw.match(
    /^(\d+(?:[./]\d+)?(?:\s*-\s*\d+(?:[./]\d+)?)?)\s*([a-zA-Z]*)\s*(.*)?$/,
  );

  if (!match) return { quantity: null, unit: null, notes: raw || null };

  let quantity: number | null = null;
  const qRaw = match[1].trim().split('-')[0].trim();
  if (qRaw.includes('/')) {
    const [num, den] = qRaw.split('/').map(Number);
    quantity = den !== 0 ? num / den : null;
  } else {
    const parsed = parseFloat(qRaw);
    quantity = isNaN(parsed) ? null : parsed;
  }

  const unitRaw = (match[2] ?? '').trim().toLowerCase();
  const notesRaw = (match[3] ?? '').trim() || null;
  const unit: MeasureUnit | null = UNIT_MAP[unitRaw] ?? (unitRaw ? 'OTHER' : null);

  const notes =
    unit === 'OTHER' && !notesRaw
      ? unitRaw
      : unit === 'OTHER' && notesRaw
      ? `${unitRaw} ${notesRaw}`.trim()
      : notesRaw;

  return { quantity, unit, notes };
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const fetchAllMealIds = async (): Promise<TmdbMealSummary[]> => {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const all: TmdbMealSummary[] = [];

  for (const letter of letters) {
    const res = await fetch(`${BASE_URL}/search.php?f=${letter}`);
    if (!res.ok) {
      console.warn(`   ⚠️  search.php?f=${letter} returned HTTP ${res.status} — skipping`);
      continue;
    }
    const text = await res.text();
    if (!text.trim()) {
      console.warn(`   ⚠️  search.php?f=${letter} returned empty body — skipping`);
      continue;
    }
    let data: { meals: TmdbMealSummary[] | null };
    try {
      data = JSON.parse(text);
    } catch {
      console.warn(`   ⚠️  search.php?f=${letter} returned non-JSON — skipping`);
      continue;
    }
    const meals = data.meals ?? [];
    all.push(...meals);
    await sleep(REQUEST_DELAY_MS);
  }

  return all;
};

const fetchMealDetail = async (idMeal: string): Promise<TmdbMealDetail | null> => {
  const res = await fetch(`${BASE_URL}/lookup.php?i=${idMeal}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { meals: TmdbMealDetail[] | null };
  return data.meals?.[0] ?? null;
};

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------

const parseTags = (strTags: string | null): RecipeTagRow[] => {
  if (!strTags?.trim()) return [];
  return strTags
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((tag) => ({ tag }));
};

const parseIngredients = (meal: TmdbMealDetail): RecipeIngredientRow[] => {
  const results: RecipeIngredientRow[] = [];
  for (let i = 1; i <= 20; i++) {
    const rawName = (meal[`strIngredient${i}`] ?? '').trim();
    const rawMeasure = (meal[`strMeasure${i}`] ?? '').trim();
    if (!rawName) continue;
    const normalizedName = normalizeIngredientName(rawName);
    if (!normalizedName) continue;
    const { quantity, unit, notes } = parseMeasure(rawMeasure);
    results.push({ ingredientNormalizedName: normalizedName, quantity, unit, notes });
  }
  return results;
};

const transformMeal = (meal: TmdbMealDetail): RecipeRow => ({
  externalId: meal.idMeal,
  slug: meal.idMeal,
  title: meal.strMeal,
  imageUrl: meal.strMealThumb ?? null,
  videoUrl: meal.strYoutube?.trim() || null,
  sourceUrl: meal.strSource?.trim() || null,
  instructions: cleanProseWhitespace(meal.strInstructions) ?? '',
  categoryExternalId: meal.strCategory?.trim() || null,
  areaExternalId: meal.strArea?.trim() || null,
  tags: parseTags(meal.strTags),
  ingredients: parseIngredients(meal),
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  console.log('🚀 fetch-recipes — Phase 2a: Fetch & Transform');
  console.log('');

  console.log('📋 Fetching all meal IDs...');
  const allMeals = await fetchAllMealIds();
  console.log(`   Found ${allMeals.length} meals`);
  console.log('');

  console.log('🍲 Fetching meal details...');
  const recipes: RecipeRow[] = [];
  let skipped = 0;

  for (let i = 0; i < allMeals.length; i++) {
    const summary = allMeals[i];
    const progress = `[${String(i + 1).padStart(4)}/${allMeals.length}]`;
    const detail = await fetchMealDetail(summary.idMeal);

    if (!detail || !detail.strInstructions?.trim()) {
      console.warn(`   ⚠️  ${progress} Skipped "${summary.strMeal}" — no instructions`);
      skipped++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    recipes.push(transformMeal(detail));

    if ((i + 1) % 50 === 0) {
      console.log(`   ${progress} ${recipes.length} recipes collected so far...`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log('');
  console.log('📊 Summary:');
  console.log(`   Total meals found:  ${allMeals.length}`);
  console.log(`   Recipes collected:  ${recipes.length}`);
  console.log(`   Skipped:            ${skipped}`);

  const snapshot: RecipesSnapshot = {
    fetchedAt: new Date().toISOString(),
    source: 'https://www.themealdb.com',
    totalFetched: recipes.length,
    totalSkipped: skipped,
    recipes,
  };

  console.log('');
  writeJsonFile(OUTPUT_FILE, snapshot);
  console.log('');
  console.log('👉 Next: review raw-recipes.json, then run clean-recipes');
};

runMain('fetch-recipes', main);