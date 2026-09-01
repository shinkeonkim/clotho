#!/usr/bin/env node
// `clotho` CLI — validate and migrate animation documents.
//
// Replaces shinkeonkim's scripts/validate-animations.mjs, which was wired into that
// blog's `prebuild`. Shipping it with the package means every consumer gets the
// same checks without copying a script, and the semantic rules (duplicate ids,
// referential integrity, temporal bounds) travel with the schema they depend on.
//
//   clotho validate <path...> [--json] [--quiet] [--strict]
//   clotho migrate  <path...> [--write] [--json]
//   clotho gif      <input.json> <output.gif> [--fps 12] [--width 800]
//
// Paths may be files or directories; directories are scanned for *.json.

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { formatFindings, validateDocument, type Finding } from '../core/validate/validate';
import { migrateLegacyDocument, needsMigration } from '../core/migrate/legacy';
import { stripBom } from '../core/text/base64';
import { animationDocumentSchema } from '../core/schema/document';
import { writeDocumentGif } from '../node/gif';

const USAGE = `clotho — JSON-defined visualization animations

Usage:
  clotho validate <path...> [options]   Check documents against the v1 schema and semantic rules
  clotho migrate  <path...> [options]   Convert legacy (version 3/4) documents to v1
  clotho gif <input.json> <output.gif>   Render a document as an animated GIF

Options:
  --write     migrate only: rewrite files in place (default is a dry run)
  --json      machine-readable output
  --quiet     exit code only, no output
  --strict    validate only: treat warnings as failures
  --fps N     gif only: frames per second (default: 12)
  --width N   gif only: output width in pixels (default: canvas width)
  --once      gif only: play once instead of looping forever
  --background COLOR  gif only: opaque raster background (default: #ffffff)
  -h, --help  show this help

Exit codes:
  0  success
  1  problems found
  2  bad invocation`;

interface Args {
  readonly command: string | undefined;
  readonly paths: string[];
  readonly write: boolean;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly strict: boolean;
  readonly help: boolean;
  readonly fps?: number;
  readonly width?: number;
  readonly once: boolean;
  readonly background?: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--fps' || arg === '--width' || arg === '--background') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      values.set(arg, value);
      index += 1;
    } else if (arg.startsWith('-')) {
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  return {
    command: positional[0],
    paths: positional.slice(1),
    write: flags.has('--write'),
    json: flags.has('--json'),
    quiet: flags.has('--quiet'),
    strict: flags.has('--strict'),
    help: flags.has('-h') || flags.has('--help'),
    fps: values.has('--fps') ? Number(values.get('--fps')) : undefined,
    width: values.has('--width') ? Number(values.get('--width')) : undefined,
    once: flags.has('--once'),
    background: values.get('--background'),
  };
}

async function runGif(args: Args): Promise<number> {
  if (args.paths.length !== 2) throw new Error('gif needs one input JSON file and one output GIF path');
  const [input, output] = args.paths as [string, string];
  const value = readJson(await readFile(resolve(input), 'utf-8'));
  const doc = animationDocumentSchema.parse(value);
  await writeDocumentGif(doc, resolve(output), {
    fps: args.fps,
    width: args.width,
    repeat: args.once ? -1 : 0,
    background: args.background,
  });
  if (!args.quiet) console.log(`wrote ${output}`);
  return 0;
}

/** Expand files and directories into a flat, sorted list of JSON files. */
async function collectFiles(paths: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    const absolute = resolve(path);
    const info = await stat(absolute).catch(() => null);
    if (!info) {
      throw new Error(`no such file or directory: ${path}`);
    }
    if (info.isDirectory()) {
      const entries = await readdir(absolute);
      for (const entry of entries.sort()) {
        if (entry.endsWith('.json')) out.push(join(absolute, entry));
      }
    } else {
      out.push(absolute);
    }
  }
  return out;
}

function readJson(text: string): unknown {
  return JSON.parse(stripBom(text)) as unknown;
}

interface FileReport {
  readonly file: string;
  readonly findings: readonly Finding[];
  readonly errorCount: number;
  readonly warningCount: number;
}

async function runValidate(args: Args): Promise<number> {
  const files = await collectFiles(args.paths);
  const reports: FileReport[] = [];

  for (const file of files) {
    let value: unknown;
    try {
      value = readJson(await readFile(file, 'utf-8'));
    } catch (cause) {
      reports.push({
        file,
        findings: [
          {
            severity: 'error',
            code: 'unreadable',
            path: '<root>',
            message: (cause as Error).message,
          },
        ],
        errorCount: 1,
        warningCount: 0,
      });
      continue;
    }

    const result = validateDocument(value);
    reports.push({
      file,
      findings: result.findings,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
    });
  }

  const totalErrors = reports.reduce((sum, r) => sum + r.errorCount, 0);
  const totalWarnings = reports.reduce((sum, r) => sum + r.warningCount, 0);
  const failed = totalErrors > 0 || (args.strict && totalWarnings > 0);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          command: 'validate',
          fileCount: files.length,
          errorCount: totalErrors,
          warningCount: totalWarnings,
          ok: !failed,
          files: reports
            .filter((r) => r.findings.length > 0)
            .map((r) => ({ file: relative(process.cwd(), r.file), findings: r.findings })),
        },
        null,
        2,
      ),
    );
  } else if (!args.quiet) {
    for (const report of reports) {
      if (report.findings.length === 0) continue;
      console.log(relative(process.cwd(), report.file));
      for (const line of formatFindings(report.findings)) console.log(`  ${line}`);
    }
    const summary = `${files.length} file(s), ${totalErrors} error(s), ${totalWarnings} warning(s)`;
    console.log(failed ? `FAILED — ${summary}` : `OK — ${summary}`);
  }

  return failed ? 1 : 0;
}

async function runMigrate(args: Args): Promise<number> {
  const files = await collectFiles(args.paths);
  const migrated: string[] = [];
  const skipped: string[] = [];
  const failures: { file: string; message: string }[] = [];
  const notes: { file: string; code: string; message: string }[] = [];

  for (const file of files) {
    let value: unknown;
    try {
      value = readJson(await readFile(file, 'utf-8'));
    } catch (cause) {
      failures.push({ file, message: (cause as Error).message });
      continue;
    }

    if (!needsMigration(value)) {
      skipped.push(file);
      continue;
    }

    const result = migrateLegacyDocument(value);
    for (const note of result.notes) {
      notes.push({ file, code: note.code, message: note.message });
    }

    // Validate before writing: a migration that produces an invalid document is a
    // bug worth surfacing, not something to persist over the original.
    const check = validateDocument(result.document);
    if (!check.ok) {
      failures.push({
        file,
        message: `migrated document is invalid — ${check.findings
          .filter((f) => f.severity === 'error')
          .slice(0, 3)
          .map((f) => `${f.path}: ${f.message}`)
          .join('; ')}`,
      });
      continue;
    }

    if (args.write) {
      await writeFile(file, `${JSON.stringify(result.document, null, 2)}\n`, 'utf-8');
    }
    migrated.push(file);
  }

  const relativePaths = (paths: string[]) => paths.map((p) => relative(process.cwd(), p));

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          command: 'migrate',
          write: args.write,
          migrated: relativePaths(migrated),
          skipped: relativePaths(skipped),
          notes: notes.map((n) => ({ ...n, file: relative(process.cwd(), n.file) })),
          failures: failures.map((f) => ({ ...f, file: relative(process.cwd(), f.file) })),
          ok: failures.length === 0,
        },
        null,
        2,
      ),
    );
  } else if (!args.quiet) {
    for (const note of notes) {
      console.log(`note  ${relative(process.cwd(), note.file)}: ${note.message}`);
    }
    for (const failure of failures) {
      console.log(`ERROR ${relative(process.cwd(), failure.file)}: ${failure.message}`);
    }
    const action = args.write ? 'migrated' : 'would migrate';
    console.log(
      `${action} ${migrated.length}, already v1 ${skipped.length}, failed ${failures.length}`,
    );
    if (!args.write && migrated.length > 0) {
      console.log('dry run — pass --write to rewrite these files in place');
    }
  }

  return failures.length > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.command === undefined) {
    console.log(USAGE);
    return args.command === undefined && !args.help ? 2 : 0;
  }

  if (args.command !== 'validate' && args.command !== 'migrate' && args.command !== 'gif') {
    console.error(`unknown command: ${args.command}\n`);
    console.error(USAGE);
    return 2;
  }

  if (args.paths.length === 0) {
    console.error(`${args.command} needs at least one file or directory\n`);
    console.error(USAGE);
    return 2;
  }

  try {
    if (args.command === 'validate') return await runValidate(args);
    if (args.command === 'migrate') return await runMigrate(args);
    return await runGif(args);
  } catch (cause) {
    console.error(`clotho: ${(cause as Error).message}`);
    return 2;
  }
}

process.exit(await main());
