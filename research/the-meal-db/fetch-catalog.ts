/**
 * fetch-catalog.ts — Phase 1a.1: Fetch & Transform
 *
 * Fetches catalog data from TheMealDB and writes a snapshot to disk.
 * No database interaction.
 *
 * Output: raw-catalog.json
 *
 * Run via: npm run fetch-catalog
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  MealCategoryRow,
  MealAreaRow,
  IngredientCatalogRow,
  CatalogSnapshot,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env['THEMEALDB_API_KEY'];
if (!API_KEY) throw new Error('Missing env var: THEMEALDB_API_KEY');

const BASE_URL = `https://www.themealdb.com/api/json/v2/${API_KEY}`;

const OUTPUT_PATH = path.resolve(import.meta.dirname, 'raw-catalog.json');

// ---------------------------------------------------------------------------
// TheMealDB response types (only fields we consume)
// ---------------------------------------------------------------------------

interface TmdbCategory {
  idCategory: string;
  strCategory: string;
  strCategoryThumb: string;
  strCategoryDescription: string;
}

interface TmdbArea {
  strArea: string;
}

interface TmdbIngredient {
  idIngredient: string;
  strIngredient: string;
  strDescription: string | null;
  strType: string | null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const fetchCategories = async (): Promise<TmdbCategory[]> => {
  const res = await fetch(`${BASE_URL}/categories.php`);
  if (!res.ok) throw new Error(`fetchCategories failed: HTTP ${res.status}`);
  const data = (await res.json()) as { categories: TmdbCategory[] | null };
  return data.categories ?? [];
};

const fetchAreas = async (): Promise<TmdbArea[]> => {
  const res = await fetch(`${BASE_URL}/list.php?a=list`);
  if (!res.ok) throw new Error(`fetchAreas failed: HTTP ${res.status}`);
  const data = (await res.json()) as { meals: TmdbArea[] | null };
  return data.meals ?? [];
};

const fetchIngredients = async (): Promise<TmdbIngredient[]> => {
  const res = await fetch(`${BASE_URL}/list.php?i=list`);
  if (!res.ok) throw new Error(`fetchIngredients failed: HTTP ${res.status}`);
  const data = (await res.json()) as { meals: TmdbIngredient[] | null };
  return data.meals ?? [];
};

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

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
// Transform helpers
// ---------------------------------------------------------------------------

const transformCategories = (raw: TmdbCategory[]): MealCategoryRow[] =>
  raw.map((cat) => ({
    externalId: cat.strCategory,
    name: cat.strCategory,
    imageUrl: cat.strCategoryThumb || null,
    description: cat.strCategoryDescription || null,
  }));

const transformAreas = (raw: TmdbArea[]): MealAreaRow[] =>
  raw.map((area) => ({
    externalId: area.strArea,
    name: area.strArea,
    flag: null,
  }));

const transformIngredients = (raw: TmdbIngredient[]): IngredientCatalogRow[] => {
  const seen = new Set<string>();
  const results: IngredientCatalogRow[] = [];

  for (const ing of raw) {
    const name = ing.strIngredient?.trim();
    if (!name) continue;

    const normalizedName = normalizeIngredientName(name);
    if (!normalizedName) continue;

    if (seen.has(normalizedName)) {
      console.warn(`⚠️  Duplicate skipped: "${normalizedName}" (from "${name}")`);
      continue;
    }
    seen.add(normalizedName);

    results.push({
      externalId: ing.idIngredient,
      name,
      normalizedName,
      description: ing.strDescription?.trim() || null,
      imageUrl: `https://www.themealdb.com/images/ingredients/${encodeURIComponent(name)}-Small.png`,
      category: null,
    });
  }

  return results;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  console.log('🚀 fetch-catalog — Phase 1a.1: Fetch & Transform');
  console.log('');

  console.log('🍽️  Fetching categories...');
  const categories = transformCategories(await fetchCategories());
  console.log(`   ✅ ${categories.length} categories`);

  console.log('🌍  Fetching areas...');
  const areas = transformAreas(await fetchAreas());
  console.log(`   ✅ ${areas.length} areas`);

  console.log('🥕  Fetching ingredients...');
  const ingredients = transformIngredients(await fetchIngredients());
  console.log(`   ✅ ${ingredients.length} ingredients`);

  const snapshot: CatalogSnapshot = {
    fetchedAt: new Date().toISOString(),
    source: 'https://www.themealdb.com',
    categories,
    areas,
    ingredients,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');

  console.log('');
  console.log('📊 Summary:');
  console.log(`   Categories:  ${categories.length}`);
  console.log(`   Areas:       ${areas.length}`);
  console.log(`   Ingredients: ${ingredients.length}`);
  console.log('');
  console.log(`📁 Written to: ${OUTPUT_PATH}`);
  console.log('');
  console.log('👉 Next: review raw-catalog.json, then run clean-catalog');
};

main().catch((err) => {
  console.error('❌ fetch-catalog failed:', err);
  process.exit(1);
});