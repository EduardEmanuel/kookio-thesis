/**
 * apply-residual-fixes.ts — Phase 2e residual cleanup
 *
 * Applies a deterministic battery of mechanical fixes against the
 * canonical recipes.json + catalog.json, in order:
 *
 *   1. Rewrite plural ingredient names in recipes to the singular form
 *      already present in the catalog (per merge-candidates.json).
 *   2. Add gruyere_cheese to the ingredient catalog (one recipe references
 *      it, no merge candidate maps to it).
 *   3. Rename the misspelled tags "desert" -> "dessert",
 *      "cheasy" -> "cheesy", "haloween" -> "halloween".
 *   4. Split embedded numbered sub-steps in three recipes (52829, 52967,
 *      52805) into their natural separate steps.
 *   5. Deduplicate ingredient entries within each recipe so the schema's
 *      @@unique([recipeId, ingredientCatalogId]) constraint can hold.
 *   6. Regenerate slugs from titles (kebab-case, diacritics stripped) so
 *      URLs are human-readable instead of numeric externalIds.
 *   7. Normalize curly apostrophes (U+2019), curly single/double
 *      quotes (U+2018/201C/201D), fraction slash (U+2044) to ASCII
 *      equivalents; drop decorative smiley (U+263A); replace single
 *      right angle quote (U+203A) used as a list separator with " · ";
 *      collapse runs of internal spaces to one.
 *   8. Drop the orphan "Serves 2" metadata step in recipe 52994; the
 *      servings count lives on Recipe.servings, not as a step.
 *   9. Parse Unicode-fraction quantities from ingredient notes
 *      ("½ tsp" -> quantity: 0.5, unit: TSP) for entries where the
 *      upstream measure parser dropped on the fraction character.
 *  10. Map flavor-phrase notes to MeasureUnit values: "sprinkling" /
 *      "splash" / "as required" -> TO_TASTE; "garnish" / "to serve" ->
 *      TO_SERVE; "juice/zest of N" -> quantity N + unit PIECE.
 *  11. Title-case the two all-lowercase recipe titles (kabse,
 *      kofta burgers).
 *  12. Restore four video URLs that an earlier nullify-non-YouTube pass
 *      discarded from the (then-named) youtubeUrl field. After the
 *      field was generalised to videoUrl, any host is acceptable, so
 *      the originals are re-inserted from a hardcoded map.
 *  13. Rewrite step titles that were truncated by the upstream splitter
 *      (e.g. "Bake in the preheated" -> "Bake until tender") using a
 *      static map keyed by {externalId, order}.
 *  13.5 Restore 25 recipes whose step lists were broken or
 *      underspilt across several distinct failure modes:
 *        - 53188, 53354, 53187, 53075 — damaged by an earlier
 *          idempotency bug in step 14 below (real instructions lost).
 *        - 53131, 53124 — upstream `instructions` used the U+25A2
 *          empty-checkbox ▢ as a between-step divider and were never
 *          split by Phase 2d.
 *        - 52784 — hybrid recipe with a main dish and a cashew sour
 *          cream sub-recipe; step 2 is a deliberate ingredient-list
 *          anchor for the sub-recipe.
 *        - Tier 1 (10 recipes): 53138, 53133, 53141, 53136, 53137,
 *          53134, 53139, 53146, 53140, 53135 — uniform shape where
 *          step 1 packs all cooking instructions as "Header: ..."
 *          lines with a trailing "Pro Tips:" label, and step 2+
 *          carries the bullet-style tips. Split step 1 on section
 *          labels and consolidate tips into one closing step.
 *        - Tier 2 (4 recipes): 52812, 52938, 53352, 52820 — variably
 *          labeled / numbered sub-instructions packed into 1-2
 *          oversized steps. 52820's stale metadata step is dropped.
 *        - Tier 3 (4 recipes): 53027, 53029, 53054, 53325 —
 *          multi-paragraph steps with no consistent labels;
 *          paragraphs split into discrete steps. 53325's image-
 *          caption noise ("arepa making") and 53027's section-header
 *          step ("Make the crispy onion topping.") dropped.
 *      Reconstructed step lists are hardcoded in
 *      DAMAGED_RECIPES_RESTORE, derived from the original content in
 *      Phase-2d house style.
 *  14. Remove eight section-header steps (title == content, short, no
 *      terminator) that survived the splitter as glorified dividers;
 *      re-number the surviving steps in the affected recipes. Matched
 *      by content equality, not by order, so the pass is idempotent
 *      across consecutive runs.
 *  15. Trim leading/trailing whitespace on recipe titles.
 *  16. Strip zero-width spaces (U+200B) from step content.
 *  17. Strip leading punctuation (. , ; : - – —) followed by space
 *      from step content.
 *  18. Parse measures carried in ingredient notes when quantity is
 *      set but unit is null ("½ tbsp", "1/2 cup", "(400g) tin",
 *      "Juice of 1", etc.) and override the stale quantity with the
 *      parsed value; clear dedup leftovers like "plus 1" /
 *      "plus TO_TASTE" that carry no useful information.
 *  19. Default integer-quantity countable ingredients with null unit
 *      and null notes to PIECE (or CLOVE for garlic_clove).
 *  20. Reclassify `difficulty` against the post-restoration median.
 *      Replays the original clean-recipes formula
 *      (`ingredients + 2 × steps`, flavor-only units excluded) on the
 *      current step counts and refreshes `stats.medianComplexityScore`
 *      + `stats.difficultyDistribution`.
 *
 * Each pass is idempotent — re-running on already-fixed data is a
 * no-op and prints zeros for every counter.
 *
 * Run via: npx tsx apply-residual-fixes.ts (or `npm run apply-residual-fixes`)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RECIPES_FILE = path.join(HERE, 'recipes.json');
const CATALOG_FILE = path.join(HERE, 'catalog.json');
const MERGE_FILE = path.join(HERE, 'merge-candidates.json');

interface Step {
  order: number;
  title: string;
  content: string;
}

interface RecipeIngredient {
  ingredientExternalId?: string;
  ingredientNormalizedName?: string;
  quantity?: number;
  unit?: string;
  notes?: string | null;
}

interface Recipe {
  externalId: string;
  title: string;
  slug: string;
  steps: Step[];
  ingredients: RecipeIngredient[];
  tags?: Array<{ tag: string } | string>;
  [k: string]: unknown;
}

interface CatalogIngredient {
  externalId: string;
  name: string;
  normalizedName: string;
  description: string;
  imageUrl: string | null;
  category: string;
}

interface Catalog {
  ingredients: CatalogIngredient[];
  [k: string]: unknown;
}

interface MergeCandidate {
  plural: string;
  pluralName: string;
  singular: string;
  action: 'MERGE' | 'RENAME';
  approve: boolean;
  note: string;
}

const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;
const writeJson = (p: string, obj: unknown): void => {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
};

// ---------------------------------------------------------------------------
// 1. Plural -> singular rewrite for recipes.ingredients[].ingredientNormalizedName
// ---------------------------------------------------------------------------

const rewriteIngredientNames = (recipes: Recipe[], merges: MergeCandidate[]): number => {
  const pluralToSingular = new Map<string, string>();
  for (const c of merges) {
    if (c.approve) pluralToSingular.set(c.plural, c.singular);
  }
  let rewrites = 0;
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      const cur = ing.ingredientNormalizedName;
      if (cur && pluralToSingular.has(cur)) {
        ing.ingredientNormalizedName = pluralToSingular.get(cur);
        rewrites++;
      }
    }
  }
  return rewrites;
};

// ---------------------------------------------------------------------------
// 2. Add gruyere_cheese to catalog
// ---------------------------------------------------------------------------

const addGruyereCheese = (catalog: Catalog): boolean => {
  if (catalog.ingredients.some((i) => i.normalizedName === 'gruyere_cheese')) {
    return false;
  }
  const maxId = catalog.ingredients
    .map((i) => Number(i.externalId))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  catalog.ingredients.push({
    externalId: String(maxId + 1),
    name: 'Gruyere Cheese',
    normalizedName: 'gruyere_cheese',
    description:
      'Gruyère is a hard yellow Swiss cheese, originating from the cantons of Fribourg, Vaud, Neuchâtel, Jura, and Bern. Made from cow’s milk, it is sweet but slightly salty, with a flavor that varies widely with age. It is often described as creamy and nutty when young, becoming earthier, more assertive, and complex as it matures. Gruyère melts smoothly without becoming greasy, which makes it the canonical cheese for fondue, French onion soup, croque-monsieur, and gratin dishes.',
    imageUrl: 'https://www.themealdb.com/images/ingredients/Gruyere%20Cheese-Small.png',
    category: 'DAIRY',
  });
  return true;
};

// ---------------------------------------------------------------------------
// 3. desert -> dessert tag rename
// ---------------------------------------------------------------------------

const renameDesertTag = (recipes: Recipe[]): number => {
  let renames = 0;
  for (const r of recipes) {
    if (!r.tags) continue;
    for (let i = 0; i < r.tags.length; i++) {
      const t = r.tags[i];
      const tagValue = typeof t === 'string' ? t : t.tag;
      if (tagValue === 'desert') {
        if (typeof t === 'string') {
          r.tags[i] = 'dessert';
        } else {
          t.tag = 'dessert';
        }
        renames++;
      }
    }
  }
  return renames;
};

// ---------------------------------------------------------------------------
// 3b. Rename other misspelled tags (cheasy -> cheesy, haloween -> halloween)
// ---------------------------------------------------------------------------
//
// TheMealDB tag vocabulary is crowd-sourced and carries several typos
// that surface in real recipes. The corrected forms already exist in
// the vocabulary, so renames merge into the canonical bucket.

const TAG_TYPO_FIXES: Record<string, string> = {
  cheasy: 'cheesy',
  haloween: 'halloween',
};

const renameMisspelledTags = (recipes: Recipe[]): number => {
  let renames = 0;
  for (const r of recipes) {
    if (!r.tags) continue;
    for (let i = 0; i < r.tags.length; i++) {
      const t = r.tags[i];
      const tagValue = typeof t === 'string' ? t : t.tag;
      const fixed = TAG_TYPO_FIXES[tagValue];
      if (fixed) {
        if (typeof t === 'string') r.tags[i] = fixed;
        else t.tag = fixed;
        renames++;
      }
    }
  }
  return renames;
};

// ---------------------------------------------------------------------------
// 4. Split embedded numbered sub-steps
// ---------------------------------------------------------------------------

interface StepRewrite {
  externalId: string;
  newSteps: Array<{ title: string; content: string }>;
}

const STEP_REWRITES: StepRewrite[] = [
  {
    externalId: '52829',
    newSteps: [
      {
        title: 'Boil pasta until al dente',
        content:
          'Bring a medium saucepan of generously salted water (you want it to taste like seawater) to a boil. Add the pasta and cook, stirring occasionally, until al dente, 8 to 10 minutes, or according to the package directions. The pasta should be tender but still chewy.',
      },
      {
        title: 'Whisk together the flour mixture',
        content:
          'While the pasta is cooking, in a small bowl, whisk together the flour, mustard powder, garlic powder, salt, black pepper, and cayenne pepper.',
      },
      {
        title: 'Make the roux',
        content:
          'Drain the pasta in a colander. Place the empty pasta pan (no need to wash it) over low heat and add the butter. When the butter has melted, whisk in the flour mixture and continue to cook, whisking frequently, until the mixture is beginning to brown and has a pleasant, nutty aroma, about 1 minute. Watch carefully so it does not scorch on the bottom of the pan.',
      },
      {
        title: 'Make the cheese sauce',
        content:
          'Slowly whisk the milk and cream into the flour mixture until everything is really well combined. Cook, whisking constantly, until the sauce is heated through and just begins to thicken, about 2 minutes. Remove from the heat. Gradually add the cheese while stirring constantly with a wooden spoon or silicone spatula and keep stirring until the cheese has melted into the sauce. Then stir in the drained cooked pasta.',
      },
      {
        title: 'Chill the mac and cheese',
        content:
          'Line a 9-by-13-inch (23-by-33-centimeter) rimmed baking sheet with parchment paper or aluminum foil. Coat the paper or foil with nonstick cooking spray or slick it with butter. Pour the warm mac and cheese onto the prepared baking sheet and spread it evenly with a spatula. Coat another piece of parchment paper with cooking spray or butter and place it, oiled or buttered side down, directly on the surface of the mac and cheese. Refrigerate until cool and firm, about 1 hour.',
      },
      {
        title: 'Heat the skillet',
        content: 'Heat a large cast-iron or nonstick skillet over medium-low heat.',
      },
      {
        title: 'Mix the garlic butter',
        content:
          'In a small bowl, stir together the 4 tablespoons (55 grams) butter and garlic powder until well blended.',
      },
      {
        title: 'Cut the chilled mac and cheese',
        content:
          'Remove the mac and cheese from the refrigerator and peel off the top layer of parchment paper. Carefully cut into 8 equal pieces. Each piece will make 1 grilled mac and cheese sandwich. (You can stash each individual portion in a double layer of resealable plastic bags and refrigerate for up to 3 days or freeze it for up to 1 month.)',
      },
      {
        title: 'Assemble the sandwiches',
        content:
          'Spread 3/4 teaspoon garlic butter on one side of each bread slice. Place half of the slices, buttered-side down, on a clean cutting board. Top each with one slice of Cheddar, then 1 piece of the mac and cheese. (Transfer from the baking sheet by scooting your hand or a spatula under each piece of mac and cheese and then flipping it over onto a sandwich.) Place 1 slice of Jack on top of each. Finish with the remaining bread slices, buttered-side up.',
      },
      {
        title: 'Pan-fry the sandwiches',
        content:
          'Using a wide spatula, place as many sandwiches in the pan as will fit without crowding it. Cover and cook until the bottoms are nicely browned, about 4 minutes. Turn and cook until the second sides are browned, the cheese is melted, and the mac and cheese is heated through, about 4 minutes more.',
      },
      {
        title: 'Repeat and serve',
        content:
          'Repeat with the remaining ingredients. Cut the sandwiches in half, if desired, and serve.',
      },
    ],
  },
  {
    externalId: '52967',
    newSteps: [
      {
        title: 'Recipe notes and substitutions',
        content:
          'This is one recipe a lot of people have requested and I have tried to make it as simple as possible and I hope it will work for you. Make sure you use the right flour which is basically one with raising agents. Adjust the amount of sugar to your taste and try using different flavours to have variety whenever you have them. You can use coconut milk instead of regular milk, you can also add desiccated coconut to the dry flour or other spices like powdered cloves or cinnamon. For "healthy looking" mandazis do not roll the dough too thin before frying and use the procedure indicated below.',
      },
      {
        title: 'Whisk egg into the milk',
        content: 'In a separate bowl whisk the egg into the milk.',
      },
      {
        title: 'Make a well and mix the dough',
        content:
          'Make a well at the centre of the flour and add the milk and egg mixture and slowly mix to form a dough.',
      },
      {
        title: 'Knead the dough until smooth',
        content:
          'Knead the dough for 3-4 minutes or until it stops sticking to the sides of the bowl and you have a smooth surface.',
      },
      {
        title: 'Rest the dough',
        content: 'Cover the dough with a damp cloth and allow to rest for 15 minutes.',
      },
      {
        title: 'Roll out the dough',
        content: 'Roll the dough on a lightly floured surface into a 1cm thick piece.',
      },
      {
        title: 'Cut into pieces',
        content:
          'Using a sharp small knife, cut the dough into the desired size, setting aside ready for deep frying.',
      },
      {
        title: 'Deep fry the mandazi',
        content:
          'Heat your oil in a suitable pot and gently dip the mandazi pieces to cook until light brown on the first side, then turn to cook on the second side.',
      },
      {
        title: 'Serve warm or cold',
        content: 'Serve them warm or cold.',
      },
    ],
  },
  {
    externalId: '52805',
    newSteps: [
      // Steps 1-7 are unchanged; only step 8 is split. We re-emit the full
      // sequence so the rewrite is fully deterministic and idempotent.
      {
        title: 'Grind the cashew poppy',
        content:
          'Grind the cashew, poppy seeds and cumin seeds into a smooth paste, using as little water as possible. Set aside.',
      },
      {
        title: 'Fry the sliced onions',
        content:
          'Deep fry the sliced onions when it is hot. Don’t overcrowd the oil. When the onions turn light brown, remove from oil and drain on paper towel. The fried onion will crisp up as it drains. Also fry the cashewnuts till golden brown. Set aside.',
      },
      {
        title: 'Wash the rice',
        content:
          'Wash the rice and soak in water for twenty minutes. Meanwhile, take a big wide pan, add oil in medium heat, add the sliced onions, add the blended paste, to it add the green chillies, ginger garlic paste and garlic and fry for a minute. Then add the tomatoes and sauté them well till they are cooked and not mushy.',
      },
      {
        title: 'Add the red chilli',
        content:
          'Then to it add the red chilli powder, biryani powder, mint, coriander leaves and sauté them well. Add the yogurt and mix well. I always move the skillet away from the heat when adding yogurt which prevents it from curdling.',
      },
      {
        title: 'Add the washed lamb',
        content:
          'Now after returning the skillet back to the stove, add the washed lamb and salt and ½ cup water and mix well. Cook for 1 hour and cook it covered in medium low heat or put it in a pressure cooker for 6 whistles. If the water is not drained totally, heat it by keeping it open.',
      },
      {
        title: 'Boil the rice separately',
        content:
          'Take another big pan, add thrice the cup of rice you use, and boil it. When it is boiling high, add the rice, salt and jeera and mix well. After 7 minutes exact or when the rice is 80% done. Switch off and drain the rice.',
      },
      {
        title: 'Prepare the lamb and rice',
        content:
          'Now, the layering starts. To the lamb, pat and level it. Add the drained hot rice on the top of it. Garnish with fried onions, ghee, mint, coriander leaves and saffron dissolved in milk.',
      },
      {
        title: 'Cover and bake',
        content:
          'Cover the dish and bake in a 350F oven for 15 minutes or till cooked but not mushy. Or cook on the stove medium heat for 12 minutes and lowest heat for 5 minutes. Switch off, mix and serve hot.',
      },
      {
        title: 'Tips and substitutions',
        content:
          'If cooking in the oven, make sure to use a big oven-safe pan, cover it tight, and keep it in the oven for the final step. You can skip biryani masala if you don’t have it and add just garam masala (1 tsp and red chilli powder – 3 tsp instead of 1 tsp). If it is spicy in the end, squeeze some lemon — it will reduce the heat and enhance the flavors.',
      },
    ],
  },
];

const applyStepRewrites = (recipes: Recipe[]): number => {
  let recipesRewritten = 0;
  for (const rw of STEP_REWRITES) {
    const r = recipes.find((x) => x.externalId === rw.externalId);
    if (!r) throw new Error(`Recipe ${rw.externalId} not found`);
    // Idempotency check: skip if step count already matches and titles are
    // already the new ones (rough match on the first new title).
    if (
      r.steps.length === rw.newSteps.length &&
      r.steps[0].title === rw.newSteps[0].title
    ) {
      continue;
    }
    r.steps = rw.newSteps.map((s, i) => ({
      order: i + 1,
      title: s.title,
      content: s.content,
    }));
    recipesRewritten++;
  }
  return recipesRewritten;
};

// ---------------------------------------------------------------------------
// 5. Deduplicate ingredients within each recipe
// ---------------------------------------------------------------------------
//
// The schema enforces @@unique([recipeId, ingredientCatalogId]). Several
// upstream recipes list the same ingredient twice — e.g. Battenberg Cake
// uses each base ingredient once per coloured half, and many savoury
// recipes have a bulk measure plus a "to taste" finishing entry for the
// same item. Without merging, seed time fails on the unique constraint.
//
// Strategy:
//   - Group entries by ingredientNormalizedName within a recipe.
//   - Singleton groups pass through unchanged.
//   - For multi-entry groups, pick the member with the strongest signal
//     (non-null quantity AND non-flavor unit > non-null quantity > first)
//     as the canonical entry. If every member shares the same unit, sum
//     quantities into it. Append all non-empty notes from the other
//     members (de-duplicated, joined with "; ") to preserve original
//     context. Quantities from members with a different unit are folded
//     into the notes too (e.g. "plus 2 TBSP") so no information is lost,
//     but no automatic unit conversion is attempted — the recipe stays
//     seedable and the inflight measure information is recoverable by a
//     reader.

const FLAVOR_UNITS = new Set(['TO_TASTE', 'TO_SERVE', 'GARNISH', 'PINCH']);

const ingredientPriority = (ing: RecipeIngredient): number => {
  const hasQty = ing.quantity != null && ing.quantity > 0;
  const hasUnit = !!ing.unit;
  const isFlavor = FLAVOR_UNITS.has(ing.unit ?? '');
  if (hasQty && hasUnit && !isFlavor) return 3;
  if (hasQty && hasUnit) return 2;
  if (hasQty) return 1;
  return 0;
};

const describeMeasure = (ing: RecipeIngredient): string => {
  if (ing.quantity != null && ing.unit) return `${ing.quantity} ${ing.unit}`;
  if (ing.quantity != null) return `${ing.quantity}`;
  if (ing.unit) return ing.unit;
  return '';
};

const mergeNotes = (notesList: Array<string | null | undefined>): string | null => {
  const cleaned: string[] = [];
  for (const n of notesList) {
    if (!n) continue;
    const trimmed = n.trim();
    if (!trimmed) continue;
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
  }
  return cleaned.length === 0 ? null : cleaned.join('; ');
};

const dedupRecipeIngredients = (recipes: Recipe[]): number => {
  let merged = 0;
  for (const r of recipes) {
    const groups = new Map<string, RecipeIngredient[]>();
    const order: string[] = [];
    for (const ing of r.ingredients) {
      const key = ing.ingredientNormalizedName ?? '';
      if (!key) continue;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(ing);
    }

    const out: RecipeIngredient[] = [];
    for (const key of order) {
      const members = groups.get(key)!;
      if (members.length === 1) {
        out.push(members[0]);
        continue;
      }
      merged += members.length - 1;

      // Canonical entry: highest priority, stable on ties.
      let canonical = members[0];
      let canonicalPriority = ingredientPriority(canonical);
      for (let i = 1; i < members.length; i++) {
        const p = ingredientPriority(members[i]);
        if (p > canonicalPriority) {
          canonical = members[i];
          canonicalPriority = p;
        }
      }

      const canonicalUnit = canonical.unit ?? null;
      const sameUnit = members.every((m) => (m.unit ?? null) === canonicalUnit);

      const notesParts: Array<string | null | undefined> = [];
      let summedQty = canonical.quantity ?? null;

      if (sameUnit && canonicalUnit !== null && members.every((m) => m.quantity != null)) {
        // Pure sum case: same unit, every member has a quantity.
        summedQty = members.reduce((acc, m) => acc + (m.quantity ?? 0), 0);
        for (const m of members) notesParts.push(m.notes ?? null);
      } else {
        // Mixed shape: keep canonical's measure, fold the other members'
        // measure descriptions into notes so nothing is lost.
        notesParts.push(canonical.notes ?? null);
        for (const m of members) {
          if (m === canonical) continue;
          const measure = describeMeasure(m);
          if (measure) notesParts.push(`plus ${measure}`);
          if (m.notes) notesParts.push(m.notes);
        }
      }

      out.push({
        ingredientNormalizedName: key,
        quantity: summedQty,
        unit: canonicalUnit ?? undefined,
        notes: mergeNotes(notesParts),
      });
    }

    if (merged > 0 || out.length !== r.ingredients.length) {
      r.ingredients = out;
    }
  }
  return merged;
};

// ---------------------------------------------------------------------------
// 6. Regenerate slugs from titles
// ---------------------------------------------------------------------------
//
// The upstream pipeline stored externalId in the slug column, so URLs
// like /recipes/53262 are unreadable. We regenerate the slug from the
// title (NFD-strip diacritics, lowercase, kebab-case) and disambiguate
// collisions with a numeric suffix. Cross-recipe titles are unique at
// the time of writing, but the disambiguation logic stays in case a
// future Phase 2d edit introduces a clash.

// Latin-extended characters that NFD does not decompose to a base letter
// (æ stays æ after NFD, etc.). Mapping them explicitly keeps the slug
// readable for the Scandinavian / Slavic recipes in the dataset.
const LATIN_EXTRA: Record<string, string> = {
  æ: 'ae', Æ: 'ae',
  œ: 'oe', Œ: 'oe',
  ø: 'o', Ø: 'o',
  ß: 'ss',
  đ: 'd', Đ: 'd',
  ð: 'd', Ð: 'd',
  ł: 'l', Ł: 'l',
  þ: 'th', Þ: 'th',
};

const titleToSlug = (title: string): string => {
  let result = '';
  for (const ch of title) {
    result += LATIN_EXTRA[ch] ?? ch;
  }
  // Strip apostrophes ("Tom's" → "Toms") then map every other punctuation
  // to a single space; remove combining marks (ă → a, ș → s).
  result = result
    .replace(/['’`]/g, '')
    .replace(/[–—_/\\&]/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return result
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const regenerateSlugs = (recipes: Recipe[]): number => {
  // First pass: assign a candidate slug per recipe.
  const candidate = recipes.map((r) => ({ recipe: r, slug: titleToSlug(r.title) }));

  // Disambiguate collisions deterministically by sorting on externalId
  // — the first recipe (lowest externalId) keeps the bare slug, later
  // ones get "-2", "-3", etc. Sorting by externalId means the assignment
  // doesn't depend on the recipes' position in the JSON.
  const byBase = new Map<string, typeof candidate>();
  for (const c of candidate) {
    if (!byBase.has(c.slug)) byBase.set(c.slug, []);
    byBase.get(c.slug)!.push(c);
  }
  for (const [, group] of byBase) {
    if (group.length === 1) continue;
    group.sort((a, b) => a.recipe.externalId.localeCompare(b.recipe.externalId));
    for (let i = 1; i < group.length; i++) {
      group[i].slug = `${group[i].slug}-${i + 1}`;
    }
  }

  let changed = 0;
  for (const c of candidate) {
    if (c.recipe.slug !== c.slug) {
      c.recipe.slug = c.slug;
      changed++;
    }
  }
  return changed;
};

// ---------------------------------------------------------------------------
// 7. Normalize step content whitespace + apostrophes
// ---------------------------------------------------------------------------

const normalizeStepContent = (recipes: Recipe[]): {
  aposFixed: number;
  doubleSpacedFixed: number;
  curlyQuotesFixed: number;
  fractionSlashFixed: number;
  smileyDropped: number;
  angleQuoteReplaced: number;
} => {
  const stats = {
    aposFixed: 0,
    doubleSpacedFixed: 0,
    curlyQuotesFixed: 0,
    fractionSlashFixed: 0,
    smileyDropped: 0,
    angleQuoteReplaced: 0,
  };
  for (const r of recipes) {
    for (const s of r.steps) {
      const original = s.content;
      let next = original;
      // Curly right single quote (apostrophe) -> straight.
      if (/’/.test(next)) {
        next = next.replace(/’/g, "'");
        stats.aposFixed++;
      }
      // Curly left single quote — also normalise to straight ASCII.
      // Curly double quotes — normalise to straight ASCII.
      if (/[‘“”]/.test(next)) {
        next = next.replace(/‘/g, "'").replace(/[“”]/g, '"');
        stats.curlyQuotesFixed++;
      }
      // Unicode fraction slash (U+2044) vs regular slash — recipes
      // mix "1⁄2" and "1/2"; normalise to the latter for grep-ability.
      if (/⁄/.test(next)) {
        next = next.replace(/⁄/g, '/');
        stats.fractionSlashFixed++;
      }
      // Decorative smiley (U+263A) — drop along with any leading space.
      if (/☺/.test(next)) {
        next = next.replace(/\s*☺/g, '');
        stats.smileyDropped++;
      }
      // Single right angle quote (U+203A) used as a list separator in
      // a metadata line ("Prep:15min › Cook:30min › Ready in:45min")
      // — normalise to " · " so the line still scans.
      if (/›/.test(next)) {
        next = next.replace(/\s*›\s*/g, ' · ');
        stats.angleQuoteReplaced++;
      }
      if (/ {2,}/.test(next)) {
        next = next.replace(/ {2,}/g, ' ');
        stats.doubleSpacedFixed++;
      }
      if (next !== original) s.content = next;
    }
  }
  return stats;
};

// ---------------------------------------------------------------------------
// 8. Drop the orphan "Serves 2" metadata step in recipe 52994
// ---------------------------------------------------------------------------

const dropServesMetadataStep = (recipes: Recipe[]): boolean => {
  const r = recipes.find((x) => x.externalId === '52994');
  if (!r) return false;
  const before = r.steps.length;
  r.steps = r.steps.filter((s) => !/^serves\s+\d+\.?$/i.test((s.content || '').trim()));
  if (r.steps.length === before) return false;
  r.steps.forEach((s, i) => (s.order = i + 1));
  return true;
};

// ---------------------------------------------------------------------------
// 9. Parse Unicode-fraction quantities from ingredient notes
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,  // ½
  '¼': 0.25, // ¼
  '¾': 0.75, // ¾
  '⅓': 1 / 3, // ⅓
  '⅔': 2 / 3, // ⅔
  '⅛': 0.125, // ⅛
  '⅜': 0.375, // ⅜
  '⅝': 0.625, // ⅝
  '⅞': 0.875, // ⅞
};

const UNIT_FROM_WORD: Record<string, string> = {
  teaspoon: 'TSP', teaspoons: 'TSP', tsp: 'TSP',
  tablespoon: 'TBSP', tablespoons: 'TBSP', tbsp: 'TBSP',
  cup: 'CUP', cups: 'CUP',
  ml: 'ML', milliliter: 'ML', milliliters: 'ML', millilitre: 'ML', millilitres: 'ML',
  g: 'G', gram: 'G', grams: 'G',
  kg: 'KG', kilogram: 'KG', kilograms: 'KG',
  oz: 'OZ', ounce: 'OZ', ounces: 'OZ',
  lb: 'LB', pound: 'LB', pounds: 'LB',
  l: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
};

// Match "½ tsp", "½ cup", and "½ tsp ground" / "½ cup freshly grated"
// — optional trailing qualifier is captured and re-emitted as `notes`.
const FRACTION_RE = new RegExp(
  `^([${Object.keys(UNICODE_FRACTIONS).join('')}])\\s*([a-z]+)(?:\\s+(.+))?$`,
  'i',
);

const parseUnicodeFractionNotes = (recipes: Recipe[]): number => {
  let parsed = 0;
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      if (ing.quantity != null || ing.unit || !ing.notes) continue;
      const trimmed = ing.notes.trim();
      const m = trimmed.match(FRACTION_RE);
      if (!m) continue;
      const qty = UNICODE_FRACTIONS[m[1]];
      const unit = UNIT_FROM_WORD[m[2].toLowerCase()];
      if (qty == null || !unit) continue;
      ing.quantity = qty;
      ing.unit = unit;
      ing.notes = m[3]?.trim() || null;
      parsed++;
    }
  }
  return parsed;
};

// ---------------------------------------------------------------------------
// 10. Map flavor-phrase notes to flavor MeasureUnit values
// ---------------------------------------------------------------------------

const TO_TASTE_PATTERNS: RegExp[] = [
  /^as\s+required$/i,
  /^to\s+taste$/i,
  // Typo'd variants of "sprinkling" surface across many recipes.
  /^sprinkling$/i, /^sprinking$/i, /^spinking$/i, /^spinkling$/i,
  /^splash$/i, /^splashes$/i,
  /^dash$/i, /^dashes$/i,
  /^drizzle$/i, /^drizzle\s*\(for\s+cooking\)$/i,
  /^for\s+brushing$/i,
  /^for\s+greasing$/i,
  /^for\s+dusting$/i,
  /^dusting$/i,
  /^for\s+frying$/i,
  /^fry$/i,
  /^for\s+cooking$/i,
  /^pinch$/i,
  /^grated,?\s+to\s+taste$/i,
  /^grating$/i,
  // Preparation-only notes (no quantity given upstream) — treat as
  // "to taste": the cook adds as much as fits the dish. The original
  // note is preserved on the entry, see prepNotePreserve below.
  /^chopped$/i, /^sliced$/i, /^diced$/i, /^minced$/i,
  /^grated$/i, /^beaten$/i, /^boiled$/i, /^steamed$/i,
  /^peeled$/i, /^peeled\s+and\s+sliced$/i,
  /^ground$/i, /^crushed$/i, /^halved$/i, /^shaved$/i,
  /^sliced\s+and\s+seeded$/i,
  /^white$/i,
];
const TO_SERVE_PATTERNS: RegExp[] = [
  /^to\s+serve$/i,
  /^for\s+serving$/i,
  /^for\s+the\s+top$/i,
  /^topping$/i,
  /^for\s+topping$/i,
  /^for\s+the\s+topping$/i,
  /^top$/i,
  /^to\s+glaze$/i,
];
const GARNISH_PATTERNS: RegExp[] = [
  /^to\s+garnish$/i,
  /^garnish$/i,
  /^for\s+garnish$/i,
  /^garnish\s+with$/i,
  /^garnish\s+chopped$/i,
  /^leaves$/i,
];
const BUNCH_PATTERNS: Array<{ re: RegExp; qty: number; note?: string }> = [
  { re: /^bunch$/i, qty: 1 },
  { re: /^small\s+bunch$/i, qty: 0.5, note: 'small' },
  { re: /^small\s+pack$/i, qty: 1, note: 'small pack' },
  { re: /^½\s+small\s+pack$/i, qty: 0.5, note: 'small pack' },
  { re: /^sprigs?\s+of\s+fresh$/i, qty: 1, note: 'fresh sprigs' },
  { re: /^knob$/i, qty: 1, note: 'knob' },
  { re: /^pod\s+of$/i, qty: 1, note: 'pod' },
];
// Allow optional "grated"/"fresh" prefix; accept "one"/"a"/"half" as synonyms.
// The `(?:.+)` tail captures further qualifiers ("Juice of 1; Chopped",
// "Juice of 1; Zest of 2") that surface after dedup concatenated multiple
// flavor entries into one notes string. We always take the *first* numeric
// quantity in such cases.
const JUICE_ZEST_RE =
  /^(?:grated\s+|fresh\s+|the\s+)?(?:juice|zest|juice\s+and\s+zest|zest\s+and\s+juice|juice\/zest|zest\/juice)\s+of\s+(\d+(?:\/\d+)?|½|¼|¾|⅓|⅔|one|a|half)(?:\s*[;,].*)?$/i;
const HANDFUL_RE = /^(?:large\s+)?handful+$/i; // catches "handful", "handfull", "Large handful"
const HALF_RE = /^half$/i;
const JUICE_HALF_RE = /^juice\s+of\s+half$/i;

// Long-tail patterns that map to a single PIECE with a preserved note.
const PIECE_PATTERNS: Array<{ re: RegExp; qty: number; note: string | null }> = [
  { re: /^½$/, qty: 0.5, note: null },
  { re: /^large\s+piece$/i, qty: 1, note: 'large' },
  { re: /^can$/i, qty: 1, note: 'can' },
  { re: /^bottle$/i, qty: 1, note: 'bottle' },
];
// Notes too specific to map to a unit — fold into TO_TASTE preserving the text.
const TO_TASTE_PRESERVE_PATTERNS: RegExp[] = [
  /^thumb\s+sized\b/i,
  /^leaves\s*;\s*small\s+bunch$/i,
];

const parseFractionString = (s: string): number | null => {
  if (UNICODE_FRACTIONS[s] !== undefined) return UNICODE_FRACTIONS[s];
  if (/^\d+$/.test(s)) return Number(s);
  if (/^one$/i.test(s) || /^a$/i.test(s)) return 1;
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  return null;
};

interface PhraseStats {
  toTaste: number;
  toServe: number;
  garnish: number;
  juiceZest: number;
  handful: number;
  bunch: number;
}

// "chopped" / "sliced" / etc. — these were preparation hints with no
// upstream quantity. We map them to TO_TASTE but preserve the prep word
// on `notes` so the user can still see the original prep direction.
const PREP_NOTE_PRESERVE = new Set([
  'chopped', 'sliced', 'diced', 'minced', 'grated', 'beaten',
  'boiled', 'steamed', 'peeled', 'peeled and sliced',
  'ground', 'crushed', 'halved', 'shaved', 'sliced and seeded',
  'garnish with', 'garnish chopped',
]);

const mapFlavorPhraseNotes = (recipes: Recipe[]): PhraseStats => {
  const stats: PhraseStats = { toTaste: 0, toServe: 0, garnish: 0, juiceZest: 0, handful: 0, bunch: 0 };
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      // Only touch entries the upstream parser left with no usable measure.
      if (ing.quantity != null || ing.unit || !ing.notes) continue;
      const phrase = ing.notes.trim();

      // BUNCH-like before TO_TASTE: "knob" is in the wider category.
      const bunch = BUNCH_PATTERNS.find((b) => b.re.test(phrase));
      if (bunch) {
        ing.quantity = bunch.qty;
        ing.unit = 'BUNCH';
        ing.notes = bunch.note ?? null;
        stats.bunch++;
        continue;
      }

      if (TO_TASTE_PATTERNS.some((re) => re.test(phrase))) {
        ing.unit = 'TO_TASTE';
        // Preserve preparation hints; drop pure "amount" phrases.
        ing.notes = PREP_NOTE_PRESERVE.has(phrase.toLowerCase()) ? phrase.toLowerCase() : null;
        stats.toTaste++;
        continue;
      }
      if (TO_SERVE_PATTERNS.some((re) => re.test(phrase))) {
        ing.unit = 'TO_SERVE';
        ing.notes = null;
        stats.toServe++;
        continue;
      }
      if (GARNISH_PATTERNS.some((re) => re.test(phrase))) {
        ing.unit = 'GARNISH';
        ing.notes = PREP_NOTE_PRESERVE.has(phrase.toLowerCase()) ? phrase.toLowerCase() : null;
        stats.garnish++;
        continue;
      }
      if (HANDFUL_RE.test(phrase)) {
        ing.unit = 'PINCH';
        ing.notes = /^large/i.test(phrase) ? 'Large handful' : 'Handful';
        stats.handful++;
        continue;
      }
      if (HALF_RE.test(phrase)) {
        ing.quantity = 0.5;
        ing.unit = 'PIECE';
        ing.notes = null;
        stats.juiceZest++;
        continue;
      }
      if (JUICE_HALF_RE.test(phrase)) {
        ing.quantity = 0.5;
        ing.unit = 'PIECE';
        ing.notes = 'juice';
        stats.juiceZest++;
        continue;
      }
      const piece = PIECE_PATTERNS.find((p) => p.re.test(phrase));
      if (piece) {
        ing.quantity = piece.qty;
        ing.unit = 'PIECE';
        ing.notes = piece.note;
        stats.juiceZest++;
        continue;
      }
      if (TO_TASTE_PRESERVE_PATTERNS.some((re) => re.test(phrase))) {
        ing.unit = 'TO_TASTE';
        ing.notes = phrase;
        stats.toTaste++;
        continue;
      }
      const jz = phrase.match(JUICE_ZEST_RE);
      if (jz) {
        const qty = parseFractionString(jz[1]);
        if (qty != null) {
          ing.quantity = qty;
          ing.unit = 'PIECE';
          // Preserve the juice/zest semantic for the reader.
          const semantic = phrase.replace(/\s+of\s+\S+.*$/i, '').toLowerCase();
          ing.notes = semantic;
          stats.juiceZest++;
          continue;
        }
      }
    }
  }
  return stats;
};

// ---------------------------------------------------------------------------
// 11. Title-case the two all-lowercase recipe titles
// ---------------------------------------------------------------------------

const titleCaseLowercase = (recipes: Recipe[]): number => {
  let fixed = 0;
  for (const r of recipes) {
    if (r.title && r.title === r.title.toLowerCase() && /[a-z]/.test(r.title)) {
      r.title = r.title.replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase());
      fixed++;
    }
  }
  return fixed;
};

// ---------------------------------------------------------------------------
// 12. Restore lost video URLs after the youtubeUrl -> videoUrl rename
// ---------------------------------------------------------------------------
//
// Earlier versions of this script nullified any non-YouTube URL in the
// (now-renamed) `youtubeUrl` field. With the field generalised to
// `videoUrl`, every video host is acceptable. The four entries below
// were dropped by the earlier nullify pass and are restored here from
// a hardcoded map. The fifth case (53102 Squid salad) had a youtubeUrl
// identical to its sourceUrl, so there is nothing to restore.
//
// raw-recipes.json still holds the originals — we copy them out so the
// canonical recipes.json is self-contained.

const LOST_VIDEO_URLS: Record<string, string> = {
  '53122': 'https://www.bing.com/videos/riverview/relatedvideo?&q=Fiskesuppe+(Creamy+Norwegian+Fish+Soup)+youtube&qpvt=Fiskesuppe+(Creamy+Norwegian+Fish+Soup)+youtube&mid=BA1D06D0C6BB703F9960BA1D06D0C6BB703F9960&&mcid=1B82C46C54684D60AEB9F663316D725F&FORM=VRDGAR',
  '53121': 'https://www.bing.com/videos/riverview/relatedvideo?q=Norwegian+Potato+Lefse+youtube&mid=72F7D5C128519ADD66CA72F7D5C128519ADD66CA&mcid=A586185F283B4580BF51AB66165F8D94&FORM=VIRE',
  '53231': 'https://www.tiktok.com/@shanice_and_lima/video/7280471655959383297',
  '53097': 'https://www.bing.com/videos/riverview/relatedvideo?q=yorkshire+pudding+pecipe+youtune&&mid=8A37CC95703100D3C8E58A37CC95703100D3C8E5&mcid=757E2787DB13499281255AD4321A912C&FORM=VAMGZC',
};

const restoreLostVideoUrls = (recipes: Recipe[]): number => {
  let restored = 0;
  for (const [id, url] of Object.entries(LOST_VIDEO_URLS)) {
    const r = recipes.find((x) => x.externalId === id);
    if (!r) continue;
    if (r['videoUrl'] == null) {
      r['videoUrl'] = url;
      restored++;
    }
  }
  return restored;
};

// ---------------------------------------------------------------------------
// 13. Rewrite step titles that were truncated by the upstream splitter
// ---------------------------------------------------------------------------

const TRUNCATED_TITLE_REWRITES: Record<string, string> = {
  '53279:4': 'Brush with butter and bake',
  '52874:13': 'Serve with green beans',
  '53359:2': 'Heat ghee and sauté onions',
  '53018:6': 'Bake until meat is tender',
  '52979:3': 'Roll the sauce into balls',
  '53080:1': 'Whisk the dry ingredients',
  '53060:1': 'Fry onions and minced meat',
  '52956:4': 'Add water and bring to a boil',
  '53358:6': 'Remove chicken and add the rice',
  '53289:1': 'Soak the freekeh',
  '52832:1': 'Heat oil and fry the bacon',
  '53291:2': 'Bake until almonds are roasted',
  '53291:9': 'Heat honey with orange blossom',
  '52779:4': 'Slice tomatoes and make vinaigrette',
  '53072:4': 'Heat oil in a skillet',
  '53143:2': 'Add tomatoes, olives and beans',
  '53073:1': 'Slice the eggplant',
  '53073:3': 'Brown the ground pork',
  '52895:3': 'Prepare and grill the bacon',
  '53091:2': 'Bake until heated through',
  '53342:5': 'Remove duff from the water',
  '52996:6': 'Mash the potatoes',
  '52896:3': 'Prepare and grill the bacon',
  '52951:1': 'Mix the sauce ingredients',
  '53021:3': 'Sauté the onions',
  '53021:6': 'Roll the cabbage parcels',
  '53021:8': 'Bake until cabbage is tender',
  '53348:7': 'Bake the loaf',
  '53112:1': 'Simmer beef with aromatics',
  '53286:8': 'Bake until golden',
  '53015:2': 'Make the glaze',
  '53104:4': 'Make the chocolate icing',
  '53048:3': 'Boil potato chunks',
  '53086:2': 'Heat oil and crisp garlic',
  '52991:1': 'Make the pastry dough',
  '53304:2': 'Layer the batters in the tin',
  '52927:5': 'Transfer brisket to roasting pan',
  '52864:3': 'Make the mushroom sauce',
  '53377:4': 'Cut and separate the cabbage',
  '52774:1': 'Mix the sauce',
  '53151:1': 'Sizzle prawn heads in oil',
  '53152:3': 'Cook onion with paprika',
  '53192:2': 'Reduce coconut milk with curry paste',
  '53224:3': 'Bake the sponge',
  '53301:3': 'Simmer with sauerkraut and stock',
  '53081:2': 'Cover potatoes with water',
  '53280:3': 'Roast until chicken is cooked through',
  '53108:3': 'Mix the salt and pepper seasoning',
  '52933:6': 'Bake until golden brown',
  '53020:1': 'Add chicken to the pot',
  '53028:5': 'Heat the grill or pan',
  '53023:5': 'Serve with onion, lemon and herbs',
  '53260:3': 'Mix the zest marinade',
  '52982:3': 'Beat the eggs with pepper',
  '53163:1': 'Chop almonds and tip into bowl',
  '53176:1': 'Mix the tomato spread',
  '52872:4': 'Rub baguette with garlic',
  '52980:5': 'Sauté shallots in butter',
  '53067:4': 'Stir in the cooked quinoa',
  '52931:3': 'Bake the pie',
  '53287:2': 'Soak the raisins',
  '53287:5': 'Bake until sweet potato is soft',
  '53198:1': 'Heat oil and stir-fry aromatics',
  '52975:1': 'Sauté spring onions in oil',
  '52852:2': 'Boil and peel the eggs',
  '52852:3': 'Whisk the dressing',
  '53263:2': 'Add boiling water and apricots',
  '52794:3': 'Decorate with melted chocolate',
  '52775:6': 'Bake until heated through',
  '53000:4': 'Heat oil and cook onions',
  '53000:6': 'Strain mixture and thicken',
  '53326:6': 'Serve in soup bowls',
  '53237:3': 'Toss salad and serve',
  '53235:1': 'Stir-fry the pork in batches',
  '53271:3': 'Spoon batter into the tin',
  '52871:2': 'Heat oil and sauté vegetables',
  '53294:2': 'Sauté onion in butter',
};

const rewriteTruncatedTitles = (recipes: Recipe[]): number => {
  let changed = 0;
  for (const r of recipes) {
    for (const s of r.steps) {
      const key = `${r.externalId}:${s.order}`;
      const nextTitle = TRUNCATED_TITLE_REWRITES[key];
      if (nextTitle && s.title !== nextTitle) {
        s.title = nextTitle;
        changed++;
      }
    }
  }
  return changed;
};

// ---------------------------------------------------------------------------
// 13.5 Restore step lists damaged by an earlier idempotency bug
// ---------------------------------------------------------------------------
//
// An earlier version of `removeSectionHeaderSteps` keyed by
// `externalId:order` and re-targeted renumbered survivors on the
// second consecutive run. Four recipes lost real instructions before
// the bug was caught:
//
//   53188 Fašírky          — 5 instruction-steps removed by the
//                            second run after correct header removal.
//   53354 Jamaican Curry Goat — the single remaining cooking step
//                            removed on the second run.
//   53187 Šúĺlance s Makom — one step (boil the potatoes) removed by
//                            the second run.
//   53075 Tortang Talong   — two real steps removed because
//                            "Add salt and beat" was a false-positive
//                            section-header hit on the first run.
//
// The lost content was reconstructed by hand from
// `clean-recipes.json` in Phase-2d house style (one instruction per
// step, sentence-case titles ~3-5 words, leading "N." enumeration
// stripped from content). This is best-effort — the user's original
// Phase-2d titles for these recipes were not preserved on disk.
//
// Each entry below is the COMPLETE step list for its recipe
// post-section-header removal. The restore pass only fires when the
// recipe's current step count differs from the expected length, so
// it is idempotent.

interface RestoredRecipe {
  externalId: string;
  steps: Array<{ title: string; content: string }>;
}

const DAMAGED_RECIPES_RESTORE: RestoredRecipe[] = [
  {
    externalId: '53188',
    steps: [
      { title: 'Soak the bread slices', content: 'Soak the bread slices in milk or water until soft.' },
      { title: 'Squeeze out excess liquid', content: 'Squeeze out excess liquid and mash into small crumbs.' },
      { title: 'Combine meat and aromatics', content: 'In a large bowl, combine ground meat, chopped onions, garlic, soaked bread, egg, and seasonings.' },
      { title: 'Mix until evenly combined', content: 'Mix well until evenly combined.' },
      { title: 'Shape into palm-sized patties', content: 'Take portions of the mixture and shape them into palm-sized patties.' },
      { title: 'Flatten for even cooking', content: 'Flatten slightly to help with even cooking.' },
      { title: 'Dust each patty with flour', content: 'Lightly dust each patty with flour.' },
      { title: 'Coat with egg and breadcrumbs', content: 'Dip into beaten egg, then coat with breadcrumbs for a crispy finish.' },
      { title: 'Heat vegetable oil', content: 'Heat vegetable oil in a pan over medium heat.' },
      { title: 'Fry until golden brown', content: 'Fry the patties for 4-5 minutes per side until golden brown and fully cooked.' },
      { title: 'Drain on paper towels', content: 'Transfer to a paper towel-lined plate to drain excess oil.' },
      { title: 'Serve Fašírky hot', content: 'Serve Fašírky hot with mashed potatoes, cabbage salad, or fresh bread.' },
      { title: 'Enjoy with mustard and pickles', content: 'Enjoy with mustard, pickles, or garlic sauce for extra flavor.' },
    ],
  },
  {
    externalId: '53354',
    steps: [
      { title: 'Rinse the goat meat', content: 'Rinse goat meat with vinegar and water.' },
      { title: 'Season and marinate', content: 'Season goat meat with 1 ½ tablespoon curry powder, all-purpose seasoning, ground ginger, allspice, onion, garlic cloves, and thyme. Marinate for at least 4 hours or up to overnight.' },
      { title: 'Remove aromatics from marinade', content: 'Remove onion and garlic from goat and set aside.' },
      { title: 'Brown goat and sauté aromatics', content: 'Set an electric pressure cooker, like an Instant Pot, on high sauté and add oil. Add goat meat and brown, about 2-3 minutes per side. Remove goat from insert and add 1 tablespoon oil and remaining curry powder and sauté for about 10 seconds. Then add onions and garlic and sauté until softened, about 4 minutes. If the onions look dry, add a little water and continue to sauté.' },
      { title: 'Pressure-cook the goat', content: 'Add goat and water to the pressure cooker and cover. Cook for 40 minutes on high pressure. Allow to naturally release for 10 minutes, then release the remaining pressure.' },
      { title: 'Add potatoes and finish', content: 'Once all the pressure has been released, open the pressure cooker. Place on sauté for 10-15 minutes, add potatoes and a whole scotch bonnet pepper. Cook until potatoes have softened. Remove the scotch bonnet pepper.' },
    ],
  },
  {
    externalId: '53187',
    steps: [
      { title: 'Boil and mash the potatoes', content: 'Boil the potatoes with their skins on until tender. Let them cool completely (preferably overnight), then peel and mash them finely.' },
      { title: 'Make the dough', content: 'In a bowl, combine mashed potatoes, flour, semolina, and salt. Knead the mixture until you get a smooth, non-sticky dough.' },
      { title: 'Shape the dumplings', content: 'Divide the dough into portions and roll each into a thin rope (about 1.5 cm in diameter). Cut into 3 cm-long pieces and roll between your palms to shape small dumplings.' },
      { title: 'Cook the dumplings', content: 'Bring a pot of salted water to a boil. Drop in the dumplings in batches and cook until they float to the surface (about 2-3 minutes). Drain and transfer to a bowl.' },
      { title: 'Prepare the poppy seed topping', content: 'In a separate bowl, mix ground poppy seeds and powdered sugar. Melt the butter and keep it ready.' },
      { title: 'Coat the dumplings', content: 'Drizzle the cooked dumplings with melted butter. Toss them in the poppy seed-sugar mixture until evenly coated.' },
      { title: 'Serve warm', content: 'Serve warm, optionally with a dusting of extra powdered sugar or a drizzle of honey.' },
    ],
  },
  {
    externalId: '53075',
    steps: [
      { title: 'Grill the eggplant', content: 'Grill the eggplant until the color of the skin turns almost black.' },
      { title: 'Cool and peel the eggplant', content: 'Let the eggplant cool for a while, then peel off the skin. Set aside.' },
      { title: 'Crack the eggs', content: 'Crack the eggs and place in a bowl.' },
      { title: 'Add salt and beat', content: 'Add salt and beat the eggs until well blended.' },
      { title: 'Flatten the eggplant', content: 'Place the eggplant on a flat surface and flatten using a fork.' },
      { title: 'Dip in beaten egg', content: 'Dip the flattened eggplant in the beaten egg mixture.' },
      { title: 'Heat the pan', content: 'Heat the pan and pour in the cooking oil.' },
      { title: 'Fry the eggplant', content: 'Fry the eggplant (that was dipped in the beaten mixture). Make sure that both sides are cooked. Frying time will take about 3 to 4 minutes per side on medium heat.' },
    ],
  },
  // Two recipes whose upstream `instructions` field used the U+25A2
  // empty-checkbox ▢ as a between-step divider. Phase 2d ran on these
  // without recognising the divider, so all sub-instructions ended up
  // glued into 2 large steps each. Restoration splits on ▢, drops the
  // section headers ("Crust", "Almond filling", "Assembly",
  // "Raspeballer & (Optional) Salted Meat", "Mashed Rutabaga") and
  // re-titles in Phase-2d house style.
  {
    externalId: '53131',
    steps: [
      { title: 'Mix the crust dough', content: 'Mix together sugar, vanilla and butter until light and fluffy. Mix in the egg yolks. Add in the flour and baking powder and knead with hands until the dough is smooth.' },
      { title: 'Chill the dough', content: 'Pack the dough in plastic wrap and chill in refrigerator for at least 30 minutes.' },
      { title: 'Grind almonds with sugar', content: 'Run the almonds and sugar together in a food processor until the almonds are finely ground (you can decide for yourself how coarse or fine you want them).' },
      { title: 'Stir in butter and flavorings', content: 'Stir in the butter, egg, cognac and/or almond extract (if using).' },
      { title: 'Prepare the cake form', content: 'Line the bottom of your cake form with baking paper and grease the sides of the form.' },
      { title: 'Preheat the oven', content: 'Preheat oven to 350°F (175°C).' },
      { title: 'Press the crust into the form', content: 'Cut 2/3 of the crust dough into slices and press down into the cake form. Cover the bottom of the cake form with the dough and bring the dough 2-3 cm (1 inch) up the sides of the form, pressing until even.' },
      { title: 'Spread the almond filling', content: 'Scoop the almond filling on top of the crust, spreading it evenly across the cake form.' },
      { title: 'Lattice the top with dough strips', content: "Roll out the rest of the dough and slice into long strips. Lay the strips of dough across the cake in a grid. Don't worry if the strips break — simply press them back together on the cake." },
      { title: 'Brush with egg wash', content: 'Gently brush the dough with egg wash.' },
      { title: 'Bake until golden', content: 'Bake for about 45 minutes. The top of the cake should be golden brown while the almond filling will remain soft.' },
    ],
  },
  {
    externalId: '53124',
    steps: [
      { title: 'Cook the salted meat', content: "If you're making pork knuckle, cook it in simmering water for about 3 hours, until the meat falls from the bone. Remove the pork and save the broth to cook the raspeballer." },
      { title: 'Boil and grate the potatoes', content: 'Boil the boiled potatoes and peel once cooled. Also peel the raw potatoes, and then grate them or run them through a food processor. Use a paper towel to remove some of the moisture from the grated potatoes.' },
      { title: 'Mix the dumpling dough', content: 'Mash the boiled potatoes in a potato ricer or with a masher. Make sure there are no lumps. Add the grated raw potatoes to the mashed potatoes in a large mixing bowl and stir together. Add the barley flour, all purpose flour, and salt and mix together with your hands until the mixture is fully blended.' },
      { title: 'Bring the broth to simmer', content: "You can cook the raspeballer in either vegetable or beef broth, or if you're making pork knuckle, cook them in the broth from the pork knuckle. Bring the broth to a very light simmer — you don't want it to fully boil because then the raspeballer might break apart." },
      { title: 'Shape the raspeballer', content: 'Use a tablespoon dipped in cold water to shape each raspeball in your hand. Try to make them as smooth as possible and then gently drop them into the simmering broth. Dip the tablespoon in a bowl of cold water between each raspeball.' },
      { title: 'Simmer the dumplings', content: "Let the raspeballer simmer for about 30 minutes. If you're making smoked sausage, you can heat the sausage in the same pot with the raspeballer. Top with fresh chopped parsley." },
      { title: 'Mash the rutabaga and carrots', content: 'Peel the rutabaga and carrots and cut into small pieces. Boil in water for about 30 minutes, or until tender. Then drain the water, add the cream/milk, butter and nutmeg and mash until smooth.' },
      { title: 'Serve alongside the meat', content: 'Serve alongside the raspeballer and meat.' },
    ],
  },
  // 52784 Smoky Lentil Chili with Squash — a hybrid recipe with a
  // main chili dish (step 1) and a cashew sour cream sub-recipe
  // (steps 2 + 3). Steps 1 and 3 each glued multiple instructions
  // into a single block, while step 2 was an ingredient list for the
  // sub-recipe. The ingredient-list step is intentionally preserved
  // verbatim — its title acts as a divider/label for the sub-recipe
  // section, which is the cleanest way to model a hybrid step list
  // without a separate sub-recipe table on the schema.
  {
    externalId: '52784',
    steps: [
      { title: 'Roast the squash', content: 'Slice the squash into thin crescents and drizzle with a little oil and sprinkle with sea salt. Roast at 205°C (400°F) for 20-30 minutes, flipping halfway through, until soft and golden. Let cool and chop into cubes.' },
      { title: 'Cook the lentils', content: 'Meanwhile, rinse the lentils and cover them with water. Bring to a boil, then turn down to a simmer and let cook (uncovered) for 20-30 minutes, or until tender. Drain and set aside.' },
      { title: 'Sauté aromatics and spices', content: 'While the lentils are cooking, heat 1 Tbsp of oil on low in a medium pot. Add the onions and leeks and sauté for about 5 minutes, until they begin to soften. Add the garlic along with the cumin and coriander, cooking for a few more minutes. Then add the remaining spices — paprika, cinnamon, chilli, cocoa, Worcestershire sauce, salt, and oregano.' },
      { title: 'Simmer the chili', content: 'Add the can of tomatoes, the water or stock, and carrots. Let simmer, covered, for 20 minutes or until the veg is tender and the mixture has thickened. Check on the pot periodically to stir and top up the liquid if needed.' },
      { title: 'Combine lentils and squash', content: 'Add the lentils and chopped roasted squash. Let cook for 10 more minutes to heat through.' },
      { title: 'Serve with garnishes', content: 'Serve with sliced jalapeño, lime wedges, cilantro, green onions, and cashew sour cream.' },
      { title: 'Cashew sour cream ingredients', content: '1 cup raw unsalted cashews\nPinch sea salt\n1 tsp apple cider vinegar\nWater' },
      { title: 'Soak the cashews', content: "Bring some water to a boil and use it to soak the cashews for at least four hours. Alternatively, use cold water and let the cashews soak overnight." },
      { title: 'Blend the soaked cashews', content: 'After the cashews have soaked, drain them and add to a high-speed blender. Begin to puree, slowly adding about 1/2 cup of fresh water, until a creamy consistency is reached. You may need to add less or more water to reach the desired consistency.' },
      { title: 'Season the sour cream', content: 'Add a pinch of sea salt and the vinegar (or lemon juice).' },
    ],
  },
  // -- Tier 1 batch — 10 recipes sharing the same upstream shape:
  // step 1 packs the entire cooking method as `Header: instructions`
  // lines separated by newlines, with a trailing `Pro Tips:` label;
  // step 2 (occasionally step 3) holds the bullet-style tips. Split
  // step 1 on the section labels and consolidate the tips into a
  // single closing step so the surface is consistently
  // one-instruction-per-step.
  {
    externalId: '53138',
    steps: [
      { title: 'Make the dough', content: 'Cream butter and sugar. Add egg yolks and lemon zest. Gradually mix in flour and cornstarch to form a dough. Chill for 1 hour.' },
      { title: 'Bake the cookies', content: 'Roll out the dough, cut into circles, and bake at 180°C (350°F) for 12-15 minutes. Let cool.' },
      { title: 'Assemble the alfajores', content: 'Spread dulce de leche on one cookie, then sandwich with another. Roll the edges in coconut flakes.' },
      { title: 'Tips and substitutions', content: 'Chill the dough before rolling it out to make it easier to handle and to prevent the cookies from spreading too much while baking. Dip the alfajores in melted chocolate and let them set on a wire rack for an extra decadent treat.' },
    ],
  },
  {
    externalId: '53133',
    steps: [
      { title: 'Prepare the fire', content: 'Start a wood fire in your grill and let it burn down to coals.' },
      { title: 'Season the meat', content: 'Generously salt the beef cuts.' },
      { title: 'Grill the meat', content: 'Place the beef on the grill, starting with the thickest cuts farthest from the coals. Add chorizo and morcilla after the beef has been cooking for a while.' },
      { title: 'Cook to perfection', content: 'Cook the meat, turning occasionally, until it reaches your desired doneness. Typically, ribs may take up to 2 hours; thinner cuts will cook faster.' },
      { title: 'Rest and serve', content: 'Let the meat rest for about 10 minutes before slicing. Serve with chimichurri sauce and grilled vegetables.' },
      { title: 'Tips and serving suggestions', content: "Use a mix of wood and charcoal for a consistent heat source — wood adds flavor, while charcoal maintains temperature. Season the meat just before grilling to ensure it retains its moisture and flavor. Serve with a side of chimichurri sauce, a fresh tomato salad, and crusty bread. Pair with a robust Malbec wine to complement the rich flavors of the meat." },
    ],
  },
  {
    externalId: '53141',
    steps: [
      { title: 'Brown the beef', content: 'In a large pot, brown the beef cubes. Remove and set aside.' },
      { title: 'Sauté the vegetables', content: 'In the same pot, cook the onion until translucent. Add carrots, potatoes, and pumpkin, cooking for a few minutes.' },
      { title: 'Simmer the stew', content: 'Return the beef to the pot. Add broth and dried apricots. Season with salt and pepper. Simmer for 1-2 hours, until the beef is tender.' },
      { title: 'Serve with bread', content: 'Enjoy hot, with a crusty piece of bread.' },
      { title: 'Tips and substitutions', content: "Brown the beef in batches to ensure it gets a good sear, which adds depth to the stew's flavor. Adding the fruits towards the end of cooking preserves their texture and adds a subtle sweetness to the dish." },
    ],
  },
  {
    externalId: '53136',
    steps: [
      { title: 'Grill the chorizos', content: 'Cook the chorizos on a grill or pan until fully cooked, about 10-15 minutes.' },
      { title: 'Prepare the rolls', content: 'Slice the rolls and toast them lightly on the grill or in a pan.' },
      { title: 'Assemble the choripán', content: 'Slice each chorizo lengthwise and place in a roll. Top with a generous amount of chimichurri sauce.' },
      { title: 'Serve immediately', content: 'Enjoy immediately while hot.' },
      { title: 'Tips and substitutions', content: "Grill the chorizo slowly on medium heat to prevent the skin from bursting and to ensure it cooks evenly throughout. Toast the bread on the grill to absorb some of the chorizo's flavors." },
    ],
  },
  {
    externalId: '53137',
    steps: [
      { title: 'Combine the ingredients', content: 'In a large, heavy-bottomed pot, mix the milk, sugar, and baking soda. Cook over low heat, stirring constantly to prevent burning.' },
      { title: 'Thicken the mixture', content: 'Continue to cook, stirring frequently, until the mixture becomes thick and caramel-colored, about 1-2 hours.' },
      { title: 'Stir in the vanilla', content: 'Stir in the vanilla extract.' },
      { title: 'Cool and store', content: 'Let the dulce de leche cool, then transfer to a jar. It will thicken further as it cools.' },
      { title: 'Tips and substitutions', content: 'Stir continuously and keep the heat low to prevent the milk from burning and sticking to the bottom of the pan. A drop of vanilla extract added at the end of cooking enhances the flavor.' },
    ],
  },
  {
    externalId: '53134',
    steps: [
      { title: 'Make the dough', content: 'Mix flour and salt in a large bowl. Add butter, using your fingers to blend into a crumbly texture. Gradually add water, mixing until a dough forms. Wrap and chill for 30 minutes.' },
      { title: 'Prepare the filling', content: 'Cook onions in a pan until translucent. Add ground beef, cooking until browned. Stir in spices, then remove from heat. Once cooled, mix in eggs and olives.' },
      { title: 'Assemble the empanadas', content: 'Roll out the dough and cut into circles. Place a spoonful of filling in each, fold over, and seal the edges.' },
      { title: 'Bake until golden', content: 'Bake at 200°C (400°F) for 20-25 minutes, or until golden.' },
      { title: 'Tips and substitutions', content: 'For a flakier crust, incorporate a tablespoon of vinegar into the dough mixture. This helps prevent gluten formation. Seal the edges of the empanadas with a fork to ensure they do not open during baking or frying.' },
    ],
  },
  {
    externalId: '53139',
    steps: [
      { title: 'Prepare the batter', content: 'Whisk together chickpea flour, water, salt, and pepper. Let sit for at least 4 hours.' },
      { title: 'Bake the fainá', content: 'Preheat the oven to 220°C (430°F). Pour olive oil into a round baking dish and heat in the oven. Pour in the batter and bake for 25-30 minutes, until golden.' },
      { title: 'Slice and serve', content: 'Slice and serve hot, optionally with black pepper on top.' },
      { title: 'Tips and substitutions', content: 'Let the batter rest for at least 2 hours, or overnight in the refrigerator, to ensure the chickpea flour fully hydrates and the flavors meld. For a crispy edge, preheat the baking pan with oil in the oven before adding the batter.' },
    ],
  },
  {
    externalId: '53146',
    steps: [
      { title: 'Soak corn and beans', content: 'Soak corn and beans overnight in water.' },
      { title: 'Brown the meats', content: 'In a large pot, brown the beef and pork. Add onions and spices, cooking until translucent.' },
      { title: 'Simmer the stew', content: 'Add soaked corn and beans, pumpkin, potato, and enough water to cover. Simmer for 2-3 hours, until thick.' },
      { title: 'Serve with bread', content: 'Enjoy hot, with bread on the side.' },
      { title: 'Tips and substitutions', content: 'Toasting the corn slightly before adding it to the stew enhances its flavor. Add a spoonful of paprika or a dash of cumin for an extra layer of warmth and complexity.' },
    ],
  },
  {
    externalId: '53140',
    steps: [
      { title: 'Prepare the steak', content: 'Season the steak with salt and pepper. Grill one side until half-cooked.' },
      { title: 'Add the toppings', content: 'Spread tomato sauce over the cooked side, then add cheese, oregano, and olives.' },
      { title: 'Finish grilling', content: 'Grill until the cheese is melted and bubbly.' },
      { title: 'Slice and serve', content: 'Slice and serve hot.' },
      { title: 'Tips and substitutions', content: "Tenderize the matambre by scoring it lightly on both sides. This helps it cook more evenly and absorb the flavors. Precook the matambre on the grill before adding the toppings to ensure it's fully cooked without burning the cheese." },
    ],
  },
  {
    externalId: '53135',
    steps: [
      { title: 'Season the cutlets', content: 'Salt and pepper the cutlets.' },
      { title: 'Bread the cutlets', content: 'Dip each cutlet in egg, then coat with a mixture of breadcrumbs, parsley, and garlic.' },
      { title: 'Fry the milanesas', content: 'Heat oil in a large pan over medium heat. Fry the cutlets until golden and cooked through, about 3-4 minutes per side.' },
      { title: 'Serve with lemon', content: 'Serve hot with lemon wedges or a side salad.' },
      { title: 'Tips and substitutions', content: 'For an extra crispy crust, use panko breadcrumbs mixed with finely grated Parmesan cheese. Gently pound the cutlets to an even thickness for uniform cooking.' },
    ],
  },
  // -- Tier 2 batch — recipes with labeled/numbered sub-instructions
  // packed into 1-2 oversized steps. Each restoration is hand-tailored
  // to the recipe's structure.
  {
    externalId: '52812',
    steps: [
      { title: 'Trim and score the fat', content: 'On one side of the brisket there should be a layer of fat, which you want. If there are any large chunks of fat, cut them off and discard them — large pieces of fat will not be able to render out completely. Using a sharp knife, score the fat in parallel lines, about 3/4-inch apart. Slice through the fat, not the beef. Repeat in the opposite direction to make a cross-hatch pattern.' },
      { title: 'Salt and rest the brisket', content: 'Salt the brisket well and let it sit at room temperature for 30 minutes.' },
      { title: 'Sear the brisket', content: "You'll need an oven-proof, thick-bottomed pot with a cover, or Dutch oven, just wide enough to hold the brisket with a little room for the onions. Pat the brisket dry and place it, fatty side down, into the pot on medium-high heat. Cook for 5-8 minutes, lightly sizzling, until the fat side is nicely browned (if the roast is cooking too fast, turn the heat down to medium — you want a steady sizzle, not a raging sear). Turn the brisket over and cook for a few minutes more to brown the other side." },
      { title: 'Sauté the onions and garlic', content: 'When the brisket has browned, remove it from the pot and set aside. There should be a couple of tablespoons of fat rendered in the pot; if not, add some olive oil. Add the chopped onions and increase the heat to high. Sprinkle a little salt on the onions. Sauté, stirring often, until lightly browned, 5-8 minutes. Stir in the garlic and cook 1-2 more minutes.' },
      { title: 'Braise in stock with herbs', content: 'Preheat the oven to 300°F. Use kitchen twine to tie together the bay leaves, rosemary and thyme. Move the onions and garlic to the sides of the pot and nestle the brisket inside. Add the beef stock and the tied-up herbs. Bring the stock to a boil on the stovetop. Cover the pot, place it in the 300°F oven and cook for 3 hours. Carefully flip the brisket every hour so it cooks evenly.' },
      { title: 'Add carrots and finish cooking', content: 'After 3 hours, add the carrots. Cover the pot and cook for 1 hour more, or until the carrots are cooked through and the brisket is falling-apart tender.' },
      { title: 'Remove brisket and tent with foil', content: 'When the brisket is falling-apart tender, take the pot out of the oven and remove the brisket to a cutting board. Cover it with foil. Pull out and discard the herbs.' },
      { title: 'Make the optional pan sauce', content: 'At this point you have two options. You can serve as is, or make a sauce with the drippings and some of the onions. To make a sauce, remove the carrots and half of the onions, set aside and cover them with foil. Pour the remaining pot contents into a blender and purée until smooth. If you want, add 1 tablespoon of mustard to the mix. Transfer to a small pot and keep warm.' },
      { title: 'Slice across the grain', content: 'Notice the lines of the muscle fibers of the roast — this is the "grain" of the meat. Slice the meat perpendicular to these lines (cutting this way further tenderizes the meat), in 1/4-inch to 1/2-inch slices.' },
      { title: 'Serve with the onions and gravy', content: 'Serve with the onions, carrots and gravy. Pair with mashed, roasted or boiled potatoes, egg noodles or polenta.' },
    ],
  },
  {
    externalId: '52938',
    steps: [
      { title: 'Mix the dry ingredients', content: 'To a large bowl, add flour, 1 teaspoon salt, and turmeric and mix thoroughly.' },
      { title: 'Rub in the shortening', content: 'Rub shortening into the flour until there are small pieces of shortening completely covered with flour.' },
      { title: 'Form the dough with ice water', content: 'Pour in 1/2 cup of the ice water and mix with your hands to bring the dough together. Keep adding ice water 2 to 3 tablespoons at a time until the mixture forms a dough.' },
      { title: 'Chill the dough', content: 'Either cut the dough into 2 large pieces, wrap in plastic and refrigerate for 30 minutes; or cut the dough into 10 to 12 equal pieces, place on a platter, cover securely with plastic wrap, and let chill for 30 minutes while you make the filling.' },
      { title: 'Season the ground beef', content: 'Add the ground beef to a large bowl. Sprinkle in allspice and black pepper. Mix together and set aside.' },
      { title: 'Sauté the aromatics', content: 'Heat oil in a skillet until hot. Add onions and sauté until translucent. Add hot pepper, garlic and thyme and continue to sauté for another minute. Add 1/4 teaspoon salt.' },
      { title: 'Brown the seasoned beef', content: 'Add the seasoned ground beef and toss to mix, breaking up any clumps. Let cook until the meat is no longer pink. Add ketchup and more salt to taste.' },
      { title: 'Simmer the filling', content: 'Pour in 2 cups of water and stir. Bring the mixture to a boil, then reduce heat and let simmer until most of the liquid has evaporated and whatever is remaining has reduced to a thick sauce.' },
      { title: 'Cool the filling', content: 'Fold in green onions. Remove from heat and let cool completely.' },
      { title: 'Make the egg wash', content: 'Beat the egg and water together to make an egg wash. Set aside.' },
      { title: 'Roll, fill and crimp — first method', content: 'If you cut the dough into 2 large pieces, flour the work surface and rolling pin and roll out one large piece into a wide circle. Cut out three 5-inch circles using a wide-rimmed bowl. Place about 3 heaping tablespoons of the filling onto half of each circle. Dip a finger into water and moisten the edges of the pastry. Fold over the other half and press to seal. Crimp the edges with a fork and trim any excess for a neat finish. Place on a parchment-lined baking sheet and continue until you have rolled all the dough and filled the patties.' },
      { title: 'Roll, fill and crimp — second method', content: 'If you pre-cut the dough into individual pieces, work with one piece at a time. Roll it out on a floured surface into a 5-inch circle or a little larger. Place 3 heaping tablespoons of the filling on one side. Moisten the edges, fold over and press to seal. Crimp the edges with a fork and trim any excess. Place on a parchment-lined baking sheet and continue until all patties are formed.' },
      { title: 'Chill and brush with egg wash', content: 'After forming the patties, place the pans in the refrigerator while you heat the oven to 350°F. Just before adding the pans to the oven, brush the patties with egg wash.' },
      { title: 'Bake until golden', content: 'Bake the patties for 30 minutes or until golden brown.' },
      { title: 'Cool and serve', content: 'Cool on wire racks. Serve warm.' },
    ],
  },
  {
    externalId: '53352',
    steps: [
      { title: 'Instant Pot — sauté the aromatics', content: 'Set the Instant Pot to "Sauté." Once hot, add olive oil. Add the yellow onion and stir until softened, about 3 minutes. Add garlic and green onions and stir for about 30 more seconds.' },
      { title: 'Instant Pot — add rice and seasonings', content: 'Press "Cancel" on the Instant Pot. Add rice, coconut milk, water, salt, allspice, and black pepper, and stir.' },
      { title: 'Instant Pot — layer the beans and thyme', content: 'Pour the undrained kidney beans on top of the rice mixture — do not stir. Lay sprigs of thyme on top. Cover the Instant Pot, ensuring the valve is set to "Sealing."' },
      { title: 'Instant Pot — pressure cook', content: 'Press "Manual" or "Pressure Cook" and set for high pressure for 6 minutes.' },
      { title: 'Instant Pot — release and fluff', content: 'Once the pressure cooking time is done, allow it to natural release for 10 minutes, then quick release any remaining pressure by moving the valve to "Venting." Open the lid, remove the thyme sprigs, and fluff the rice with a fork.' },
      { title: 'Stove top alternative — sauté the aromatics', content: 'Heat olive oil in a large pot over medium heat. Add yellow onion and stir until softened, about 3 minutes. Add garlic and green onions and stir for about 30 more seconds.' },
      { title: 'Stove top alternative — combine and simmer', content: 'Add rice, undrained kidney beans, coconut milk, water, salt, allspice, and black pepper, and stir until combined. Lay thyme on top. Bring the mixture to a simmer.' },
      { title: 'Stove top alternative — cover and cook', content: 'Cover with a lid and reduce heat to low. Allow to cook for 18 minutes over low heat, then remove from heat. Leave the lid on for an additional 5 minutes.' },
      { title: 'Stove top alternative — fluff and serve', content: 'Open the lid and remove the thyme. Fluff the rice with a fork.' },
    ],
  },
  // 52820 Katsu Chicken Curry — current step 1 is metadata
  // ("Prep:15min · Cook:30min · Ready in:45min") that leaked from the
  // upstream recipe header into the instructions field; we drop it
  // entirely. Step 2 is then split into its six labeled paragraphs.
  {
    externalId: '52820',
    steps: [
      { title: 'Cook the onion and carrots', content: 'For the curry sauce — heat oil in a medium non-stick saucepan, add onion and garlic, and cook until softened. Stir in the carrots and cook over low heat for 10 to 12 minutes.' },
      { title: 'Add flour, curry powder and stock', content: 'Add flour and curry powder; cook for 1 minute. Gradually stir in stock until combined; add honey, soy sauce and bay leaf. Slowly bring to the boil.' },
      { title: 'Simmer and strain the sauce', content: 'Turn down the heat and simmer for 20 minutes or until the sauce thickens but is still of pouring consistency. Stir in the garam masala. Pour the curry sauce through a sieve, return to the saucepan, and keep on low heat until ready to serve.' },
      { title: 'Bread the chicken', content: 'Season both sides of the chicken breasts with salt and pepper. Place flour, egg and breadcrumbs in separate bowls and arrange in a row. Coat the chicken breasts in flour, then dip them into the egg, then coat in breadcrumbs, making sure to cover both sides.' },
      { title: 'Fry the chicken', content: 'Heat oil in a large frying pan over medium-high heat. Place the chicken into the hot oil and cook until golden brown, about 3 or 4 minutes per side. Once cooked, place on kitchen paper to absorb excess oil.' },
      { title: 'Plate with curry and rice', content: 'Pour the curry sauce over the chicken and serve with white rice.' },
    ],
  },
  // -- Tier 3 batch — multi-paragraph recipes with no consistent
  // section labels. Each restoration splits paragraphs into discrete
  // steps; image-caption noise ("arepa making" in 53325) and section
  // header steps ("Make the crispy onion topping." in 53027) are
  // dropped.
  {
    externalId: '53027',
    steps: [
      { title: 'Cook the lentils', content: 'Bring lentils and 4 cups of water to a boil in a medium pot or saucepan over high heat. Reduce the heat to low and cook until the lentils are just tender (15-17 minutes). Drain and season with a little salt. The lentils should be only par-cooked at this point — they need to finish cooking with the rice.' },
      { title: 'Combine rice and lentils', content: 'Drain the rice from its soaking water. Combine the par-cooked lentils and the rice in the saucepan over medium-high heat with 1 tbsp cooking oil, salt, pepper, and coriander. Cook for 3 minutes, stirring regularly. Add warm water to cover the rice and lentil mixture by about 1 1/2 inches (about 3 cups). Bring to a boil; the water should reduce a bit. Cover and cook until all the liquid has been absorbed and both rice and lentils are well cooked through (about 20 minutes). Keep covered and undisturbed for 5 minutes.' },
      { title: 'Cook the pasta separately', content: 'While the rice and lentils are cooking, make the pasta according to package instructions. Add the elbow pasta to boiling water with a dash of salt and a little oil. Cook until al dente. Drain.' },
      { title: 'Warm the chickpeas', content: 'Cover the chickpeas and warm in the microwave briefly before serving.' },
      { title: 'Coat the onion rings in flour', content: 'Sprinkle the onion rings with salt, then toss them in the flour to coat. Shake off the excess flour.' },
      { title: 'Fry the onions until caramelized', content: 'In a large skillet, heat the cooking oil over medium-high heat. Cook the onion rings, stirring often, until they turn a nice caramelized brown. The onions must be crispy but not burned (15-20 minutes).' },
    ],
  },
  {
    externalId: '53029',
    steps: [
      { title: 'Sauté the onions', content: 'Sauté the onions in 3-4 tablespoons of olive oil.' },
      { title: 'Sear the meat', content: 'Add the beef cubes or chicken cutlets and sear for 3-4 minutes on each side.' },
      { title: 'Cover with water and simmer', content: 'Add 1 liter of water, or just enough to cover the meat. Cook over medium heat until the meat is done (a pressure cooker on high for 5 minutes also works).' },
      { title: 'Add the mulukhiyah', content: 'Add the frozen mulukhiyah and stir until it thaws completely and comes to a boil.' },
      { title: 'Make the garlic oil', content: "In another pan add 1/4 to 1/2 cup of olive oil and the cloves of garlic. Cook over medium-low heat until you can smell the garlic — don't brown it, or it will become bitter." },
      { title: 'Combine and simmer', content: 'Add the garlic oil to the mulukhiyah, lower the heat and simmer for 5-10 minutes. Add salt to taste.' },
      { title: 'Serve with lemon', content: 'Serve with a generous amount of lemon juice.' },
      { title: 'Serve with rice or pita', content: 'You can serve it with some short-grain rice or pita bread.' },
    ],
  },
  {
    externalId: '53054',
    steps: [
      { title: 'Soak the glutinous rice', content: 'Soak the glutinous rice in water for at least 1 ½ hours prior to using. Drain.' },
      { title: 'Prepare the cake pan', content: 'Prepare a 9-inch round or square cake pan and spray with cooking spray, or line with plastic wrap.' },
      { title: 'Mix the rice with coconut milk', content: 'Mix coconut milk, water, salt and the rice. Pour into the cake pan and top with the pandan knots.' },
      { title: 'Steam the rice', content: 'Steam for 30 minutes.' },
      { title: 'Fluff and flatten the rice', content: 'After 30 minutes, fluff up the rice and remove the pandan knots. Using a greased spatula, flatten the steamed rice. Make sure there are no holes, air bubbles or gaps in the rice, especially along the sides.' },
      { title: 'Steam again', content: 'Steam for another 10 minutes.' },
      { title: 'Mix the pandan custard', content: 'Combine pandan juice, coconut milk, all-purpose flour, cornflour, and sugar. Mix well.' },
      { title: 'Whisk in eggs and strain', content: 'Add the eggs and whisk well, then strain into a medium-sized metal bowl or pot.' },
      { title: 'Cook in a double boiler', content: 'Place the pandan mixture over simmering water (double boiler or bain-marie). Stir continuously and cook until the custard starts to thicken (about 15 minutes).' },
      { title: 'Pour custard over rice and steam', content: 'Pour the pandan custard into the glutinous rice layer, give it a little tap (to release air bubbles), and continue to steam for 30 minutes.' },
      { title: 'Cool and cut', content: 'Remove the kuih seri muka from the steamer and allow to cool completely before cutting into rectangles or diamond shapes.' },
    ],
  },
  // 53325 Venezuelan Arepas — current step 2 has two stray
  // "arepa making" lines that were image captions in the upstream
  // recipe page; they're dropped. The 9- and 7-line steps are split
  // into individual cooking instructions.
  {
    externalId: '53325',
    steps: [
      { title: 'Preheat the oven', content: 'Preheat the oven to 410°F.' },
      { title: 'Dissolve salt in water', content: 'Pour the water into a large bowl — make sure it is room temperature. Add the salt and blend well with a mixer, fork or spatula until it dissolves completely.' },
      { title: 'Add the cornmeal', content: 'While you continue to beat the mixture, slowly add the cornmeal a little bit at a time. Once all the flour is added, keep mixing until the cornmeal, water and salt are thoroughly blended.' },
      { title: 'Rest the masa', content: "Set aside the masa in its bowl. Let it rest for 5 minutes so that the flour is thoroughly hydrated. This type of corn flour does not have any gluten, so it doesn't need to be kneaded. The masa should be smooth, firm yet malleable." },
      { title: 'Heat the budare', content: "While waiting for the 5-minute rest, heat your budare (or comal, griddle, cast-iron pan or non-stick pan) over medium heat. Coat with a little bit of the oil." },
      { title: 'Shape the masa balls', content: 'Fill a small bowl with water to wet your hands. Take about 2 Tbsp of the masa in your damp hands. The masa should fit easily in your palm so that it is easy to shape into a small ball.' },
      { title: 'Press into discs', content: 'Cross your hands so that one is on top of the other, with the masa ball between them. Rotate your right hand in a circle, simultaneously pressing the masa into a flat disc and keeping its round shape.' },
      { title: 'Smooth the edges', content: 'Quickly pass and lightly press the masa disc from one hand to the other until it is about ¾ of an inch thick and 4 inches wide. Smooth the edges with your fingertips (quickly dip them into the water bowl first) so they stay round and crack-free.' },
      { title: 'Cook on the griddle', content: "Place the arepas in batches on the preheated surface of your budare, griddle or non-stick pan. Let each side turn golden, about 4 to 5 minutes per side. Check them often so they don't burn." },
      { title: 'Finish in the oven', content: 'Once they are nicely browned on both sides, place the arepas on a baking sheet in the preheated oven for 10 minutes. They should be somewhat puffy — if you tap an arepa lightly on top, it will sound like you are tapping an empty box.' },
      { title: 'Serve hot', content: 'Serve the arepas hot, either stuffed with your choice of fillings or solo to accompany a Venezuelan guiso or stew.' },
    ],
  },
];

const restoreDamagedRecipes = (recipes: Recipe[]): number => {
  let restored = 0;
  for (const target of DAMAGED_RECIPES_RESTORE) {
    const r = recipes.find((x) => x.externalId === target.externalId);
    if (!r) continue;
    // Idempotency: skip if the current step list already matches the
    // restored list (same length AND same first/last titles).
    if (
      r.steps.length === target.steps.length &&
      r.steps[0]?.title === target.steps[0].title &&
      r.steps[r.steps.length - 1]?.title === target.steps[target.steps.length - 1].title
    ) {
      continue;
    }
    r.steps = target.steps.map((s, i) => ({
      order: i + 1,
      title: s.title,
      content: s.content,
    }));
    restored++;
  }
  return restored;
};

// ---------------------------------------------------------------------------
// 14. Remove section-header steps (title == content, short, no terminator)
// ---------------------------------------------------------------------------
//
// Eight steps across three recipes survived as glorified divider
// headers ("Prepare the Bread Mixture", "6QT Pressure cooker", etc.)
// — they duplicate the title in their content and carry no
// instruction. The schema's RecipeStep model expects each row to be
// an actionable step, so we drop them and re-number the remaining
// steps to close the gap.
//
// IMPORTANT: match by content equality, not by `externalId:order`.
// After a removal, the surviving steps are renumbered — a key like
// `53188:1` would re-target the new step at order 1, which is a
// different (real) step. Matching by content makes the pass
// idempotent: once the header content is gone, subsequent runs
// cannot match anything.

const SECTION_HEADER_STEPS: Array<{ externalId: string; content: string }> = [
  { externalId: '53188', content: 'Prepare the Bread Mixture' },
  { externalId: '53188', content: 'Mix the Ingredients' },
  { externalId: '53188', content: 'Shape the Meat Patties' },
  { externalId: '53188', content: 'Coat the Patties' },
  { externalId: '53188', content: 'Fry the Fašírky' },
  { externalId: '53188', content: 'Serve and Enjoy' },
  { externalId: '53354', content: '6QT Pressure cooker' },
  { externalId: '53187', content: 'Prepare the Potatoes' },
];

const removeSectionHeaderSteps = (recipes: Recipe[]): number => {
  let removed = 0;
  const byRecipe = new Map<string, Set<string>>();
  for (const h of SECTION_HEADER_STEPS) {
    if (!byRecipe.has(h.externalId)) byRecipe.set(h.externalId, new Set());
    byRecipe.get(h.externalId)!.add(h.content.trim());
  }
  for (const r of recipes) {
    const headers = byRecipe.get(r.externalId);
    if (!headers) continue;
    const before = r.steps.length;
    r.steps = r.steps.filter((s) => !headers.has((s.content ?? '').trim()));
    if (r.steps.length === before) continue;
    r.steps.forEach((s, i) => (s.order = i + 1));
    removed += before - r.steps.length;
  }
  return removed;
};

// ---------------------------------------------------------------------------
// 15. Trim leading/trailing whitespace on recipe titles
// ---------------------------------------------------------------------------

const trimRecipeTitles = (recipes: Recipe[]): number => {
  let trimmed = 0;
  for (const r of recipes) {
    const next = r.title.trim();
    if (next !== r.title) {
      r.title = next;
      trimmed++;
    }
  }
  return trimmed;
};

// ---------------------------------------------------------------------------
// 16. Strip zero-width spaces (U+200B) from step content
// ---------------------------------------------------------------------------

const stripZeroWidthSpaces = (recipes: Recipe[]): number => {
  let stripped = 0;
  for (const r of recipes) {
    for (const s of r.steps) {
      if (/​/.test(s.content)) {
        s.content = s.content.replace(/​/g, '');
        stripped++;
      }
    }
  }
  return stripped;
};

// ---------------------------------------------------------------------------
// 17. Strip leading punctuation from step content
// ---------------------------------------------------------------------------
//
// One step survived with a leading ". " ("Prepare the eggplants…"). The
// pattern catches `.`, `,`, `;`, `:`, `-`, en-dash, em-dash followed by
// whitespace at the very start of the content.

const stripLeadingPunctuation = (recipes: Recipe[]): number => {
  let stripped = 0;
  for (const r of recipes) {
    for (const s of r.steps) {
      const next = s.content.replace(/^[.,;:\-–—]+\s+/, '');
      if (next !== s.content) {
        s.content = next;
        stripped++;
      }
    }
  }
  return stripped;
};

// ---------------------------------------------------------------------------
// 18. Parse notes-carried measure into unit (override quantity if needed)
// ---------------------------------------------------------------------------
//
// 124 ingredients survived with `quantity != null` but `unit == null`
// and a `notes` string that literally carries the real measure
// ("½ tbsp", "1/2 cup", "(400g) tin", "Juice of 1", etc.). The current
// quantity is stale — either set to 1 by the dedup pass or by an
// upstream parser fallback. We re-parse the notes, override the
// quantity, set the unit, and clear the notes (preserving residual
// context where the notes carried more than the measure).
//
// Dedup leftovers like "plus 1", "plus TO_TASTE", "plus GARNISH" carry
// no useful information for a single canonical entry — we just clear
// them since the quantity was already set on the original member.

const NOTE_UNIT_FROM_WORD: Record<string, string> = {
  cup: 'CUP', cups: 'CUP',
  tsp: 'TSP', teaspoon: 'TSP', teaspoons: 'TSP',
  tbsp: 'TBSP', tbs: 'TBSP', tablespoon: 'TBSP', tablespoons: 'TBSP',
  g: 'G', gram: 'G', grams: 'G',
  kg: 'KG', kilogram: 'KG', kilograms: 'KG',
  ml: 'ML', milliliter: 'ML', millilitre: 'ML', milliliters: 'ML', millilitres: 'ML',
  l: 'L', liter: 'L', litre: 'L', liters: 'L', litres: 'L',
  oz: 'OZ', ounce: 'OZ', ounces: 'OZ',
  lb: 'LB', pound: 'LB', pounds: 'LB',
};

const NOTE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const parseNumericPrefix = (s: string): number | null => {
  // Try Unicode fraction first (single char prefix).
  if (NOTE_FRACTIONS[s[0]] !== undefined) return NOTE_FRACTIONS[s[0]];
  // ASCII fraction "1/2"
  const frac = s.match(/^(\d+)\/(\d+)/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  // Integer or decimal
  const num = s.match(/^(\d+(?:\.\d+)?)/);
  if (num) return Number(num[1]);
  return null;
};

// Strip a leading "-" / en-dash that surfaced from range notation
// like "1/4-½ cups" where the splitter kept only the upper bound.
const stripLeadingDash = (s: string): string => s.replace(/^[-–—]\s*/, '').trim();

interface NoteParseStats {
  parsed: number;
  parenMass: number;
  juiceZest: number;
  dedupCleared: number;
}

const parseNotesIntoUnit = (recipes: Recipe[]): NoteParseStats => {
  const stats: NoteParseStats = { parsed: 0, parenMass: 0, juiceZest: 0, dedupCleared: 0 };
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      if (ing.unit != null || ing.quantity == null || !ing.notes) continue;
      const raw = ing.notes.trim();
      // Split on ";" — composite notes from dedup ("1/2 tsp; plus
      // TO_TASTE") keep only the first half; the rest is leftover.
      const phrase = stripLeadingDash(raw.split(';')[0].trim());

      // Dedup leftovers — clear and skip. "plus N", "plus TO_TASTE",
      // "plus GARNISH", "plus TO_SERVE" carry no info beyond what the
      // canonical entry already encodes.
      if (/^plus\s+/i.test(phrase)) {
        ing.notes = null;
        stats.dedupCleared++;
        continue;
      }

      // Parenthetical mass: "(460g)", "(400g) tin", "(12 oz.)"
      const parenMass = phrase.match(/^\((\d+(?:\.\d+)?)\s*(g|oz|ml|kg|l|lb)\.?\)(?:\s+(.+))?$/i);
      if (parenMass) {
        ing.quantity = Number(parenMass[1]);
        ing.unit = NOTE_UNIT_FROM_WORD[parenMass[2].toLowerCase()];
        ing.notes = parenMass[3]?.trim() || null;
        stats.parenMass++;
        continue;
      }

      // "Juice of N" / "Juice of N; ..." — quantity to N, PIECE, "juice" note.
      const juice = phrase.match(/^(juice|zest|juice\s+and\s+zest|zest\s+and\s+juice)\s+of\s+(\d+(?:\/\d+)?|½|¼|¾|⅓|⅔)(?:[;,].*)?$/i);
      if (juice) {
        const qty = parseNumericPrefix(juice[2]);
        if (qty != null) {
          ing.quantity = qty;
          ing.unit = 'PIECE';
          ing.notes = juice[1].toLowerCase();
          stats.juiceZest++;
          continue;
        }
      }

      // "X cups", "½ tbsp", "1/2 tsp", "400g Cans" (g is the unit,
      // "Cans" is a trailing descriptor we drop).
      const measure = phrase.match(/^(\d+(?:\/\d+)?|\d+(?:\.\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])\s*([a-z]+)\.?(?:\s+(.+))?$/i);
      if (measure) {
        const qty = parseNumericPrefix(measure[1]);
        const unit = NOTE_UNIT_FROM_WORD[measure[2].toLowerCase()];
        if (qty != null && unit) {
          ing.quantity = qty;
          ing.unit = unit;
          ing.notes = measure[3]?.trim() || null;
          stats.parsed++;
          continue;
        }
      }

      // Bare fraction with no unit ("1/2", "½") — set quantity but
      // leave unit null. Notes cleared since the fraction was the
      // entire payload.
      if (/^(\d+\/\d+|[½¼¾⅓⅔⅛⅜⅝⅞])$/.test(phrase)) {
        const qty = parseNumericPrefix(phrase);
        if (qty != null) {
          ing.quantity = qty;
          ing.notes = null;
          stats.parsed++;
          continue;
        }
      }

      // "X cups (X milliliters)" — primary measure outside parens.
      const dualMeasure = phrase.match(/^(\d+(?:\/\d+)?|[½¼¾⅓⅔])\s+(cups?|tbsp|tsp|tablespoon|teaspoon)\s*\([^)]+\)$/i);
      if (dualMeasure) {
        const qty = parseNumericPrefix(dualMeasure[1]);
        const unit = NOTE_UNIT_FROM_WORD[dualMeasure[2].toLowerCase()];
        if (qty != null && unit) {
          ing.quantity = qty;
          ing.unit = unit;
          ing.notes = null;
          stats.parsed++;
          continue;
        }
      }

      // "N-ounce can" / "14-ounce can" — hyphenated qty-unit with trailing
      // descriptor. The actual quantity is in the notes here, overriding
      // the stale field qty.
      const hyphenated = phrase.match(/^(\d+(?:\.\d+)?)-(\w+)(?:\s+(.+))?$/i);
      if (hyphenated) {
        const qty = Number(hyphenated[1]);
        const unit = NOTE_UNIT_FROM_WORD[hyphenated[2].toLowerCase()];
        if (Number.isFinite(qty) && unit) {
          ing.quantity = qty;
          ing.unit = unit;
          ing.notes = hyphenated[3]?.trim() || null;
          stats.parsed++;
          continue;
        }
      }

      // Unit-only notes ("ounce sliced") with quantity already in the
      // field — keep qty, set unit, demote the rest to notes.
      const unitOnly = phrase.match(/^(cup|cups|tsp|tbsp|tablespoon|teaspoon|g|kg|ml|l|oz|lb|ounce|pound|gram)s?\.?(?:\s+(.+))?$/i);
      if (unitOnly) {
        const unit = NOTE_UNIT_FROM_WORD[unitOnly[1].toLowerCase()];
        if (unit) {
          ing.unit = unit;
          ing.notes = unitOnly[2]?.trim() || null;
          stats.parsed++;
        }
      }
    }
  }
  return stats;
};

// ---------------------------------------------------------------------------
// 19. Default countable ingredients with null unit to PIECE (or CLOVE)
// ---------------------------------------------------------------------------
//
// 704 ingredients still have `quantity != null, unit == null, notes ==
// null` after every other pass. These are countable items where the
// upstream parser had only a number and no unit word — "1 egg", "4
// tomato", "1 bay_leaf". The schema's `unit MeasureUnit?` is nullable
// so this seeds fine, but defaulting to PIECE makes the data more
// uniform and the UI more legible. `garlic_clove` gets the dedicated
// CLOVE unit since the schema offers it.

const DEFAULT_UNIT_BY_NAME: Record<string, string> = {
  garlic_clove: 'CLOVE',
};

const defaultCountablesToPiece = (recipes: Recipe[]): number => {
  let defaulted = 0;
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      if (ing.unit != null || ing.quantity == null || ing.notes) continue;
      const name = ing.ingredientNormalizedName ?? '';
      ing.unit = DEFAULT_UNIT_BY_NAME[name] ?? 'PIECE';
      defaulted++;
    }
  }
  return defaulted;
};

// ---------------------------------------------------------------------------
// 21. Reclassify difficulty against the post-restoration median
// ---------------------------------------------------------------------------
//
// `clean-recipes.ts` originally bucketed each recipe's difficulty by
// comparing its complexity score (ingredients + 2 × steps, excluding
// flavour-only ingredients) against the median of all scores. After
// the Phase-2d step-list rewrites in step 13.5 (Tier 1/2/3 + 6
// recovery cases), many recipes have substantially more steps than at
// the original bucketing pass, so their stored `difficulty` values
// are stale.
//
// This pass replays the same formula on the current step counts and
// rewrites `difficulty` for every recipe whose bucket shifted; it
// also refreshes `stats.medianComplexityScore` and
// `stats.difficultyDistribution` so the snapshot remains internally
// consistent.

const FLAVOR_UNITS_FOR_SCORE = new Set(['TO_TASTE', 'TO_SERVE', 'GARNISH']);
const EASY_THRESHOLD_FRACTION = 0.8335;
const HARD_THRESHOLD_FRACTION = 1.1665;

const computeRecipeScore = (r: Recipe): number => {
  const meaningfulIngs = r.ingredients.filter(
    (i) => !FLAVOR_UNITS_FOR_SCORE.has(i.unit ?? ''),
  ).length;
  return meaningfulIngs + 2 * r.steps.length;
};

interface DifficultyReclassifyStats {
  reclassified: number;
  newMedian: number;
  newDistribution: Record<string, number>;
  shifts: Array<{ from: string; to: string; count: number }>;
}

const reclassifyDifficulty = (
  snap: { recipes: Recipe[]; stats?: { medianComplexityScore?: number; difficultyDistribution?: Record<string, number> } },
): DifficultyReclassifyStats => {
  const scored = snap.recipes.map((r) => ({ r, score: computeRecipeScore(r) }));
  const sorted = scored.map((x) => x.score).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const dist: Record<string, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
  const shiftMap = new Map<string, number>();
  let reclassified = 0;

  for (const { r, score } of scored) {
    const next =
      score < median * EASY_THRESHOLD_FRACTION
        ? 'EASY'
        : score > median * HARD_THRESHOLD_FRACTION
        ? 'HARD'
        : 'MEDIUM';
    dist[next]++;
    if (r['difficulty'] !== next) {
      const prev = String(r['difficulty'] ?? '(unset)');
      const key = `${prev}→${next}`;
      shiftMap.set(key, (shiftMap.get(key) ?? 0) + 1);
      r['difficulty'] = next;
      reclassified++;
    }
  }

  if (!snap.stats) snap.stats = {};
  snap.stats.medianComplexityScore = median;
  snap.stats.difficultyDistribution = dist;

  const shifts = Array.from(shiftMap.entries()).map(([k, count]) => {
    const [from, to] = k.split('→');
    return { from, to, count };
  });

  return { reclassified, newMedian: median, newDistribution: dist, shifts };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = (): void => {
  const recipesSnap = readJson<{ recipes: Recipe[]; [k: string]: unknown }>(RECIPES_FILE);
  const catalog = readJson<Catalog>(CATALOG_FILE);
  const mergeFile = readJson<{ candidates: MergeCandidate[]; [k: string]: unknown }>(MERGE_FILE);

  const damagedRecipesRestored = restoreDamagedRecipes(recipesSnap.recipes);
  const ingRewrites = rewriteIngredientNames(recipesSnap.recipes, mergeFile.candidates);
  const gruyereAdded = addGruyereCheese(catalog);
  const desertRenames = renameDesertTag(recipesSnap.recipes);
  const tagTypoRenames = renameMisspelledTags(recipesSnap.recipes);
  const stepsRewritten = applyStepRewrites(recipesSnap.recipes);
  const ingDuplicatesMerged = dedupRecipeIngredients(recipesSnap.recipes);
  const slugsRegenerated = regenerateSlugs(recipesSnap.recipes);
  const contentStats = normalizeStepContent(recipesSnap.recipes);
  const servesStepDropped = dropServesMetadataStep(recipesSnap.recipes);
  const unicodeFractionsParsed = parseUnicodeFractionNotes(recipesSnap.recipes);
  const phraseStats = mapFlavorPhraseNotes(recipesSnap.recipes);
  const titleCased = titleCaseLowercase(recipesSnap.recipes);
  const videoUrlsRestored = restoreLostVideoUrls(recipesSnap.recipes);
  const truncatedTitlesRewritten = rewriteTruncatedTitles(recipesSnap.recipes);
  const sectionHeadersRemoved = removeSectionHeaderSteps(recipesSnap.recipes);
  const titlesTrimmed = trimRecipeTitles(recipesSnap.recipes);
  const zeroWidthStripped = stripZeroWidthSpaces(recipesSnap.recipes);
  const leadingPunctStripped = stripLeadingPunctuation(recipesSnap.recipes);
  const noteStats = parseNotesIntoUnit(recipesSnap.recipes);
  const countablesDefaulted = defaultCountablesToPiece(recipesSnap.recipes);
  const difficultyStats = reclassifyDifficulty(
    recipesSnap as { recipes: Recipe[]; stats?: { medianComplexityScore?: number; difficultyDistribution?: Record<string, number> } },
  );

  writeJson(RECIPES_FILE, recipesSnap);
  writeJson(CATALOG_FILE, catalog);

  console.log('apply-residual-fixes.ts — done');
  console.log('  Damaged recipes restored from Phase-2d-style reconstruction:', damagedRecipesRestored);
  console.log('  Plural -> singular ingredient rewrites:', ingRewrites);
  console.log('  gruyere_cheese added to catalog:', gruyereAdded);
  console.log('  desert -> dessert tag renames:', desertRenames);
  console.log('  Misspelled tag renames (cheasy/haloween):', tagTypoRenames);
  console.log('  Recipes with steps rewritten:', stepsRewritten);
  console.log('  Duplicate ingredient entries merged:', ingDuplicatesMerged);
  console.log('  Slugs regenerated from title:', slugsRegenerated);
  console.log('  Curly apostrophes normalized in steps:', contentStats.aposFixed);
  console.log('  Curly double/single quotes normalized:', contentStats.curlyQuotesFixed);
  console.log('  Fraction-slash (U+2044) normalized to /:', contentStats.fractionSlashFixed);
  console.log('  Decorative smiley (U+263A) dropped:', contentStats.smileyDropped);
  console.log('  Single right angle quote (U+203A) replaced:', contentStats.angleQuoteReplaced);
  console.log('  Steps with double-spaces collapsed:', contentStats.doubleSpacedFixed);
  console.log('  Orphan "Serves N" step removed (52994):', servesStepDropped);
  console.log('  Unicode-fraction qty parsed from notes:', unicodeFractionsParsed);
  console.log('  Flavor-phrase notes -> TO_TASTE:', phraseStats.toTaste);
  console.log('  Flavor-phrase notes -> TO_SERVE:', phraseStats.toServe);
  console.log('  Flavor-phrase notes -> GARNISH:', phraseStats.garnish);
  console.log('  Flavor-phrase notes -> PIECE (juice/zest):', phraseStats.juiceZest);
  console.log('  Flavor-phrase notes -> PINCH (handful):', phraseStats.handful);
  console.log('  Flavor-phrase notes -> BUNCH (knob/sprigs/bunch):', phraseStats.bunch);
  console.log('  Lowercase titles capitalized:', titleCased);
  console.log('  Lost video URLs restored to videoUrl:', videoUrlsRestored);
  console.log('  Truncated step titles rewritten:', truncatedTitlesRewritten);
  console.log('  Section-header steps removed:', sectionHeadersRemoved);
  console.log('  Recipe titles trimmed:', titlesTrimmed);
  console.log('  Steps with zero-width space stripped:', zeroWidthStripped);
  console.log('  Steps with leading punctuation stripped:', leadingPunctStripped);
  console.log('  Notes-carried measures parsed -> unit:', noteStats.parsed);
  console.log('  Notes-carried parenthetical masses parsed:', noteStats.parenMass);
  console.log('  Notes-carried juice/zest parsed:', noteStats.juiceZest);
  console.log('  Dedup-leftover notes cleared (plus X):', noteStats.dedupCleared);
  console.log('  Countable ingredients defaulted to PIECE/CLOVE:', countablesDefaulted);
  console.log('  Difficulty reclassified after step rewrites:', difficultyStats.reclassified, '(median score', difficultyStats.newMedian + ')');
  console.log('    distribution:', JSON.stringify(difficultyStats.newDistribution));
  if (difficultyStats.shifts.length > 0) {
    console.log('    shifts:');
    for (const s of difficultyStats.shifts.sort((a, b) => b.count - a.count)) {
      console.log('      ', `${s.from} → ${s.to}: ${s.count}`);
    }
  }
};

main();
