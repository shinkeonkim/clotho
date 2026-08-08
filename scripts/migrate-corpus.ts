#!/usr/bin/env bun
// Convert a directory of legacy documents to v1, verifying each one renders the same.
//
// This is the tool for TASKS 7.1 — the step that has to happen before either consumer
// can switch to clotho. It does three things a bare `clotho migrate` does not:
//
//   1. Renders every document through the legacy engine and through clotho, at every
//      interesting instant, and refuses to write a document whose output changed.
//   2. Reports the authoring mistakes the validator finds, because migration is the
//      one moment when someone is looking at all 383 documents at once.
//   3. Writes to an output directory by default, so nothing is overwritten until the
//      result has been looked at.
//
// Usage:
//   bun scripts/migrate-corpus.ts                      # → .migrated/ , report only
//   bun scripts/migrate-corpus.ts --out DIR
//   bun scripts/migrate-corpus.ts --in-place           # overwrite the source directory
//   bun scripts/migrate-corpus.ts --report report.json

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { migrateLegacyDocument } from '../src/core/migrate/legacy';
import { parseDocument } from '../src/core/schema';
import { validateDocument, type Finding } from '../src/core/validate/validate';
import { buildScene } from '../src/core/scene/build';
import { computeSnapshot } from '../src/core/runtime/snapshot';
import { serializeScene } from '../src/svg/serialize';
import type { AnimationDocument } from '../src/core/schema/document';

const REPO_ROOT = resolve(import.meta.dir, '..');
const PRIVATE_DIR = process.env.CLOTHO_PRIVATE_DIR ?? join(REPO_ROOT, '.private');
const DEFAULT_IN =
  process.env.CLOTHO_CORPUS_DIR ?? join(PRIVATE_DIR, 'shinkeonkim.github.io/public/animations');

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const IN_DIR = argValue('--in') ?? DEFAULT_IN;
const IN_PLACE = process.argv.includes('--in-place');
const OUT_DIR = IN_PLACE ? IN_DIR : (argValue('--out') ?? join(REPO_ROOT, '.migrated'));
const REPORT_PATH = argValue('--report');
const DRY_RUN = process.argv.includes('--dry-run');

if (!existsSync(IN_DIR)) {
  console.log(`corpus migration SKIPPED — no such directory: ${IN_DIR}`);
  process.exit(0);
}

/** The legacy engine, for the equivalence check. Absent means the check is skipped. */
const LEGACY_RUNTIME = join(
  PRIVATE_DIR,
  'oh-my-blog/packages/animation-engine/src/schema/runtime.ts',
);
const legacy = existsSync(LEGACY_RUNTIME)
  ? ((await import(LEGACY_RUNTIME)) as {
      computeSnapshot: (doc: unknown, t: number) => Map<string, Record<string, unknown>>;
    })
  : null;

/** Times worth comparing: an even sweep plus every declared boundary. */
function sampleTimes(doc: AnimationDocument): number[] {
  const times = new Set<number>();
  const duration = Math.max(doc.duration, 1);
  for (let i = 0; i <= 20; i += 1) times.add(Math.round((duration * i) / 20));
  for (const chapter of doc.chapters) times.add(chapter.time);
  for (const effect of doc.effects) {
    times.add(effect.time);
    times.add(effect.time + Math.max(effect.duration - 1, 0));
  }
  return [...times].filter((t) => t >= 0).sort((a, b) => a - b);
}

function sameState(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a).sort();
  if (keys.join(',') !== Object.keys(b).sort().join(',')) return false;
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (typeof left === 'number' && typeof right === 'number') {
      if (Math.abs(left - right) > 1e-9) return false;
    } else if (JSON.stringify(left) !== JSON.stringify(right)) return false;
  }
  return true;
}

interface DocumentReport {
  readonly id: string;
  readonly ok: boolean;
  readonly migrationNotes: string[];
  readonly errors: string[];
  readonly warnings: { code: string; path: string; message: string }[];
  readonly equivalence: 'identical' | 'differs' | 'skipped';
  readonly frames: number;
}

const files = readdirSync(IN_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort();

const reports: DocumentReport[] = [];
const toWrite: { file: string; json: string }[] = [];

for (const file of files) {
  const id = file.replace(/\.json$/, '');
  const raw = JSON.parse(readFileSync(join(IN_DIR, file), 'utf-8')) as Record<string, unknown>;

  const migration = migrateLegacyDocument(raw);
  const parsed = parseDocument(migration.document);

  if (!parsed.ok) {
    reports.push({
      id,
      ok: false,
      migrationNotes: migration.notes.map((n) => n.message),
      errors: [...parsed.issues],
      warnings: [],
      equivalence: 'skipped',
      frames: 0,
    });
    continue;
  }

  const doc = parsed.document;
  const validation = validateDocument(migration.document);
  const asFinding = (f: Finding) => ({ code: f.code, path: f.path, message: f.message });

  // Equivalence: the migrated document must produce the same element states the
  // legacy engine produced. A difference here means migration changed rendering.
  let equivalence: DocumentReport['equivalence'] = 'skipped';
  let frames = 0;
  const differences: string[] = [];

  if (legacy) {
    equivalence = 'identical';
    for (const time of sampleTimes(doc)) {
      frames += 1;
      // Compare the runtime layer, which is the surface legacy exposed.
      const theirs = legacy.computeSnapshot(doc, time);
      const snapshot = computeSnapshot(doc, time);
      for (const [elementId, state] of snapshot) {
        const legacyState = theirs.get(elementId);
        if (!legacyState || !sameState(state as Record<string, unknown>, legacyState)) {
          differences.push(`${elementId}@${time}`);
          break;
        }
      }
      // Rendering must also not throw, which catches scene-layer regressions.
      serializeScene(buildScene(doc, time));
      if (differences.length > 0) {
        equivalence = 'differs';
        break;
      }
    }
  }

  const errors = validation.findings.filter((f) => f.severity === 'error').map((f) => f.message);
  const ok = errors.length === 0 && equivalence !== 'differs';

  reports.push({
    id,
    ok,
    migrationNotes: migration.notes.map((n) => n.message),
    errors: equivalence === 'differs' ? [...errors, `render differs: ${differences[0]}`] : errors,
    warnings: validation.findings.filter((f) => f.severity === 'warning').map(asFinding),
    equivalence,
    frames,
  });

  if (ok) {
    toWrite.push({ file, json: `${JSON.stringify(migration.document, null, 2)}\n` });
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

const failed = reports.filter((r) => !r.ok);
const totalFrames = reports.reduce((sum, r) => sum + r.frames, 0);
const warningsByCode = new Map<string, number>();
for (const report of reports) {
  for (const warning of report.warnings) {
    warningsByCode.set(warning.code, (warningsByCode.get(warning.code) ?? 0) + 1);
  }
}

console.log(`corpus migration: ${reports.length} documents from ${IN_DIR}`);
console.log(`  render-equivalent: ${reports.filter((r) => r.equivalence === 'identical').length}`);
console.log(`  frames compared:   ${totalFrames}`);
console.log(`  failed:            ${failed.length}`);
console.log('\nauthoring problems found (warnings — the documents still render):');
for (const [code, count] of [...warningsByCode].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${code}`);
}

/**
 * These are worth naming individually: they are places where an author wrote a
 * property expecting an effect and the engine silently ignored it, some of them for
 * years. Migration is the moment someone is looking.
 */
const notable = reports.flatMap((r) =>
  r.warnings
    .filter((w) => w.code === 'unresolvable-connector' || w.code === 'flow-target')
    .map((w) => `${r.id}: ${w.message}`),
);
if (notable.length > 0) {
  console.log('\nthings that never rendered:');
  for (const line of notable) console.log(`  ${line}`);
}

if (failed.length > 0) {
  console.error('\nFAILED documents:');
  for (const report of failed.slice(0, 10)) {
    console.error(`  ${report.id}: ${report.errors.slice(0, 2).join('; ')}`);
  }
}

if (REPORT_PATH) {
  writeFileSync(REPORT_PATH, `${JSON.stringify(reports, null, 2)}\n`, 'utf-8');
  console.log(`\nreport written to ${REPORT_PATH}`);
}

if (DRY_RUN) {
  console.log(`\ndry run — would write ${toWrite.length} document(s) to ${OUT_DIR}`);
  process.exit(failed.length > 0 ? 1 : 0);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, json } of toWrite) writeFileSync(join(OUT_DIR, file), json, 'utf-8');
console.log(`\nwrote ${toWrite.length} document(s) to ${OUT_DIR}${IN_PLACE ? ' (in place)' : ''}`);

process.exit(failed.length > 0 ? 1 : 0);
