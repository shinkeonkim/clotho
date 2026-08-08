// Regression corpus resolver.
//
// The real animation documents live in the blog repo, not here: they are the blog's
// content (~4.3MB) and vendoring them would make this package's history carry someone
// else's data. Tests resolve them from disk at run time and skip cleanly when the path
// is absent (CI, fresh clone, external contributor).
//
// The corpus format is *not* fixed. Before the migration it held legacy `version: 3|4`
// documents; after `scripts/migrate-corpus.ts --in-place` it holds clotho v1. Tests that
// care about one or the other check `corpusFormat()` rather than assuming, so the suite
// stays green on either side of that one-way step.
//
// Override the location with CLOTHO_CORPUS_DIR.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_CORPUS_DIR = resolve(
  import.meta.dir,
  '../.private/shinkeonkim.github.io/public/animations',
);

export const CORPUS_DIR = process.env.CLOTHO_CORPUS_DIR ?? DEFAULT_CORPUS_DIR;

export function hasCorpus(): boolean {
  return existsSync(CORPUS_DIR);
}

export interface CorpusEntry {
  readonly id: string;
  readonly file: string;
  readonly json: unknown;
}

export function loadCorpus(): CorpusEntry[] {
  if (!hasCorpus()) return [];
  return readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      id: name.replace(/\.json$/, ''),
      file: join(CORPUS_DIR, name),
      json: JSON.parse(readFileSync(join(CORPUS_DIR, name), 'utf-8')) as unknown,
    }));
}

export type CorpusFormat = 'legacy' | 'v1' | 'mixed' | 'empty';

/**
 * Which format the corpus is in.
 *
 * `mixed` means a migration was interrupted partway — worth failing loudly on rather
 * than quietly testing half of each.
 */
export function corpusFormat(): CorpusFormat {
  const entries = loadCorpus();
  if (entries.length === 0) return 'empty';

  let legacy = 0;
  let v1 = 0;
  for (const entry of entries) {
    const doc = entry.json as { clothoVersion?: unknown; version?: unknown };
    if (doc.clothoVersion === 1) v1 += 1;
    else if (doc.version === 3 || doc.version === 4) legacy += 1;
  }

  if (v1 > 0 && legacy > 0) return 'mixed';
  if (v1 === entries.length) return 'v1';
  if (legacy === entries.length) return 'legacy';
  return 'mixed';
}
