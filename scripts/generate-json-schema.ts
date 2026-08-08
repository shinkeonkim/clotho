#!/usr/bin/env bun
// Emit a JSON Schema for the v1 document format.
//
// The format is authored by hand in JSON files, so editor autocomplete and inline
// validation are worth real money to whoever writes them — that is what the optional
// `$schema` field in a document is for (docs/SCHEMA-V1.md S5).
//
// Generated from the zod schema rather than written separately, so the two cannot
// drift. Written to `schema/clotho-1.schema.json` and shipped in the package.
//
// Usage: bun scripts/generate-json-schema.ts [--check]

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { animationDocumentSchema } from '../src/core/schema/document';

const REPO_ROOT = resolve(import.meta.dir, '..');
const OUT_DIR = join(REPO_ROOT, 'schema');
const OUT_FILE = join(OUT_DIR, 'clotho-1.schema.json');

const CHECK_ONLY = process.argv.includes('--check');

const generated = zodToJsonSchema(animationDocumentSchema, {
  name: 'ClothoDocument',
  $refStrategy: 'root',
  target: 'jsonSchema7',
});

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'clotho animation document (v1)',
  description:
    'JSON-defined visualization animation. See https://github.com/shinkeonkim/clotho — docs/SCHEMA-V1.md.',
  ...generated,
};

const json = `${JSON.stringify(schema, null, 2)}\n`;

if (CHECK_ONLY) {
  if (!existsSync(OUT_FILE)) {
    console.error(`json schema missing: ${OUT_FILE}\nRun: bun scripts/generate-json-schema.ts`);
    process.exit(1);
  }
  const current = readFileSync(OUT_FILE, 'utf-8');
  if (current !== json) {
    console.error(
      'json schema is out of date with the zod schema.\nRun: bun scripts/generate-json-schema.ts',
    );
    process.exit(1);
  }
  console.log('json schema check OK — in sync with the zod schema.');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, json, 'utf-8');
console.log(`wrote ${OUT_FILE} (${Math.round(json.length / 1024)}KB)`);
