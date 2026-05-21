/**
 * types.ts — Shared types for TheMealDB fetch/clean scripts.
 *
 * These mirror the Prisma schema from kookio but are defined locally
 * so these scripts can run independently without @prisma/client.
 */

// ---------------------------------------------------------------------------
// Enums (mirror Prisma schema)
// ---------------------------------------------------------------------------

export type IngredientCategory =
  | 'MEAT'
  | 'FISH'
  | 'DAIRY'
  | 'PRODUCE'
  | 'GRAINS'
  | 'LEGUMES'
  | 'SPICES'
  | 'CONDIMENTS'
  | 'HERBS'
  | 'NUTS'
  | 'BEVERAGES'
  | 'SWEETS'
  | 'OTHER';

export type MeasureUnit =
  | 'G'
  | 'KG'
  | 'ML'
  | 'L'
  | 'TSP'
  | 'TBSP'
  | 'CUP'
  | 'OZ'
  | 'LB'
  | 'PIECE'
  | 'SLICE'
  | 'CLOVE'
  | 'BUNCH'
  | 'PINCH'
  | 'TO_TASTE'
  | 'TO_SERVE'
  | 'GARNISH'
  | 'OTHER';

// ---------------------------------------------------------------------------
// Catalog snapshot types (output of fetch-catalog, input of clean-catalog)
// ---------------------------------------------------------------------------

export interface MealCategoryRow {
  externalId: string;
  name: string;
  imageUrl: string | null;
  description: string | null;
}

export interface MealAreaRow {
  externalId: string;
  name: string;
  flag: null;
}

export interface IngredientCatalogRow {
  externalId: string;
  name: string;
  normalizedName: string;
  description: string | null;
  imageUrl: string;
  category: IngredientCategory | null;
}

export interface CatalogSnapshot {
  fetchedAt: string;
  source: string;
  categories: MealCategoryRow[];
  areas: MealAreaRow[];
  ingredients: IngredientCatalogRow[];
}

// ---------------------------------------------------------------------------
// Recipes snapshot types (output of fetch-recipes)
// ---------------------------------------------------------------------------

export interface RecipeIngredientRow {
  ingredientNormalizedName: string;
  quantity: number | null;
  unit: MeasureUnit | null;
  notes: string | null;
}

export interface RecipeTagRow {
  tag: string;
}

export interface RecipeRow {
  externalId: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  videoUrl: string | null;
  sourceUrl: string | null;
  instructions: string;
  categoryExternalId: string | null;
  areaExternalId: string | null;
  tags: RecipeTagRow[];
  ingredients: RecipeIngredientRow[];
}

export interface RecipesSnapshot {
  fetchedAt: string;
  source: string;
  totalFetched: number;
  totalSkipped: number;
  recipes: RecipeRow[];
}

// ---------------------------------------------------------------------------
// Clean recipes snapshot (output of clean-recipes)
// ---------------------------------------------------------------------------

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface RecipeStepRow {
  order: number;
  title: string | null;
  content: string;
}

export interface CleanRecipeRow {
  externalId: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  videoUrl: string | null;
  sourceUrl: string | null;
  categoryExternalId: string | null;
  areaExternalId: string | null;
  servings: number;
  difficulty: Difficulty | null;
  steps: RecipeStepRow[];
  tags: RecipeTagRow[];
  ingredients: RecipeIngredientRow[];
}

export interface ReviewFlag {
  externalId: string;
  title: string;
  reason: 'flat-instructions' | 'low-servings-confidence';
}

export interface RecipesCleanSnapshot {
  fetchedAt: string;
  cleanedAt: string;
  source: string;
  stats: {
    total: number;
    reviewFlagged: number;
    medianComplexityScore: number;
    difficultyDistribution: Record<Difficulty, number>;
    servingsDistribution: Record<number, number>;
  };
  recipes: CleanRecipeRow[];
  reviewFlagged: ReviewFlag[];
}

// ---------------------------------------------------------------------------
// Merge candidates (merge-candidates.json)
// ---------------------------------------------------------------------------

export interface MergeCandidate {
  plural: string;
  pluralName: string;
  singular: string;
  action: 'MERGE' | 'RENAME';
  approve: boolean | null;
  note: string;
}

export interface MergeCandidatesFile {
  generatedAt: string;
  legend: Record<string, string>;
  candidates: MergeCandidate[];
}