/**
 * apply-flat-splits.ts — Phase 2c: Manual Re-Segmentation
 *
 * Replaces the single-step "flat-instructions" steps array of 21 recipes
 * with hand-written multi-step splits. These recipes' source instructions
 * lack the paragraph / numbered-line structure the parser relies on, so
 * clean-recipes.ts can only produce one big step per recipe; this script
 * fills the gap by carrying the editorial splits as a static override map.
 *
 * Run after `clean-recipes` whenever raw-recipes.json regenerates. The
 * script also drops patched recipes from the `reviewFlagged` array and
 * refreshes `stats.reviewFlagged` and `cleanedAt`.
 *
 * Run via: npm run apply-flat-splits
 */

import type {
  CleanRecipeRow,
  RecipeStepRow,
  RecipesCleanSnapshot,
} from './types.js';
import { readJsonFile, runMain, writeJsonFile } from './utils.js';

// Reads + writes clean-recipes.json (the pre-Phase-2d snapshot). The
// canonical recipes.json is hand-refined and intentionally NOT touched
// by the pipeline — see README Phase 2d.
const RECIPES_FILE = 'clean-recipes.json';

interface PatchStep {
  title: string;
  content: string;
}

/**
 * One entry per externalId. Steps replace the recipe's existing `steps`
 * array verbatim (order is re-assigned 1..N at apply time).
 *
 * Sourced from raw-recipes.json instructions, segmented at natural workflow
 * boundaries (heat → add → cook → finish → serve). Bread omelette (53076)
 * intentionally stays as a single step because the source literally says
 * only "Make and enjoy" — no content to split.
 */
const FLAT_OVERRIDES: Record<string, PatchStep[]> = {
  // Apricot & Turkish delight mess
  '53276': [
    {
      title: 'Whisk the Base',
      content:
        'Place the mascarpone, yogurt, sugar and orange flower water into a large bowl and whisk until thickened.',
    },
    {
      title: 'Fold and Serve',
      content:
        'Fold the remaining ingredients through, then divide the mix between 2 dessert glasses or bowls and decorate with extra mint, if you like.',
    },
  ],

  // Beetroot Soup (Borscht)
  '53078': [
    {
      title: 'Cook the Beetroot',
      content:
        'Chop the beetroot, add water and stock cube and cook for 15 mins.',
    },
    {
      title: 'Add the Other Ingredients',
      content: 'Add the other ingredients and boil until soft.',
    },
    {
      title: 'Add the Beans',
      content: 'Finally add the beans and cook for 5 mins.',
    },
    { title: 'Serve', content: 'Serve in the soup pot.' },
  ],

  // Bread omelette — genuinely a single instruction
  '53076': [{ title: 'Make and Enjoy', content: 'Make and enjoy.' }],

  // Burek
  '53060': [
    {
      title: 'Cook the Filling',
      content:
        'Fry the finely chopped onions and minced meat in oil. Add the salt and pepper.',
    },
    {
      title: 'Prepare the Tray',
      content:
        'Grease a round baking tray and put a layer of pastry in it.',
    },
    {
      title: 'Layer the Pastry and Filling',
      content:
        'Cover with a thin layer of filling and cover this with another layer of filo pastry which must be well coated in oil. Put another layer of filling and cover with pastry.',
    },
    {
      title: 'Bake and Serve',
      content:
        'When you have five or six layers, cover with filo pastry, bake at 200°C / 392°F for half an hour and cut in quarters and serve.',
    },
  ],

  // Chakchouka
  '52969': [
    {
      title: 'Heat the Oil',
      content:
        'In a large cast iron skillet or sauté pan with a lid, heat oil over medium high heat.',
    },
    {
      title: 'Sauté the Onion',
      content:
        'Add the onion and sauté for 2–3 minutes, until softened.',
    },
    {
      title: 'Add the Peppers and Garlic',
      content:
        'Add the peppers and garlic, and sauté for an additional 3–5 minutes.',
    },
    {
      title: 'Add the Tomatoes and Spices',
      content:
        'Add the tomatoes, cumin, paprika, salt, and chili powder. Mix well and bring the mixture to a simmer.',
    },
    {
      title: 'Simmer the Sauce',
      content:
        'Reduce the heat to medium low and continue to simmer, uncovered, 10–15 minutes until the mixture has thickened to your desired consistency. Taste the sauce at this point and adjust for salt and spice, as desired.',
    },
    {
      title: 'Add the Eggs',
      content:
        'Using the back of a spoon, make four craters in the mixture, large enough to hold an egg. Crack one egg into each of the craters.',
    },
    {
      title: 'Cook the Eggs',
      content:
        'Cover the skillet and simmer for 5–7 minutes, until the eggs have set.',
    },
    {
      title: 'Serve',
      content: 'Serve immediately with crusty bread or pita.',
    },
  ],

  // Chicken Alfredo Primavera
  '52796': [
    {
      title: 'Sear the Chicken',
      content:
        'Heat 1 tablespoon of butter and 2 tablespoons of olive oil in a large skillet over medium-high heat. Season both sides of each chicken breast with seasoned salt and a pinch of pepper. Add the chicken to the skillet and cook for 5–7 minutes on each side, or until cooked through.',
    },
    {
      title: 'Cook the Pasta',
      content:
        'While the chicken is cooking, bring a large pot of water to a boil. Season the boiling water with a few generous pinches of kosher salt. Add the pasta and give it a stir. Cook, stirring occasionally, until al dente, about 12 minutes. Reserve 1/2 cup of pasta water before draining the pasta.',
    },
    {
      title: 'Rest the Chicken',
      content:
        'Remove the chicken from the pan and transfer it to a cutting board; allow it to rest.',
    },
    {
      title: 'Sauté the Vegetables',
      content:
        'Turn the heat down to medium and add the remaining 1 tablespoon of butter and olive oil to the same pan you used to cook the chicken. Add the veggies (minus the garlic) and red pepper flakes to the pan and stir to coat with the oil and butter — refrain from seasoning with salt until the veggies are finished browning. Cook, stirring often, until the veggies are tender, about 5 minutes.',
    },
    {
      title: 'Add the Garlic',
      content:
        'Add the garlic and a generous pinch of salt and pepper to the pan and cook for 1 minute.',
    },
    {
      title: 'Deglaze with Wine',
      content:
        'Deglaze the pan with the white wine. Continue to cook until the wine has reduced by half, about 3 minutes.',
    },
    {
      title: 'Build the Sauce',
      content:
        'Stir in the milk, heavy cream, and reserved pasta water. Bring the mixture to a gentle boil and allow to simmer and reduce for 2–3 minutes.',
    },
    {
      title: 'Finish and Serve',
      content:
        'Turn off the heat and add the Parmesan cheese and cooked pasta. Season with salt and pepper to taste. Garnish with Parmesan cheese and chopped parsley, if desired.',
    },
  ],

  // Chorizo, potato & cheese omelette
  '53159': [
    {
      title: 'Boil the Potato',
      content:
        'Cook the potato in boiling water for 8–10 mins or until tender. Drain and allow to steam-dry.',
    },
    {
      title: 'Cook the Chorizo and Potato',
      content:
        'Heat oil in an omelette pan, add chorizo and cook for 2 mins. Add the potato and cook for a further 5 mins until the potato starts to crisp.',
    },
    {
      title: 'Cook the Omelette',
      content:
        'Spoon pan contents out, wipe pan and cook a 2- or 3-egg omelette in the same pan.',
    },
    {
      title: 'Fill and Fold',
      content:
        'When almost cooked, scatter with the chorizo and potato, parsley and cheese. Fold the omelette in the pan and cook for 1 min more to melt the cheese.',
    },
  ],

  // Cream Cheese Tart
  '52779': [
    {
      title: 'Make the Crust',
      content:
        'Make a dough from 250 g flour (a mix of plain and wholegrain spelt flour works well), 125 g butter, 1 egg and a pinch of salt. Press it into a tart form and place it in the fridge.',
    },
    {
      title: 'Make the Filling',
      content:
        'Stir 300 g cream cheese and 100 ml milk until smooth. Add 3 eggs, 100 g grated parmesan cheese and season with salt, pepper and nutmeg.',
    },
    {
      title: 'Bake the Tart',
      content:
        'Take the crust out of the fridge and prick the bottom with a fork. Pour in the filling and bake at 175°C for about 25 minutes. Cover the tart with aluminium foil after half the time.',
    },
    {
      title: 'Marinate the Tomatoes',
      content:
        'Meanwhile, slice about 350 g mini tomatoes. In a small pan heat 3 tbsp olive oil, 3 tbsp white vinegar, 1 tbsp honey, salt and pepper and combine well. Pour over the tomato slices and mix well.',
    },
    {
      title: 'Top and Serve',
      content:
        'With a spoon, place the tomato slices on the tart, avoiding too much liquid. Decorate with basil leaves and enjoy.',
    },
  ],

  // Croatian Bean Stew
  '53058': [
    {
      title: 'Sauté the Vegetables',
      content:
        'Heat the oil in a pan. Add the chopped vegetables and sauté until tender.',
    },
    {
      title: 'Combine and Cook',
      content:
        'Take a pot, empty the beans together with the vegetables into it, put the sausages inside and cook for a further 20 minutes on a low heat.',
    },
    {
      title: 'Or Bake in the Oven',
      content:
        'Alternatively, put it in an oven and bake it at 180°C / 350°F for 30 minutes.',
    },
    {
      title: 'Best Reheated',
      content: 'This dish is even better reheated the next day.',
    },
  ],

  // Fettuccine Alfredo
  '53064': [
    {
      title: 'Cook the Pasta',
      content:
        'Cook pasta according to package instructions in a large pot of boiling water and salt.',
    },
    {
      title: 'Heat Cream and Butter',
      content:
        'Add heavy cream and butter to a large skillet over medium heat until the cream bubbles and the butter melts.',
    },
    {
      title: 'Whisk in Parmesan',
      content:
        'Whisk in parmesan and add seasoning (salt and black pepper).',
    },
    {
      title: 'Combine with Pasta',
      content:
        'Let the sauce thicken slightly and then add the pasta and toss until coated in sauce.',
    },
    {
      title: 'Garnish and Serve',
      content: "Garnish with parsley, and it's ready.",
    },
  ],

  // Fresh sardines
  '53061': [
    {
      title: 'Wash the Fish',
      content: 'Wash the fish under the cold tap.',
    },
    {
      title: 'Fry the Sardines',
      content: 'Roll in the flour and deep fry in oil until crispy.',
    },
    {
      title: 'Drain and Serve',
      content:
        'Lay on kitchen towel to get rid of the excess oil and serve hot or cold with a slice of lemon.',
    },
  ],

  // Mushroom soup with buckwheat
  '53059': [
    {
      title: 'Prepare the Ingredients',
      content:
        'Chop the onion and garlic, slice the mushrooms and wash the buckwheat.',
    },
    {
      title: 'Sauté the Onion',
      content: 'Heat the oil and lightly sauté the onion.',
    },
    {
      title: 'Add Mushrooms and Garlic',
      content:
        'Add the mushrooms and the garlic and continue to sauté.',
    },
    {
      title: 'Add Buckwheat and Simmer',
      content:
        'Add the salt, vegetable seasoning, buckwheat and the bay leaf and cover with water.',
    },
    {
      title: 'Finish with Sour Cream',
      content:
        'Simmer gently and, just before it is completely cooked, add pepper, sour cream mixed with flour, the chopped parsley and vinegar to taste.',
    },
  ],

  // Potato Gratin with Chicken
  '52780': [
    {
      title: 'Slice and Boil the Potatoes',
      content:
        'Use 800 g of potatoes, finely slice and boil in a pan for about 5–8 mins till firmish, not soft.',
    },
    {
      title: 'Cook the Onions',
      content:
        'Finely slice 3 onions and place in an oven dish with 2 tbsp of olive oil and 100 ml of chicken stock. Cook till the onions are soft.',
    },
    {
      title: 'Combine Potatoes and Onions',
      content:
        'Drain the potatoes and pour onto the onions. Season and spoon over cream or crème fraîche till all is covered but not swimming.',
    },
    {
      title: 'Top and Grill',
      content:
        'Grate Parmesan over the top, then finish under the grill till nicely golden.',
    },
    {
      title: 'Serve',
      content: 'Serve with chicken and bacon, peas and spinach.',
    },
  ],

  // Quick gazpacho
  '53173': [
    {
      title: 'Blend the Ingredients',
      content:
        'In a blender (or with a stick blender), whizz together the passata, red pepper, chilli, garlic, sherry vinegar and lime juice until smooth.',
    },
    {
      title: 'Season and Serve',
      content: 'Season to taste, then serve with ice cubes.',
    },
  ],

  // Red curry chicken kebabs
  '53204': [
    {
      title: 'Prep the Grill',
      content: 'Fire up the barbecue or heat a griddle pan to high.',
    },
    {
      title: 'Marinate the Chicken',
      content:
        'Tip chicken, curry paste and coconut milk into a bowl, then mix well until the chicken is evenly coated.',
    },
    {
      title: 'Thread the Skewers',
      content: 'Thread vegetables and chicken onto skewers.',
    },
    {
      title: 'Cook the Kebabs',
      content:
        'Cook the skewers on the barbecue or griddle for 5–8 mins, turning every so often, until the chicken is cooked through and charred.',
    },
    {
      title: 'Serve',
      content:
        'Serve with herby rice, salad and a lime half to squeeze over.',
    },
  ],

  // Tangy carrot, cabbage & onion salad
  '53246': [
    {
      title: 'Combine the Vegetables',
      content: 'Tip the carrots, cabbage and onions into a bowl.',
    },
    {
      title: 'Make the Dressing',
      content:
        'Make the dressing by stirring the ingredients together until the sugar has dissolved.',
    },
    {
      title: 'Dress the Salad',
      content:
        'Pour over salad, tossing the vegetables in the dressing.',
    },
    {
      title: 'Add Herbs and Peanuts',
      content:
        'Add the herbs, toss again, then scatter over the peanuts.',
    },
  ],

  // Thai beef stir-fry
  '53199': [
    {
      title: 'Heat the Wok',
      content: 'Heat a wok or large frying pan until smoking hot.',
    },
    {
      title: 'Sear the Beef',
      content:
        'Pour in the oil and swirl around the pan, then tip in the beef strips and chilli.',
    },
    {
      title: 'Cook with Oyster Sauce',
      content:
        'Cook, stirring all the time, until the meat is lightly browned, about 3 mins, then pour over the oyster sauce. Cook until heated through and the sauce coats the meat.',
    },
    {
      title: 'Finish and Serve',
      content:
        'Stir in the basil leaves and serve with plain rice.',
    },
  ],

  // Tofu, greens & cashew stir-fry
  '53240': [
    {
      title: 'Heat the Wok',
      content: 'Heat the oil in a non-stick wok.',
    },
    {
      title: 'Fry the Broccoli',
      content:
        'Add the broccoli, then fry on a high heat for 5 mins or until just tender, adding a little water if it begins to catch.',
    },
    {
      title: 'Add Aromatics and Greens',
      content:
        'Add the garlic and chilli, fry for 1 min, then toss through the spring onions, soya beans, pak choi and tofu. Stir-fry for 2–3 mins.',
    },
    {
      title: 'Finish with Sauce and Nuts',
      content: 'Add the hoisin, soy and nuts to warm through.',
    },
  ],

  // Vegan Chocolate Cake
  '52794': [
    {
      title: 'Mix the Batter',
      content:
        'Simply mix all dry ingredients with wet ingredients and blend altogether.',
    },
    { title: 'Bake', content: 'Bake for 45 min at 180°C.' },
    {
      title: 'Decorate',
      content: 'Decorate with some melted vegan chocolate.',
    },
  ],

  // Vegetarian Chilli
  '52867': [
    {
      title: 'Preheat the Oven',
      content: 'Heat oven to 200°C / 180°C fan / gas 6.',
    },
    {
      title: 'Cook the Vegetables',
      content: 'Cook the vegetables in a casserole dish for 15 mins.',
    },
    {
      title: 'Add Beans and Tomatoes',
      content:
        'Tip in the beans and tomatoes, season, and cook for another 10–15 mins until piping hot.',
    },
    {
      title: 'Warm and Serve',
      content:
        'Heat the pouch in the microwave on High for 1 min and serve with the chilli.',
    },
  ],

  // Vietnamese-style veggie hotpot
  '53236': [
    {
      title: 'Heat the Oil',
      content: 'Heat the oil in a medium-size, lidded saucepan.',
    },
    {
      title: 'Stir-Fry the Aromatics',
      content:
        'Add the ginger and garlic, then stir-fry for about 5 mins.',
    },
    {
      title: 'Simmer the Squash',
      content:
        'Add the squash, soy sauce, sugar and stock. Cover, then simmer for 10 mins.',
    },
    {
      title: 'Add the Green Beans',
      content:
        'Remove the lid, add the green beans, then cook for 3 mins more until the squash and beans are tender.',
    },
    {
      title: 'Finish and Serve',
      content:
        'Stir the spring onions through at the last minute, then sprinkle with coriander and serve with rice.',
    },
  ],
};

// ─── Apply ──────────────────────────────────────────────────────────────────

const main = (): void => {
  console.log('🪡 apply-flat-splits — Phase 2c: Manual Re-Segmentation');
  console.log('');

  const snapshot = readJsonFile<RecipesCleanSnapshot>(
    RECIPES_FILE,
    'Run clean-recipes first.',
  );

  let patched = 0;
  let stepsDelta = 0;
  let missing = 0;

  for (const [externalId, patch] of Object.entries(FLAT_OVERRIDES)) {
    const recipe = snapshot.recipes.find(
      (r: CleanRecipeRow) => r.externalId === externalId,
    );
    if (!recipe) {
      console.log(`   ⚠ ${externalId} not found in ${RECIPES_FILE} — skipped`);
      missing++;
      continue;
    }

    const oldCount = recipe.steps.length;
    const newSteps: RecipeStepRow[] = patch.map((s, i) => ({
      order: i + 1,
      title: s.title,
      content: s.content,
    }));
    recipe.steps = newSteps;
    stepsDelta += newSteps.length - oldCount;
    patched++;

    console.log(
      `   ✓ ${externalId} · ${recipe.title.trim()} — ${oldCount} → ${newSteps.length} steps`,
    );
  }

  const patchedIds = new Set(Object.keys(FLAT_OVERRIDES));
  const flaggedBefore = snapshot.reviewFlagged.length;
  snapshot.reviewFlagged = snapshot.reviewFlagged.filter(
    (f) => !patchedIds.has(f.externalId),
  );
  snapshot.stats.reviewFlagged = snapshot.reviewFlagged.length;
  snapshot.cleanedAt = new Date().toISOString();

  console.log('');
  console.log(
    `📊 Patched ${patched} recipes (${stepsDelta >= 0 ? '+' : ''}${stepsDelta} steps).`,
  );
  console.log(
    `   Review-flagged: ${flaggedBefore} → ${snapshot.reviewFlagged.length}`,
  );
  if (missing > 0) console.log(`   Missing: ${missing}`);
  console.log('');
  writeJsonFile(RECIPES_FILE, snapshot);
};

runMain('apply-flat-splits', main);
