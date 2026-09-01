#!/usr/bin/env bun
// Bundle size budgets per entry point.
//
// Sizes matter here in a specific way: the whole point of splitting into subpaths is
// that a consumer using only the core does not pay for React, Vue, or the DOM
// patcher. A budget is how that promise stays true — an accidental import from
// `core/index.ts` into an adapter, or the reverse, shows up as a jump here rather
// than in someone's bundle analyzer months later.
//
// Requires a build first. Usage: bun scripts/check-size.ts [--update]

import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const DIST = join(REPO_ROOT, 'dist');

/**
 * Budgets in gzipped bytes, set from measured sizes with roughly 20% headroom.
 *
 * The shared bulk is the scene builder — geometry, theme, text metrics, asset
 * resolution, runtime, and the element converters — which every rendering path needs
 * and which no adapter can avoid. What each adapter *can* avoid is zod, and the
 * budgets are tight enough that a document-parsing import creeping into a rendering
 * path shows up here as a ~9KB jump.
 */
const BUDGETS: Record<string, { file: string; gzipBudget: number; note: string }> = {
  core: {
    file: 'core/index.js',
    gzipBudget: 39_500,
    note: 'everything, zod included — the only entry that parses documents',
  },
  svg: {
    file: 'svg/index.js',
    gzipBudget: 20_000,
    note: 'scene builder + serializer; no zod, no framework',
  },
  dom: {
    file: 'dom/index.js',
    gzipBudget: 25_500,
    note: 'scene builder + patcher + player; no zod, no framework',
  },
  react: { file: 'react/index.js', gzipBudget: 27_000, note: 'react is external; no zod' },
  vue: { file: 'vue/index.js', gzipBudget: 24_000, note: 'vue is external; no zod' },
  node: { file: 'node/index.js', gzipBudget: 8_000, note: 'loader + schema (needs zod)' },
  gif: { file: 'gif/index.js', gzipBudget: 24_000, note: 'scene renderer + GIF encoder' },
  cli: { file: 'cli/index.js', gzipBudget: 35_000, note: 'validate + migrate + GIF (needs zod)' },
  plugins: {
    file: 'plugins/index.js',
    gzipBudget: 18_000,
    note: 'experimental authoring pipeline; isolated from the default core entry',
  },
  testing: {
    file: 'testing/index.js',
    gzipBudget: 21_000,
    note: 'scene assertions, SVG snapshots and pixel diff; no framework',
  },
  styles: { file: 'clotho.css', gzipBudget: 6_000, note: 'stylesheet' },
};

/** Imports each entry must never contain, so subpath isolation is real. */
const FORBIDDEN_IMPORTS: Record<string, RegExp[]> = {
  core: [/from\s*['"]react/, /from\s*['"]vue['"]/, /from\s*['"]node:/],
  plugins: [/from\s*['"]react/, /from\s*['"]vue['"]/, /from\s*['"]node:/],
  testing: [/from\s*['"]react/, /from\s*['"]vue['"]/, /from\s*['"]node:/],
  svg: [/from\s*['"]react/, /from\s*['"]vue['"]/, /from\s*['"]node:/],
  dom: [/from\s*['"]react/, /from\s*['"]vue['"]/, /from\s*['"]node:/],
  react: [/from\s*['"]vue['"]/, /from\s*['"]node:/],
  vue: [/from\s*['"]react/, /from\s*['"]node:/],
};

/**
 * Entries that must not carry zod.
 *
 * A rendering adapter receives an already-parsed document, so it has no business
 * bundling a validator. Keeping that true is worth about 9KB gzipped to anyone who
 * only renders — and it is the kind of thing one convenience import quietly undoes.
 */
const ZOD_FREE = ['svg', 'dom', 'react', 'vue', 'testing'] as const;
const ZOD_MARKERS = [/ZodError/, /ZodType/, /invalid_union/];

if (!existsSync(DIST)) {
  console.error('dist/ not found. Run: bun run build');
  process.exit(2);
}

const problems: string[] = [];
const rows: { name: string; raw: number; gzip: number; budget: number }[] = [];

/**
 * Every file an entry point actually pulls in, following relative imports.
 *
 * The build code-splits into shared chunks, so an entry file on its own is a useless
 * number — `core/index.js` is 7KB while the zod-bearing chunk it imports is 50KB.
 * Measuring the transitive closure is the only figure that corresponds to what a
 * consumer downloads.
 */
function transitiveFiles(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (seen.has(current) || !existsSync(current)) continue;
    seen.add(current);

    const source = readFileSync(current, 'utf-8');
    const dir = current.slice(0, current.lastIndexOf('/'));
    // Covers `from './x.js'`, `import './x.js'`, and `export … from './x.js'`.
    for (const match of source.matchAll(/from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]/g)) {
      const specifier = match[1] ?? match[2];
      if (specifier) queue.push(resolve(dir, specifier));
    }
  }

  return [...seen];
}

for (const [name, spec] of Object.entries(BUDGETS)) {
  const path = join(DIST, spec.file);
  if (!existsSync(path)) {
    problems.push(`${name}: missing build output ${spec.file}`);
    continue;
  }

  const files = spec.file.endsWith('.css') ? [path] : transitiveFiles(path);
  const combined = Buffer.concat(files.sort().map((file) => readFileSync(file)));
  const source = combined;
  const gzip = gzipSync(combined).length;
  rows.push({ name, raw: source.length, gzip, budget: spec.gzipBudget });

  if (gzip > spec.gzipBudget) {
    problems.push(
      `${name}: ${gzip}B gzipped exceeds the ${spec.gzipBudget}B budget (${spec.note})`,
    );
  }

  const text = source.toString('utf-8');

  for (const pattern of FORBIDDEN_IMPORTS[name] ?? []) {
    if (pattern.test(text)) {
      problems.push(`${name}: must not import ${pattern.source} — subpath isolation broken`);
    }
  }

  if ((ZOD_FREE as readonly string[]).includes(name)) {
    for (const marker of ZOD_MARKERS) {
      if (marker.test(text)) {
        problems.push(
          `${name}: pulls in zod (matched ${marker.source}) — a rendering adapter takes an ` +
            'already-parsed document and should not bundle a validator',
        );
        break;
      }
    }
  }
}

const pad = (text: string, width: number) => text.padEnd(width);
console.log(`${pad('entry', 10)}${pad('raw', 12)}${pad('gzip', 12)}budget`);
for (const row of rows) {
  const flag = row.gzip > row.budget ? '  OVER' : '';
  console.log(
    `${pad(row.name, 10)}${pad(`${(row.raw / 1024).toFixed(1)}KB`, 12)}${pad(
      `${(row.gzip / 1024).toFixed(1)}KB`,
      12,
    )}${(row.budget / 1024).toFixed(1)}KB${flag}`,
  );
}

if (problems.length > 0) {
  console.error(`\nFAILED — ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log('\nsize check OK — every entry within budget, no cross-adapter imports.');
