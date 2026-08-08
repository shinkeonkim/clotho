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
 */
const FORBIDDEN_GLOBALS = [
  /\bdocument\s*\./,
  /\bwindow\s*\./,
  /\brequestAnimationFrame\s*\(/,
  /\bcancelAnimationFrame\s*\(/,
  /\blocalStorage\b/,
  /\bnavigator\s*\./,
  /\bbtoa\s*\(/, // Latin-1 only; use core/text toBase64 instead (SCHEMA-V1 §2.3)
  /\batob\s*\(/,
];

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

  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const spec = m[1]!;
      if (FORBIDDEN_IMPORTS.some((f) => f.test(spec))) {
        found.push({ file: rel, line: lineOf(code, m.index), detail: `imports "${spec}"` });
      }
    }
  }

  for (const re of FORBIDDEN_GLOBALS) {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(code)) !== null) {
      found.push({
        file: rel,
        line: lineOf(code, m.index),
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
