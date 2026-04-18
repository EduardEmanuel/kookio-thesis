/**
 * generate-merge-candidates.ts — Phase 1a.2: Generate Merge Candidates
 *
 * Analyzes raw-catalog.json and detects plural→singular candidate pairs.
 * Writes merge-candidates.json for manual review.
 *
 * Actions:
 *   MERGE  — both plural and singular exist in catalog; plural will be removed
 *   RENAME — only plural exists; will be renamed to singular
 *
 * After generation, open merge-candidates.json and set approve: true/false
 * for each entry, then run clean-catalog.
 *
 * Run via: npm run generate-candidates
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CatalogSnapshot, MergeCandidatesFile, MergeCandidate } from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CATALOG_PATH = path.resolve(import.meta.dirname, 'raw-catalog.json');
const OUTPUT_PATH = path.resolve(import.meta.dirname, 'merge-candidates.json');

// ---------------------------------------------------------------------------
// Detection rules
// ---------------------------------------------------------------------------

/**
 * Each rule checks if a normalizedName matches a plural pattern
 * and computes the expected singular form.
 */
const PLURAL_RULES: Array<{
  test: (n: string) => boolean;
  toSingular: (n: string) => string;
}> = [
  // _leaves → _leaf
  {
    test: (n) => n.endsWith('_leaves'),
    toSingular: (n) => n.replace(/_leaves$/, '_leaf'),
  },
  // _seeds → _seed
  {
    test: (n) => n.endsWith('_seeds'),
    toSingular: (n) => n.replace(/_seeds$/, '_seed'),
  },
  // _flakes → _flake
  {
    test: (n) => n.endsWith('_flakes'),
    toSingular: (n) => n.replace(/_flakes$/, '_flake'),
  },
  // silent-e plural: consonant + es → consonant + e  (cloves→clove, noodles→noodle)
  // Excludes: -ches (peaches→peach handled differently), -sses (molasses has no singular)
  {
    test: (n) => /[^aeiou]es$/.test(n) && !n.endsWith('ess') && !n.endsWith('ches') && !n.endsWith('sses'),
    toSingular: (n) => n.slice(0, -1),
  },
  // simple plural: ends with s (not vowel+s, not ss)
  {
    test: (n) => n.endsWith('s') && !n.match(/[aeiou]s$/) && !n.endsWith('ss'),
    toSingular: (n) => n.slice(0, -1),
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = (): void => {
  console.log('🔍 generate-merge-candidates — Phase 1a.2');
  console.log('');

  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`raw-catalog.json not found at ${CATALOG_PATH}\nRun fetch-catalog first.`);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as CatalogSnapshot;
  const allNames = new Set(catalog.ingredients.map((i) => i.normalizedName));

  const candidates: MergeCandidate[] = [];

  for (const ing of catalog.ingredients) {
    const n = ing.normalizedName;

    for (const rule of PLURAL_RULES) {
      if (!rule.test(n)) continue;

      const singular = rule.toSingular(n);
      if (singular === n) continue; // no change

      const action: 'MERGE' | 'RENAME' = allNames.has(singular) ? 'MERGE' : 'RENAME';

      candidates.push({
        plural: n,
        pluralName: ing.name,
        singular,
        action,
        approve: null,
        note: action === 'MERGE'
          ? `${singular} already exists in catalog`
          : '',
      });

      break; // first matching rule wins per ingredient
    }
  }

  const output: MergeCandidatesFile = {
    generatedAt: new Date().toISOString().slice(0, 10),
    legend: {
      MERGE: 'Both plural and singular exist — plural will be removed, singular kept',
      RENAME: 'Only plural exists — will be renamed to singular, no removal',
    },
    candidates,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  const mergeCount = candidates.filter((c) => c.action === 'MERGE').length;
  const renameCount = candidates.filter((c) => c.action === 'RENAME').length;

  console.log(`📊 Results:`);
  console.log(`   Total candidates: ${candidates.length}`);
  console.log(`   MERGE:            ${mergeCount}`);
  console.log(`   RENAME:           ${renameCount}`);
  console.log('');
  console.log(`📁 Written to: ${OUTPUT_PATH}`);
  console.log('');
  console.log('👉 Next: review merge-candidates.json (set approve: true/false), then run clean-catalog');
};

main();