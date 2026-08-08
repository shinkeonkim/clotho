// The migration gate, closed and proven safe.
//
// corpus.smoke.test.ts pins that legacy documents are *rejected* by the v1 parser.
// This pins the other half: every one of them migrates, parses, and validates. A
// closed gate with no way through would just be a wall.

import { describe, expect, it } from 'bun:test';
import { CORPUS_DIR, corpusFormat, hasCorpus, loadCorpus } from './corpus';
import { migrateLegacyDocument } from '../src/core/migrate/legacy';
import { parseDocument } from '../src/core/schema';
import { validateDocument } from '../src/core/validate/validate';
import { computeSnapshot } from '../src/core/runtime/snapshot';

// Needs legacy input. Once the corpus has been migrated in place, that input is gone
// and these skip — the migration itself remains covered by the unit tests in
// src/core/migrate and by scripts/migrate-corpus.ts, which verified all 383 documents
// before writing them.
const describeCorpus = hasCorpus() && corpusFormat() === 'legacy' ? describe : describe.skip;

describeCorpus(`legacy migration over the corpus (${CORPUS_DIR})`, () => {
  const entries = loadCorpus();

  it('migrates and parses every document', () => {
    const failures: string[] = [];
    for (const entry of entries) {
      const { document } = migrateLegacyDocument(entry.json);
      const parsed = parseDocument(document);
      if (!parsed.ok) failures.push(`${entry.id}: ${parsed.issues.slice(0, 3).join(' | ')}`);
    }
    expect(failures).toEqual([]);
  });

  it('preserves every field that is not part of the four documented rewrites', () => {
    const failures: string[] = [];
    for (const entry of entries) {
      const legacy = entry.json as Record<string, unknown>;
      const { document } = migrateLegacyDocument(legacy);

      for (const key of Object.keys(legacy)) {
        if (key === 'version') continue; // becomes clothoVersion
        if (key === 'elements') continue; // checked below
        if (JSON.stringify(document[key]) !== JSON.stringify(legacy[key])) {
          failures.push(`${entry.id}.${key} changed`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('preserves every element field, since the corpus uses no image or group', () => {
    const failures: string[] = [];
    for (const entry of entries) {
      const legacyElements = (entry.json as { elements: Record<string, unknown>[] }).elements;
      const { document } = migrateLegacyDocument(entry.json);
      const migratedElements = document.elements as Record<string, unknown>[];

      if (legacyElements.length !== migratedElements.length) {
        failures.push(`${entry.id}: element count changed`);
        continue;
      }
      for (let i = 0; i < legacyElements.length; i += 1) {
        if (JSON.stringify(legacyElements[i]) !== JSON.stringify(migratedElements[i])) {
          failures.push(`${entry.id}.elements.${i} changed`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('reports no migration notes, because nothing needed rewriting', () => {
    const noted = entries
      .map((entry) => ({ id: entry.id, notes: migrateLegacyDocument(entry.json).notes }))
      .filter((entry) => entry.notes.length > 0);
    expect(noted).toEqual([]);
  });

  it('produces documents that validate without errors', () => {
    const failures: string[] = [];
    for (const entry of entries) {
      const { document } = migrateLegacyDocument(entry.json);
      const result = validateDocument(document);
      if (!result.ok) {
        const errors = result.findings.filter((f) => f.severity === 'error').slice(0, 3);
        failures.push(`${entry.id}: ${errors.map((f) => `${f.path} ${f.message}`).join(' | ')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('renders a non-empty snapshot at the midpoint of every animation', () => {
    const failures: string[] = [];
    for (const entry of entries) {
      const parsed = parseDocument(migrateLegacyDocument(entry.json).document);
      if (!parsed.ok) continue;
      const doc = parsed.document;
      const snapshot = computeSnapshot(doc, Math.floor(doc.duration / 2));
      if (snapshot.size !== doc.elements.length) {
        failures.push(`${entry.id}: snapshot covered ${snapshot.size}/${doc.elements.length}`);
      }
      for (const [id, state] of snapshot) {
        for (const [key, value] of Object.entries(state)) {
          if (typeof value === 'number' && !Number.isFinite(value)) {
            failures.push(`${entry.id} ${id}.${key} is ${value}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('never produces a non-finite number anywhere on the timeline', () => {
    const failures: string[] = [];
    for (const entry of entries) {
      const parsed = parseDocument(migrateLegacyDocument(entry.json).document);
      if (!parsed.ok) continue;
      const doc = parsed.document;
      const duration = Math.max(doc.duration, 1);
      for (let step = 0; step <= 20; step += 1) {
        const snapshot = computeSnapshot(doc, Math.round((duration * step) / 20));
        for (const [id, state] of snapshot) {
          for (const [key, value] of Object.entries(state)) {
            if (typeof value === 'number' && !Number.isFinite(value)) {
              failures.push(`${entry.id}@${step} ${id}.${key} is ${value}`);
            }
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('is idempotent — migrating a migrated document changes nothing', () => {
    const failures: string[] = [];
    for (const entry of entries) {
      const once = migrateLegacyDocument(entry.json).document;
      const twice = migrateLegacyDocument({ ...once, version: 4 }).document;
      const { clothoVersion: _a, ...onceRest } = once;
      const { clothoVersion: _b, ...twiceRest } = twice;
      if (JSON.stringify(onceRest) !== JSON.stringify(twiceRest)) failures.push(entry.id);
    }
    expect(failures).toEqual([]);
  });
});
