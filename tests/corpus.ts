// Regression corpus resolver.
//
// The 383 real animation documents live in the blog repo, not here: they are the
// blog's content (~4.3MB) and vendoring them would make this package's history
// carry someone else's data. Tests resolve them from disk at run time and skip
// cleanly when the path is absent (CI, fresh clone, external contributor).
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
