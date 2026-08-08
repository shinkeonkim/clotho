#!/usr/bin/env bun
// Renders the whole corpus to SVG and validates every frame with a real XML parser.
//
// The unit tests check structure with string heuristics because Bun ships no XML
// parser. Heuristics are not enough: a serializer bug that emitted `x="1"y="2"`
// produced output that satisfied every pattern check written for it and was only
// caught by handing the result to a parser. This script closes that gap by shelling
// out to Python's expat.
//
// Requires .private/ and python3. Skips cleanly without them.
//
// Usage: bun scripts/verify-svg-wellformed.ts [--frames N]

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrateLegacyDocument } from '../src/core/migrate/legacy';
import { parseDocument } from '../src/core/schema';
import { renderDocumentToSvg } from '../src/svg/render';

const REPO_ROOT = resolve(import.meta.dir, '..');
const PRIVATE_DIR = process.env.CLOTHO_PRIVATE_DIR ?? join(REPO_ROOT, '.private');
const CORPUS_DIR =
  process.env.CLOTHO_CORPUS_DIR ?? join(PRIVATE_DIR, 'shinkeonkim.github.io/public/animations');

const frameArgIndex = process.argv.indexOf('--frames');
const FRAMES = frameArgIndex >= 0 ? Number(process.argv[frameArgIndex + 1]) : 5;

if (!existsSync(CORPUS_DIR)) {
  console.log(`svg well-formedness check SKIPPED — corpus not present at ${CORPUS_DIR}`);
  process.exit(0);
}

const files = readdirSync(CORPUS_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort();

const workDir = mkdtempSync(join(tmpdir(), 'clotho-svg-'));
const manifest: { file: string; source: string; time: number }[] = [];
const failures: string[] = [];

try {
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf-8')) as unknown;
    const parsed = parseDocument(migrateLegacyDocument(raw).document);
    if (!parsed.ok) {
      failures.push(`${file}: parse failed — ${parsed.issues[0]}`);
      continue;
    }
    const doc = parsed.document;
    const duration = Math.max(doc.duration, 1);

    for (let i = 0; i < FRAMES; i += 1) {
      const time = Math.round((duration * i) / Math.max(FRAMES - 1, 1));
      const svg = renderDocumentToSvg(doc, time, { standalone: true });
      const out = join(workDir, `${file.replace(/\.json$/, '')}-${i}.svg`);
      writeFileSync(out, svg, 'utf-8');
      manifest.push({ file: out, source: file, time });
    }
  }

  const listPath = join(workDir, 'manifest.json');
  writeFileSync(listPath, JSON.stringify(manifest), 'utf-8');

  const checker = `
import json, sys, xml.parsers.expat

with open(sys.argv[1], encoding='utf-8') as fh:
    manifest = json.load(fh)

bad = []
for entry in manifest:
    parser = xml.parsers.expat.ParserCreate()
    try:
        with open(entry['file'], 'rb') as fh:
            parser.ParseFile(fh)
    except Exception as exc:
        bad.append(f"{entry['source']}@{entry['time']}: {exc}")

print(json.dumps({'checked': len(manifest), 'bad': bad[:20], 'badCount': len(bad)}))
`;

  const proc = Bun.spawnSync(['python3', '-c', checker, listPath]);
  if (proc.exitCode !== 0) {
    console.error('python3 XML check failed to run:');
    console.error(new TextDecoder().decode(proc.stderr));
    process.exit(2);
  }

  const report = JSON.parse(new TextDecoder().decode(proc.stdout).trim()) as {
    checked: number;
    bad: string[];
    badCount: number;
  };

  console.log(
    `svg well-formedness: ${files.length} documents, ${report.checked} frames parsed by expat`,
  );

  if (report.badCount > 0 || failures.length > 0) {
    console.error(`\nFAILED — ${report.badCount + failures.length} problem(s):\n`);
    for (const message of [...failures, ...report.bad]) console.error(`  ${message}`);
    process.exit(1);
  }

  console.log('svg well-formedness check OK — every frame parses.');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
