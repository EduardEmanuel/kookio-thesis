/**
 * fetch-recipes.ts — Phase 2a: Fetch & Transform Recipes
 *
 * Strategy B (Premium):
 *   1. Fetch all meal IDs via list.php?m=list (premium endpoint)
 *   2. Fetch full details for each meal via lookup.php?i={id}
 *   3. Transform to seed-compatible rows
 *   4. Write recipes.json to disk
 *
 * No database interaction — works entirely with local files.
 *
 * Run via: npm run fetch-recipes
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  MeasureUnit,
  RecipeIngredientRow,
  RecipeTagRow,
  RecipeRow,
  RecipesSnapshot,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env['THEMEALDB_API_KEY'];
if (!API_KEY) throw new Error('Missing env var: THEMEALDB_API_KEY');

const BASE_URL = `https://www.themealdb.com/api/json/v2/${API_KEY}`;

// Delay between requests to avoid rate limiting (ms)
const REQUEST_DELAY_MS = 100;

const OUTPUT_PATH = path.resolve(import.meta.dirname, 'recipes.json');

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
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const normalizeIngredientName = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/ă/g, 'a')
    .replace(/î/g, 'i')
    .replace(/ș/g, 's')
    .replace(/ț/g, 't')
    .replace(/ñ/g, 'n')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');

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

const cleanInstructions = (raw: string | null): string | null => {
  if (!raw) return null;
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
};

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
  youtubeUrl: meal.strYoutube?.trim() || null,
  sourceUrl: meal.strSource?.trim() || null,
  instructions: cleanInstructions(meal.strInstructions) ?? '',
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

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');

  console.log('');
  console.log(`📁 Written to: ${OUTPUT_PATH}`);
  console.log('');
  console.log('👉 Next: review recipes.json, then copy to kookio seed-data/');
};

main().catch((err) => {
  console.error('❌ fetch-recipes failed:', err);
  process.exit(1);
});