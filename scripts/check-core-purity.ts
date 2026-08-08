#!/usr/bin/env bun
// Enforces ARCHITECTURE.md §1: the core must stay framework- and DOM-free.
//
// This is the one invariant the whole adapter design rests on. If React or a
// DOM global leaks into src/core, every adapter inherits the dependency and the
// scene-graph split silently stops paying for itself. Cheap to check, expensive
// to discover late — so it runs in CI.
//
// Usage: bun scripts/check-core-purity.ts

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const CORE_DIR = resolve(import.meta.dir, '../src/core');
const REPO_ROOT = resolve(import.meta.dir, '..');

/** Import specifiers the core may never depend on. */
const FORBIDDEN_IMPORTS = [
  /^react(\/|$)/,
  /^react-dom(\/|$)/,
  /^vue(\/|$)/,
  /^node:/,
  /^@?(svelte|solid-js|preact|angular)(\/|$)/,
];

/**
 * Host globals the core may never touch. The core receives time from an injected
 * scheduler and geometry from data, so it never needs these.
 *
 * Each pattern is anchored with a lookbehind that excludes member access, because
 * clotho's own domain object is named `document` — `result.document.id` is
 * ordinary core code, `document.querySelector(...)` is not. A local binding that
 * shadows a global name can be exempted with an ignore comment (see below).
 */
const NOT_MEMBER = '(?<![.\\w$])';
const FORBIDDEN_GLOBALS = [
  new RegExp(`${NOT_MEMBER}document\\s*\\.`),
  new RegExp(`${NOT_MEMBER}window\\s*\\.`),
  new RegExp(`${NOT_MEMBER}requestAnimationFrame\\s*\\(`),
  new RegExp(`${NOT_MEMBER}cancelAnimationFrame\\s*\\(`),
  new RegExp(`${NOT_MEMBER}localStorage\\b`),
  new RegExp(`${NOT_MEMBER}navigator\\s*\\.`),
  // btoa/atob are Latin-1 only; use core/text toBase64 (docs/SCHEMA-V1.md §2.3).
  new RegExp(`${NOT_MEMBER}btoa\\s*\\(`),
  new RegExp(`${NOT_MEMBER}atob\\s*\\(`),
];

/** Escape hatch for a line that only looks like a violation. */
const IGNORE_MARKER = 'clotho-purity-ignore-next-line';

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

interface Violation {
  file: string;
  line: number;
  detail: string;
}

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** Strip comments so a forbidden name mentioned in prose is not a violation. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function check(file: string): Violation[] {
  const raw = readFileSync(file, 'utf-8');
  const code = stripComments(raw);
  const rel = relative(REPO_ROOT, file);
  const found: Violation[] = [];

  // Lines whose predecessor carries the ignore marker. Read from `raw` so the
  // marker survives comment stripping.
  const rawLines = raw.split('\n');
  const exempt = new Set<number>();
  rawLines.forEach((line, i) => {
    if (line.includes(IGNORE_MARKER)) exempt.add(i + 2); // 1-indexed next line
  });

  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const spec = m[1]!;
      // Report the line holding the specifier, not the match start: a multi-line
      // import statement begins at the preceding newline and would be off by one.
      const line = lineOf(code, code.indexOf(spec, m.index));
      if (FORBIDDEN_IMPORTS.some((f) => f.test(spec)) && !exempt.has(line)) {
        found.push({ file: rel, line, detail: `imports "${spec}"` });
      }
    }
  }

  for (const re of FORBIDDEN_GLOBALS) {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(code)) !== null) {
      const line = lineOf(code, m.index);
      if (exempt.has(line)) continue;
      found.push({
        file: rel,
        line,
        detail: `uses host global \`${m[0].trim()}\``,
      });
    }
  }

  return found;
}

const files = walk(CORE_DIR);
const violations = files.flatMap(check);

if (violations.length > 0) {
  console.error(`core purity check FAILED — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.detail}`);
  console.error(
    '\nsrc/core must stay framework- and DOM-free (docs/ARCHITECTURE.md §1).' +
      '\nMove host-dependent code into an adapter (src/react, src/vue, src/dom, src/node)' +
      '\nor inject it as a hook.',
  );
  process.exit(1);
}

console.log(`core purity check OK — ${files.length} file(s) clean.`);
