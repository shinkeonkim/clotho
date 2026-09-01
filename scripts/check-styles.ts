#!/usr/bin/env bun
// Every class the adapters emit must exist in the stylesheet, and vice versa.
//
// This gap is invisible in tests: a component emitting `cloth-caption-num` with no
// rule for it renders unstyled and nothing fails. The reverse — a rule for a class no
// adapter emits — is dead weight that survives every refactor. Both are cheap to catch
// mechanically, so they are.
//
// Usage: bun scripts/check-styles.ts

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CLASS } from '../src/dom/strings';

const REPO_ROOT = resolve(import.meta.dir, '..');
const STYLESHEET = join(REPO_ROOT, 'src/styles/clotho.css');

const raw = readFileSync(STYLESHEET, 'utf-8');

/**
 * Comments are stripped before any scanning. The file's own documentation shows how a
 * host maps its palette onto clotho's tokens, and those example `var(--color-fg)`
 * references would otherwise be reported as real dependencies.
 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Class names the stylesheet has a rule for. */
const styled = new Set<string>();
for (const match of css.matchAll(/\.(cloth-[a-z0-9-]+)/g)) styled.add(match[1]!);

/** Class names the adapters emit, from the shared registry. */
const emitted = new Set<string>(Object.values(CLASS));

// Modifier and state classes the components apply alongside a base class, plus the
// data attributes the stylesheet keys off. Listed explicitly so a typo in one is
// still caught.
const KNOWN_EXTRAS = new Set([
  'cloth-wrapper-title-icon',
  'cloth-wrapper-reduced-note',
  'cloth-wrapper-speed-icon',
  'cloth-step-list-num',
  'cloth-step-list-body',
  'cloth-step-list-label',
  'cloth-step-list-subtitle',
  'cloth-modal-rotate-hint',
  'cloth-modal-fit',
]);

const unstyled = [...emitted].filter((name) => !styled.has(name)).sort();
const unused = [...styled].filter((name) => !emitted.has(name) && !KNOWN_EXTRAS.has(name)).sort();

console.log(`styles: ${styled.size} classes in the stylesheet, ${emitted.size} in the registry`);

const problems: string[] = [];
for (const name of unstyled) problems.push(`emitted but unstyled: .${name}`);
for (const name of unused) problems.push(`styled but never emitted: .${name}`);

/** Tokens must all be declared, or a rule silently resolves to nothing. */
const referenced = new Set<string>();
for (const match of css.matchAll(/var\((--cloth-[a-z0-9-]+)/g)) referenced.add(match[1]!);
const declared = new Set<string>();
for (const match of css.matchAll(/^\s*(--cloth-[a-z0-9-]+):/gm)) declared.add(match[1]!);
for (const token of [...referenced].sort()) {
  if (!declared.has(token)) problems.push(`referenced but never declared: ${token}`);
}

/** A host variable left in place would render unstyled outside the original blog. */
for (const match of css.matchAll(/var\((--(?!cloth)[a-z0-9-]+)/g)) {
  problems.push(`references a host variable clotho does not define: ${match[1]}`);
}

/** Braces must balance, since the file is assembled rather than hand-written. */
const opens = (css.match(/\{/g) ?? []).length;
const closes = (css.match(/\}/g) ?? []).length;
if (opens !== closes) problems.push(`unbalanced braces: ${opens} open, ${closes} close`);

/** Body of the brace-delimited block starting at or after `from`. */
function blockBodyAfter(source: string, from: number): string | null {
  const open = source.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Both dark paths must set the same tokens, or one of them has holes: the
 * `prefers-color-scheme` block serves viewers who never chose a theme, and the
 * `[data-cloth-theme="dark"]` block serves those who did.
 *
 * Blocks are found by scanning balanced braces rather than by matching a formatted
 * selector. The stylesheet goes through prettier, which is free to break a selector
 * across lines or change quote style, and a formatting-sensitive check would fail for
 * no reason — as this one did.
 */
const themeBlocks: string[] = [];
for (const match of css.matchAll(
  /:root:not\(\[data-cloth-theme=['"]light['"]\]\)|\[data-cloth-theme=['"]dark['"]\]/g,
)) {
  const body = blockBodyAfter(css, match.index);
  if (body !== null) themeBlocks.push(body);
}

if (themeBlocks.length === 2) {
  const tokensOf = (body: string) =>
    new Set([...body.matchAll(/(--cloth-[a-z0-9-]+):/g)].map((m) => m[1]!));
  const [first, second] = themeBlocks.map(tokensOf);
  for (const token of first!) {
    if (!second!.has(token)) problems.push(`dark theme mismatch: ${token} set in only one block`);
  }
  for (const token of second!) {
    if (!first!.has(token)) problems.push(`dark theme mismatch: ${token} set in only one block`);
  }
} else {
  problems.push(`expected 2 dark-theme blocks, found ${themeBlocks.length}`);
}

if (problems.length > 0) {
  console.error(`\nFAILED — ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log('style check OK — classes, tokens, and both theme paths line up.');
