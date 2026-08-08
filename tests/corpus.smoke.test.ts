// Corpus sanity, in whichever format it is currently in.
//
// The format-independent checks run either way. The format-specific ones — "legacy is
// rejected until migrated" and "v1 parses directly" — are the two halves of the
// migration gate, and exactly one applies at a time.

import { describe, expect, it } from 'bun:test';
import { hasCorpus, loadCorpus, corpusFormat, CORPUS_DIR } from './corpus';
import { isLegacyDocument, parseDocument } from '../src/core/schema';

const describeCorpus = hasCorpus() ? describe : describe.skip;
const format = hasCorpus() ? corpusFormat() : 'empty';

describeCorpus(`animation corpus (${CORPUS_DIR}) [${format}]`, () => {
  const entries = loadCorpus();

  it('is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  // A half-migrated corpus would let each format-specific block below test only the
  // documents that happen to suit it, which is worse than failing.
  it('is entirely one format, not half-migrated', () => {
    expect(format === 'legacy' || format === 'v1').toBe(true);
  });

  it('holds only well-formed JSON objects with an id and elements array', () => {
    for (const entry of entries) {
      const doc = entry.json as Record<string, unknown>;
      expect(typeof doc).toBe('object');
      expect(doc.id, `${entry.id}: missing id`).toBeString();
      expect(Array.isArray(doc.elements), `${entry.id}: elements not an array`).toBe(true);
    }
  });

  it('has filenames matching the document id', () => {
    for (const entry of entries) {
      expect((entry.json as { id: string }).id, `${entry.file}`).toBe(entry.id);
    }
  });
});

// ── Before migration ─────────────────────────────────────────────────────────

const describeLegacy = hasCorpus() && format === 'legacy' ? describe : describe.skip;

describeLegacy('legacy corpus', () => {
  const entries = loadCorpus();

  it('uses only schema versions 3 and 4', () => {
    for (const entry of entries) {
      const version = (entry.json as { version?: unknown }).version;
      expect([3, 4].includes(version as number), `${entry.id}: version ${String(version)}`).toBe(
        true,
      );
    }
  });

  it('is recognized as legacy', () => {
    for (const entry of entries) {
      expect(isLegacyDocument(entry.json), `${entry.id}`).toBe(true);
    }
  });

  // The migration gate: legacy documents must not slip into the v1 runtime unparsed.
  // corpus-migration.test.ts proves the other half — that they all migrate.
  it('is rejected by the v1 parser until migrated', () => {
    for (const entry of entries) {
      expect(parseDocument(entry.json).ok, `${entry.id} parsed as v1 without migration`).toBe(
        false,
      );
    }
  });
});

// ── After migration ──────────────────────────────────────────────────────────

const describeV1 = hasCorpus() && format === 'v1' ? describe : describe.skip;

describeV1('migrated corpus', () => {
  const entries = loadCorpus();

  it('parses as v1 with no migration step', () => {
    const failures: string[] = [];
    for (const entry of entries) {
      const result = parseDocument(entry.json);
      if (!result.ok) failures.push(`${entry.id}: ${result.issues.slice(0, 2).join(' | ')}`);
    }
    expect(failures).toEqual([]);
  });

  it('is no longer recognized as legacy', () => {
    for (const entry of entries) {
      expect(isLegacyDocument(entry.json), `${entry.id}`).toBe(false);
    }
  });

  it('carries clothoVersion 1 and no legacy version field', () => {
    for (const entry of entries) {
      const doc = entry.json as Record<string, unknown>;
      expect(doc.clothoVersion, entry.id).toBe(1);
      expect(doc.version, entry.id).toBeUndefined();
    }
  });
});
