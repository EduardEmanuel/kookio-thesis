/**
 * clean-catalog.ts — Phase 1b: Clean & Normalize
 *
 * Reads raw-catalog.json and merge-candidates.json, applies approved
 * transformations, and writes catalog.json.
 *
 * Transformations applied:
 *   RENAME — renames plural normalizedName to singular (no removal)
 *   MERGE  — removes plural entry; recipes will reference singular
 *
 * Also applies:
 *   - \r\n → \n cleanup on all description fields
 *   - excess whitespace trimming on descriptions
 *   - auto-categorization based on ingredient name
 *
 * Run via: npm run clean-catalog
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CatalogSnapshot,
  IngredientCatalogRow,
  IngredientCategory,
  MergeCandidatesFile,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CATALOG_PATH = path.resolve(import.meta.dirname, 'raw-catalog.json');
const CANDIDATES_PATH = path.resolve(import.meta.dirname, 'merge-candidates.json');
const OUTPUT_PATH = path.resolve(import.meta.dirname, 'catalog.json');

// ---------------------------------------------------------------------------
// Auto-categorization
// ---------------------------------------------------------------------------

/**
 * Maps ingredient normalizedName patterns to IngredientCategory enum values.
 * Order matters — first match wins.
 */
const CATEGORY_RULES: Array<{ patterns: RegExp; category: IngredientCategory }> = [
  // MEAT — includes processed/exotic cuts and typos
  {
    patterns: /\b(beef|chicken|pork|lamb|veal|turkey|duck|venison|bacon|ham|sausages?|mince|brisket|steak|ribs?|lard|pancetta|prosciutto|chorizo|salami|pepperoni|doner|goat|tripe|oxtail|morcilla|kabanos?|kielbasa|jerk|black pudding|chuck roast|hind shank|shredded meat|jamon|iberico|meatball)\b/,
    category: 'MEAT',
  },
  // FISH — includes shellfish, variants and plural forms
  {
    patterns: /\b(salmon|tuna|cod|shrimps?|prawns?|crab|lobster|anchovies?|anchovy|sardines?|pilchards?|mackerel|trout|tilapia|halibut|bass|haddock|clams?|mussels?|oysters?|scallops?|squid|octopus|seafood|fish|barramundi|hake|monkfish|snapper|herring|king prawns?|tiger prawns?|raw king|raw tiger|raw frozen)\b/,
    category: 'FISH',
  },
  // DAIRY — includes cheeses, chocolate and typos like parmigianoreggiano
  {
    patterns: /\b(milk|cream|butter|cheeses?|yogurts?|yoghurt|eggs?|cheddar|mozzarella|parmesan|parmigiano|reggiano|parmigianoreggiano|brie|ricotta|mascarpone|ghee|kefir|whey|custard|feta|pecorino|gruyere|manchego|paneer|fromage|creme fraiche|buttermilk|chocolates?|cocoa|cacao|malai|gelatine|gelatin)\b/,
    category: 'DAIRY',
  },
  // HERBS — fresh/dried herbs and leaves
  {
    patterns: /\b(basil|parsley|cilantro|coriander leaf|mint|thyme|rosemary|oregano|sage|dill|tarragon|chives?|bay leaf|marjoram|lemongrass|sorrel|lovage|savory|bouquet|chervil|galangal|dried leaves|summer savoury)\b/,
    category: 'HERBS',
  },
  // SPICES — ground spices, spice blends, chillies, dried chillies
  {
    patterns: /\b(peppers?|chillis?|chillies|chili|cumins?|turmeric|paprika|cinnamon|cardamom|cardomom|cloves?|nutmeg|gingers?|saffron|anise|fennel seed|coriander seed|mustard seed|fenugreek|allspice|cayenne|sumac|spices?|seasonings?|flakes?|powders?|masala|garam|biryani|cajun|caraway|peppercorns?|annatto|sazon|ras el hanout|pul biber|szechuan|birdseye|dried chilli|dried red chilli|dried chillies|dried red chillies|ancho|scotch bonnet|jalapeno|coriander|khus khus|poppy seed|ground poppy|mixed spice|ground poppy seed|hail)\b/,
    category: 'SPICES',
  },
  // NUTS — includes seeds used as nuts and nut products
  {
    patterns: /\b(almonds?|flaked almond|ground almond|walnuts?|cashews?|pistachios?|pecans?|hazelnuts?|hazlenuts?|peanuts?|pine nuts?|macadamia|chestnuts?|coconuts?|sesame|tahini|nuts?)\b/,
    category: 'NUTS',
  },
  // SWEETS — processed desserts, confections, and industrial sweet products
  {
    patterns: /\b(christmas pudding|meringue|marshmallows?|popcorn|mars bar|turkish delight|candy|sweets?|confection|fudge|toffee|nougat|praline|fondant|marzipan|dried apricots?|dried cherr\w*)\b/,
    category: 'SWEETS',
  },
  // LEGUMES — beans, peas, lentils, soy products (plural forms explicit)
  {
    patterns: /\b(borlotti|cannellini|chickpeas?|haricot|kidney beans?|pinto|black beans?|broad beans?|lentils?|brown lentil|french lentil|green red lentil|toor dal|refried|baked beans?|dal|fermented black beans?|yellow split pea|dried white beans?|dried white navy beans?|navy beans?|runner beans?|green beans?|snow pea|sugar snap|split peas?|petit pois|peas?|frozen peas|bean sprouts?|mung bean sprouts?|mung bean|soya bean|chinese long beans?|tofu|silken tofu|marinated tofu|tempeh|edamame|falafel|hummus)\b/,
    category: 'LEGUMES',
  },
  // GRAINS — flour, pasta, bread, cereals, starches, baked goods
  {
    patterns: /\b(flours?|rices?|pastas?|breads?|wheat|oats?|oatmeal|rolled oat|porridge oat|barley|rye|corns?|maize|noodles?|udon|couscous|quinoa|bulgur|semolina|polenta|crumbs?|breadcrumbs?|biscuits?|digestive|crackers?|tortillas?|pita|grains?|cereals?|spaghetti|farfalle|macaroni|lasagne|penne|rigatoni|tagliatelle|fettuccine|fideo|cornstarch|cornmeal|yeast|buckwheat|pretzels?|muffins?|english muffin|baguette|ciabatta|pastry|dough|shortcrust|puff|filo|phyllo|suet|shortening|wonton|hard taco|taco shell|toast|bun|fries|freekeh|masarepa|casabe|tequenos|sevaiiya|starch|potato starch)\b/,
    category: 'GRAINS',
  },
  // CONDIMENTS — oils, sauces, sugars, sweeteners, pastes, preserves
  {
    patterns: /\b(oils?|vinegars?|sauces?|ketchup|mustards?|mayonnaise|worcestershire|tabasco|sriracha|miso|pastes?|stocks?|broth|bouillon|extracts?|syrups?|honey|jams?|pickles?|relish|dressings?|marinade|sugars?|caster sugar|brown sugar|icing sugar|powdered sugar|granulated sugar|coco sugar|dark brown sugar|treacle|black treacle|molasses|vanilla|caramel|dulce de leche|mirin|sake|passata|salsas?|aioli|pomegranate molasses|doubanjiang|gochujang|hotsauce|horseradish|bicarbonate|baking soda|salts?|sea salt|kosher salt|celery salt|goose fat|tomato puree|tamarind|mincemeat|nutella|stroop|papelon|sauerkraut|white sauerkraut|capers?|olives?|green olive|black olive|pitted black olive|mixed peel|candied peel|food colouring|colouring|sultanas?|raisins?|currants?|dried cranberr|grand marnier|cranberries?|cranberry)\b/,
    category: 'CONDIMENTS',
  },
  // BEVERAGES
  {
    patterns: /\b(wines?|beers?|whiskeys?|rum|vodka|gin|brandys?|liqueurs?|juices?|waters?|teas?|coffees?|ciders?|ales?|stouts?|ports?|sherrys?|sherry|sake|mirin|grand marnier)\b/,
    category: 'BEVERAGES',
  },
  // PRODUCE — vegetables and fruits (catch-all, placed last)
  {
    patterns: /\b(tomatoes?|tomato|potatoes?|onions?|garlics?|carrots?|celerys?|lettuces?|spinach|kale|cabbages?|broccoli|cauliflower|zucchini|courgettes?|cucumbers?|aubergine|mushrooms?|leeks?|asparagus|artichokes?|beets?|beetroot|radish|turnips?|parsnip|fennels?|avocados?|apples?|bananas?|oranges?|lemons?|limes?|berrys?|berries|strawberries|raspberries|blueberries|blackberries|mangos?|pineapples?|peaches?|pears?|plums?|grapes?|cherries?|cherry|glace cherry|melons?|figs?|apricots?|fruits?|vegetables?|sweet potato|swede|celeriac|pumpkin|squash|butternut|rhubarb|prunes?|spring onion|shallots?|challots?|red onion|rocket|sweetcorn|pak choi|bok choi|baby pak|bamboo|jerusalem artichoke|vine tomato|baby new potato|jersey royal|charlotte potato|floury potato|small potato|new potato|russet potato|sundried|canned tomato|chopped tomato|diced tomato|tinned tomatos?|pomegranates?|cranberries?|medjool|stoned date|pitted date|saskatoon|callaloo|cassaba|yautia|yam|plantain|ackee|okra|brussels sprouts?|braeburn|bramley|padron|vine leaf|bay leaf|green beans?|broad beans?|runner beans?|scallions?|chinese leaf|mulukhiyah|knafeh|redcurrants?|mixed peel|baby pak koi|avacado|stoned dates?|pitted dates?)\b/,
    category: 'PRODUCE',
  },
];

const autoCategory = (normalizedName: string): IngredientCategory | null => {
  const searchable = normalizedName.replace(/_/g, ' ');
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.test(searchable)) {
      return rule.category;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Description cleaner
// ---------------------------------------------------------------------------

const cleanDescription = (desc: string | null): string | null => {
  if (!desc) return null;
  return desc
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = (): void => {
  console.log('🧹 clean-catalog — Phase 1b: Clean & Normalize');
  console.log('');

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as CatalogSnapshot;
  const { candidates } = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf-8')) as MergeCandidatesFile;

  const approved = candidates.filter((c) => c.approve === true);
  const mergeMap = new Map<string, string>();
  const renameMap = new Map<string, string>();

  for (const c of approved) {
    if (c.action === 'MERGE') mergeMap.set(c.plural, c.singular);
    if (c.action === 'RENAME') renameMap.set(c.plural, c.singular);
  }

  console.log(`📋 Approved transformations:`);
  console.log(`   MERGE:  ${mergeMap.size} (plural removed, singular kept)`);
  console.log(`   RENAME: ${renameMap.size} (plural renamed to singular)`);
  console.log('');

  let categorized = 0;
  let uncategorized = 0;
  const cleanedIngredients: IngredientCatalogRow[] = [];

  for (const ing of catalog.ingredients) {
    const n = ing.normalizedName;

    if (mergeMap.has(n)) {
      console.log(`   🔀 MERGE:  "${ing.name}" → removed (using "${mergeMap.get(n)}")`);
      continue;
    }

    let normalizedName = n;
    let name = ing.name;

    if (renameMap.has(n)) {
      const newNormalized = renameMap.get(n)!;
      const newName = newNormalized
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      console.log(`   ✏️  RENAME: "${name}" → "${newName}"`);
      normalizedName = newNormalized;
      name = newName;
    }

    const category = autoCategory(normalizedName);
    if (category) categorized++;
    else uncategorized++;

    cleanedIngredients.push({
      ...ing,
      name,
      normalizedName,
      description: cleanDescription(ing.description),
      category,
    });
  }

  console.log('');
  console.log(`📊 Ingredient processing results:`);
  console.log(`   Original:         ${catalog.ingredients.length}`);
  console.log(`   Merged (removed): ${mergeMap.size}`);
  console.log(`   Renamed:          ${renameMap.size}`);
  console.log(`   Final count:      ${cleanedIngredients.length}`);
  console.log(`   Categorized:      ${categorized}`);
  console.log(`   Uncategorized:    ${uncategorized} → category: null`);
  console.log('');

  const cleanSnapshot = {
    fetchedAt: catalog.fetchedAt,
    cleanedAt: new Date().toISOString(),
    source: catalog.source,
    categories: catalog.categories.map((c) => ({
      ...c,
      description: cleanDescription(c.description),
    })),
    areas: catalog.areas,
    ingredients: cleanedIngredients,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cleanSnapshot, null, 2), 'utf-8');

  console.log(`📁 Written to: ${OUTPUT_PATH}`);
  console.log('');
  console.log('👉 Next: review catalog.json, then copy to kookio seed-data/');
};

main();