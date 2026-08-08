// Scaffolding-stage smoke test: proves the regression corpus is reachable and
// well-formed before any porting begins. Once core/schema lands, corpus.test.ts
// will additionally parse every document against the schema (TASKS 1.4).

import { describe, expect, it } from 'bun:test';
import { hasCorpus, loadCorpus, CORPUS_DIR } from './corpus';

const describeCorpus = hasCorpus() ? describe : describe.skip;

describeCorpus(`animation corpus (${CORPUS_DIR})`, () => {
  const entries = loadCorpus();

  it('is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('holds only well-formed JSON objects with an id and elements array', () => {
    for (const entry of entries) {
      const doc = entry.json as Record<string, unknown>;
      expect(typeof doc).toBe('object');
      expect(doc.id, `${entry.id}: missing id`).toBeString();
      expect(Array.isArray(doc.elements), `${entry.id}: elements not an array`).toBe(true);
    }
  });

  it('uses only schema versions 3 and 4', () => {
    for (const entry of entries) {
      const version = (entry.json as { version?: unknown }).version;
      expect([3, 4].includes(version as number), `${entry.id}: version ${String(version)}`).toBe(
        true,
      );
    }
  });

  it('has filenames matching the document id', () => {
    for (const entry of entries) {
      expect((entry.json as { id: string }).id, `${entry.file}`).toBe(entry.id);
    }
  });
});
