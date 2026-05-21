/**
 * utils.ts — Shared helpers for the TheMealDB research scripts.
 *
 * Every public export is pure and importable without side effects. Path
 * helpers use `import.meta.dirname` of THIS file, so they resolve relative
 * to `research/the-meal-db/` regardless of which script calls them — true
 * as long as utils.ts and the scripts that import it stay co-located.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────────────────────
// Paths + file I/O
// ────────────────────────────────────────────────────────────────────────────

/** Absolute path to a file inside `research/the-meal-db/`. */
export const dataPath = (filename: string): string =>
  path.resolve(import.meta.dirname, filename);

/**
 * Reads and parses a JSON snapshot from the script directory. Throws with
 * a friendly hint when the file is missing (e.g. "Run fetch-catalog first.").
 */
export const readJsonFile = <T>(filename: string, runHint?: string): T => {
  const fullPath = dataPath(filename);
  if (!fs.existsSync(fullPath)) {
    const tail = runHint ? `\n${runHint}` : '';
    throw new Error(`${filename} not found at ${fullPath}${tail}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as T;
};

/**
 * Writes a JSON snapshot (pretty-printed, UTF-8) to the script directory
 * and prints a uniform "📁 Written to: …" line.
 */
export const writeJsonFile = (filename: string, data: unknown): void => {
  const fullPath = dataPath(filename);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`📁 Written to: ${fullPath}`);
};

// ────────────────────────────────────────────────────────────────────────────
// String normalization
// ────────────────────────────────────────────────────────────────────────────

/**
 * Snake-case slug for ingredient names. Strips diacritics, drops
 * non-alphanumeric characters, collapses whitespace runs to single
 * underscores. Stable across the catalog and recipes pipelines so the
 * same raw ingredient string always maps to the same key.
 */
export const normalizeIngredientName = (name: string): string =>
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

/**
 * Normalizes prose text (instructions, descriptions) for storage:
 * line-ending conversion, three-or-more newlines collapsed to a blank
 * line, per-line leading/trailing whitespace stripped, outer trim.
 * Returns null when input is null or empty.
 */
export const cleanProseWhitespace = (raw: string | null): string | null => {
  if (!raw) return null;
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
};

// ────────────────────────────────────────────────────────────────────────────
// Misc helpers
// ────────────────────────────────────────────────────────────────────────────

/** Promise-based delay, e.g. for rate-limiting between HTTP requests. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a script's `main` function with standard error handling. Supports
 * both sync and async mains. On failure: prints "❌ <scriptName> failed: …"
 * and exits with code 1. Replaces the boilerplate
 * `main().catch(err => { ... process.exit(1) })` at the bottom of each
 * script with a single `runMain('script-name', main)` call.
 */
export const runMain = (
  scriptName: string,
  main: () => void | Promise<void>,
): void => {
  Promise.resolve()
    .then(() => main())
    .catch((err: unknown) => {
      console.error(`❌ ${scriptName} failed:`, err);
      process.exit(1);
    });
};

// ────────────────────────────────────────────────────────────────────────────
// TheMealDB API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the TheMealDB premium API base URL built from the
 * `THEMEALDB_API_KEY` env var. Throws if the var is unset — fetch scripts
 * call this once at startup to fail fast.
 */
export const themealdbBaseUrl = (): string => {
  const apiKey = process.env['THEMEALDB_API_KEY'];
  if (!apiKey) throw new Error('Missing env var: THEMEALDB_API_KEY');
  return `https://www.themealdb.com/api/json/v2/${apiKey}`;
};
