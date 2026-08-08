#!/usr/bin/env bun
// Differential check: does the clotho runtime agree with the legacy engine it was
// ported from, on every real document, at every interesting instant?
//
// Unit tests pin the behavior we thought to write down. This pins the behavior we
// didn't — the corpus exercises 20 tracked properties, out-of-order chapters,
// duplicated keyframe times, unparseable colors, and multi-window appearances in
// combinations no hand-written test would think to assemble. If the port drifted,
// this finds it; if a future change is meant to alter rendering, this is where
// that intent has to be stated out loud.
//
// Requires .private/ (the reference repos). Exits 0 and explains itself when
// absent, so it is safe to wire into a local check chain but cannot run in CI.
//
// Usage: bun scripts/verify-legacy-equivalence.ts [--verbose]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { animationDocumentSchema } from '../src/core/schema/document';
import { activeEffects, computeSnapshot, currentChapter } from '../src/core/runtime';

const REPO_ROOT = resolve(import.meta.dir, '..');
const PRIVATE_DIR = process.env.CLOTHO_PRIVATE_DIR ?? join(REPO_ROOT, '.private');
const CORPUS_DIR =
  process.env.CLOTHO_CORPUS_DIR ?? join(PRIVATE_DIR, 'shinkeonkim.github.io/public/animations');
const LEGACY_RUNTIME = join(
  PRIVATE_DIR,
  'oh-my-blog/packages/animation-engine/src/schema/runtime.ts',
);

const VERBOSE = process.argv.includes('--verbose');
const MAX_EXAMPLES = 10;

if (!existsSync(CORPUS_DIR) || !existsSync(LEGACY_RUNTIME)) {
  console.log('legacy equivalence check SKIPPED — .private/ reference repos not present.');
  console.log(`  corpus: ${CORPUS_DIR}`);
  console.log(`  legacy: ${LEGACY_RUNTIME}`);
  process.exit(0);
}

const legacy = (await import(LEGACY_RUNTIME)) as {
  computeSnapshot: (doc: unknown, t: number) => Map<string, Record<string, unknown>>;
  currentChapter: (doc: unknown, t: number) => unknown;
  activeEffects: (doc: unknown, t: number) => { id: string }[];
};

/**
 * Legacy documents differ from v1 only in the envelope field for this corpus:
 * `image` and `group` are used 0 times, so nothing else needs translating. The
 * real migrator (TASKS 1.8) handles those; here we isolate runtime behavior.
 */
function toV1(legacyJson: Record<string, unknown>): Record<string, unknown> {
  const { version: _legacyVersion, ...rest } = legacyJson;
  return { clothoVersion: 1, ...rest };
}

/** Times worth comparing: an even sweep plus every boundary the document declares. */
function sampleTimes(doc: {
  duration: number;
  chapters: { time: number }[];
  effects: { time: number; duration: number }[];
}): number[] {
  const times = new Set<number>();
  const duration = Math.max(doc.duration, 1);
  const STEPS = 40;
  for (let i = 0; i <= STEPS; i += 1) times.add(Math.round((duration * i) / STEPS));
  for (const chapter of doc.chapters) {
    times.add(chapter.time - 1);
    times.add(chapter.time);
    times.add(chapter.time + 1);
  }
  for (const effect of doc.effects) {
    times.add(effect.time - 1);
    times.add(effect.time);
    times.add(effect.time + effect.duration - 1);
    times.add(effect.time + effect.duration);
  }
  return [...times].filter((t) => t >= 0).sort((a, b) => a - b);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    // Both sides run the same arithmetic, so exact equality is expected; the
    // epsilon only guards against float formatting differences.
    return Math.abs(a - b) < 1e-9 || (Number.isNaN(a) && Number.isNaN(b));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

const files = readdirSync(CORPUS_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort();

let documents = 0;
let frames = 0;
let comparisons = 0;
const failures: string[] = [];

function fail(message: string): void {
  if (failures.length < MAX_EXAMPLES) failures.push(message);
  else if (failures.length === MAX_EXAMPLES) failures.push('… further differences suppressed');
}

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf-8')) as Record<string, unknown>;
  const parsed = animationDocumentSchema.safeParse(toV1(raw));
  if (!parsed.success) {
    fail(`${file}: v1 parse failed — ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    continue;
  }

  const doc = parsed.data;
  documents += 1;

  for (const t of sampleTimes(doc)) {
    frames += 1;

    const mine = computeSnapshot(doc, t);
    const theirs = legacy.computeSnapshot(doc, t);

    if (mine.size !== theirs.size) {
      fail(`${file}@${t}: snapshot size ${mine.size} vs legacy ${theirs.size}`);
      continue;
    }

    for (const [id, state] of mine) {
      const legacyState = theirs.get(id);
      if (!legacyState) {
        fail(`${file}@${t}: legacy has no state for "${id}"`);
        break;
      }
      const keys = Object.keys(state).sort();
      const legacyKeys = Object.keys(legacyState).sort();
      if (keys.join(',') !== legacyKeys.join(',')) {
        fail(`${file}@${t} ${id}: property set differs (${keys.length} vs ${legacyKeys.length})`);
        break;
      }
      for (const key of keys) {
        comparisons += 1;
        if (!sameValue(state[key], legacyState[key])) {
          fail(
            `${file}@${t} ${id}.${key}: ${JSON.stringify(state[key])} vs legacy ${JSON.stringify(legacyState[key])}`,
          );
          break;
        }
      }
    }

    if (JSON.stringify(currentChapter(doc, t)) !== JSON.stringify(legacy.currentChapter(doc, t))) {
      fail(`${file}@${t}: current chapter differs`);
    }

    const mineEffects = activeEffects(doc, t)
      .map((e) => e.id)
      .sort();
    const legacyEffects = legacy
      .activeEffects(doc, t)
      .map((e) => e.id)
      .sort();
    if (mineEffects.join(',') !== legacyEffects.join(',')) {
      fail(`${file}@${t}: active effects differ (${mineEffects} vs ${legacyEffects})`);
    }
  }

  if (VERBOSE) console.log(`  ${file}: ok`);
}

console.log(
  `legacy equivalence: ${documents}/${files.length} documents, ${frames} frames, ${comparisons} property comparisons`,
);

if (failures.length > 0) {
  console.error(`\nFAILED — ${failures.length} difference(s) from the legacy engine:\n`);
  for (const message of failures) console.error(`  ${message}`);
  console.error(
    '\nThe port must render identically to the engine it replaces. If a change here is' +
      '\nintentional, say so explicitly and update this script rather than deleting it.',
  );
  process.exit(1);
}

console.log('legacy equivalence check OK — no differences.');
