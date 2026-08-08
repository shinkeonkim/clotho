// Which parts of the v1 schema can an editor actually author?
//
// docs/AUDIT-EDITOR.md is the output of this script, written up. The point of having it
// as a script is that the answer changes: every field clotho adds is a field some editor
// has to grow a control for, and nobody notices the gap by reading a table from last
// month.
//
// The schema side is introspected from zod, so it cannot drift. The editor side is a
// source scan, and the two halves of it are not equally strong: the property-panel walk
// is exact for the panel's actual shape, while "mentioned somewhere else" only proves
// the word exists. So `none` is a conclusion and `elsewhere` is a question — the write-up
// resolves the latter by hand.
//
// Usage: bun scripts/audit-editor-coverage.ts [editorDir]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { z } from 'zod';
import { elementSchema } from '../src/core/schema/elements';

const editorDir = process.argv[2] ?? '../clotho-editor';

/** Fields every element carries; auditing them per type would just be noise. */
const COMMON = new Set(['type', 'id', 'name', 'parentId', 'rotation', 'appearances', 'tracks']);

/** Files that hold data rather than behavior — scanning them invents coverage. */
const SKIP_FILES = new Set(['icon-data.ts']);

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  // ZodOptional / ZodDefault / ZodNullable all hide the real shape one level down.
  for (;;) {
    const inner = (current._def as { innerType?: z.ZodTypeAny }).innerType;
    if (!inner) return current;
    current = inner;
  }
}

/** Element type → the fields the schema defines for it, minus the common ones. */
function schemaFields(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const option of elementSchema.options) {
    const shape = (unwrap(option) as z.ZodObject<z.ZodRawShape>).shape;
    const type = (unwrap(shape.type as z.ZodTypeAny)._def as { value?: string }).value;
    if (!type) continue;
    out.set(
      type,
      Object.keys(shape).filter((k) => !COMMON.has(k)),
    );
  }
  return out;
}

interface Source {
  readonly path: string;
  readonly lines: readonly string[];
}

function sources(dir: string): Source[] {
  const out: Source[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== 'node_modules') walk(full);
        continue;
      }
      if (!['.ts', '.tsx'].includes(extname(entry))) continue;
      if (SKIP_FILES.has(entry) || entry.endsWith('.test.ts')) continue;
      out.push({ path: full, lines: readFileSync(full, 'utf-8').split('\n') });
    }
  };
  walk(join(dir, 'src'));
  return out;
}

type Surface = 'panel' | 'canvas' | 'none';

/**
 * `elementType → fields the property panel draws for it`, read out of the panel source.
 *
 * The naive scan — "does any `*Field(...)` call name this field" — is type-blind, and
 * type-blindness is exactly what hides the interesting gaps: `code` looks fully covered
 * because `rect` has a `width` control. So this walks the panel builder tracking which
 * `el.type === "..."` guards are open, and attributes each field to the types in scope.
 *
 * That makes it specific to the shape of `renderBaseFields`. It is meant to be: if that
 * function gets restructured this returns nothing and the report says every field is
 * missing, which is a loud failure rather than a quiet wrong answer.
 */
function panelFields(
  files: readonly Source[],
  allTypes: readonly string[],
): Map<string, Set<string>> {
  const out = new Map(allTypes.map((t) => [t, new Set<string>()]));
  const panel = files.find((f) => f.path.endsWith('properties.ts'));
  if (!panel) return out;

  // Types guarded by each open brace level; null means "no type guard here".
  const stack: (string[] | null)[] = [];
  let inBuilder = false;

  for (const line of panel.lines) {
    if (/function renderBaseFields/.test(line)) inBuilder = true;
    if (!inBuilder) continue;

    const guard = [...line.matchAll(/el\.type\s*===\s*["']([a-z]+)["']/g)].map((m) => m[1]!);
    for (const ch of line) {
      if (ch === '{') stack.push(guard.length > 0 ? guard : null);
      else if (ch === '}') stack.pop();
    }
    if (stack.length === 0) break; // left renderBaseFields

    const field = /key:\s*["']([A-Za-z0-9_]+)["']/.exec(line)?.[1];
    if (!field) continue;
    // Innermost guard wins; unguarded fields (name, rotation) apply to every type.
    const scope = [...stack].reverse().find((s) => s !== null) ?? allTypes;
    for (const type of scope) out.get(type)?.add(field);
  }
  return out;
}

/**
 * Every place that names `field`, panel or not.
 *
 * This distinguishes "the codebase knows this word" from "nothing knows it". It cannot
 * tell a canvas drag handle from a render-time read, so a hit means *possibly* editable
 * and a miss means *definitely* not. Only the misses are conclusive; docs/AUDIT-EDITOR.md
 * §3 splits the rest by hand.
 */
function mentions(field: string, files: readonly Source[]): string[] {
  const re = new RegExp(`\\b${field}\\b`);
  const hits: string[] = [];
  for (const file of files) {
    file.lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${file.path}:${i + 1}`);
    });
  }
  return hits;
}

const files = sources(editorDir);
if (files.length === 0) {
  console.error(`no sources under ${editorDir}/src — pass the editor directory as argv[1]`);
  process.exit(1);
}

const addable = new Set(
  files.flatMap((f) =>
    [...f.lines.join('\n').matchAll(/data-add-element="([a-z]+)"/g)].map((m) => m[1]!),
  ),
);

console.log(`editor: ${editorDir}  (${files.length} source files)\n`);

console.log('요소 생성');
const fields = schemaFields();
for (const type of fields.keys()) {
  // A group is made by grouping a selection, so its absence from the add menu is right.
  const ok = addable.has(type) || type === 'group';
  console.log(`  ${ok ? 'O' : 'X'} ${type}`);
}

console.log(
  '\n속성 편집  (panel = 속성 패널이 그린다 · elsewhere = 다른 곳에서 언급 · none = 아무 데도 없다)',
);
const panel = panelFields(files, [...fields.keys()]);
let unreachable = 0;

for (const [type, list] of fields) {
  const drawn = panel.get(type) ?? new Set<string>();
  const buckets: Record<Surface, string[]> = { panel: [], canvas: [], none: [] };
  for (const field of list) {
    const surface: Surface = drawn.has(field)
      ? 'panel'
      : mentions(field, files).length > 0
        ? 'canvas'
        : 'none';
    buckets[surface].push(field);
  }
  unreachable += buckets.none.length;
  const counts =
    `panel ${String(buckets.panel.length).padStart(2)}` +
    ` · elsewhere ${String(buckets.canvas.length).padStart(2)}` +
    ` · none ${String(buckets.none.length).padStart(2)}`;
  console.log(`  ${type.padEnd(8)} ${counts}`);
  if (buckets.canvas.length) console.log(`    elsewhere: ${buckets.canvas.join(', ')}`);
  if (buckets.none.length) console.log(`    none:      ${buckets.none.join(', ')}`);
}

console.log('\n트랙 · 문서 수준');
for (const field of ['ease', 'interpolate', 'tags', 'assets']) {
  const where = mentions(field, files);
  const at = where[0] ? ` (${relative(editorDir, where[0])})` : '';
  console.log(`  ${where.length === 0 ? 'X' : 'O'} ${field}${at}`);
}

console.log(
  `\n소스 어디에도 없는 필드: ${unreachable}개.` +
    ' elsewhere 항목은 캔버스 조작·기본값·렌더 중 무엇인지 구분되지 않는다 — docs/AUDIT-EDITOR.md §3 참고.',
);
