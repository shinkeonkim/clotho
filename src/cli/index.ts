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
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { formatFindings, validateDocument, type Finding } from '../core/validate/validate';
import { migrateLegacyDocument, needsMigration } from '../core/migrate/legacy';
import { stripBom } from '../core/text/base64';
import { animationDocumentSchema } from '../core/schema/document';
import { writeDocumentGif } from '../node/gif';
import { autofixDocument, lintDocument, type LintFinding } from '../core/lint';
import { createDebouncer, listDocuments, runtimeDirFrom, startDevServer } from '../node/dev';
import { checkSourceFreshness, syncFile } from '../node/sync';

const USAGE = `clotho — JSON-defined visualization animations

Usage:
  clotho validate <path...> [options]   Check documents against the v1 schema and semantic rules
  clotho lint <path...> [--fix]         Check readability, accessibility, and authoring quality
  clotho migrate  <path...> [options]   Convert legacy (version 3/4) documents to v1
  clotho gif <input.json> <output.gif>   Render a document as an animated GIF
  clotho dev <dir> [options]            Serve a directory of documents with live reload
  clotho sync <path...> [--check]       Refresh source-linked code elements from their files

Options:
  --write     migrate only: rewrite files in place (default is a dry run)
  --fix       lint only: apply safe fixes in place
  --json      machine-readable output
  --quiet     exit code only, no output
  --strict    validate only: treat warnings as failures
  --fps N     gif only: frames per second (default: 12)
  --width N   gif only: output width in pixels (default: canvas width)
  --once      gif only: play once instead of looping forever
  --background COLOR  gif only: opaque raster background (default: #ffffff)
  --port N    dev only: port to listen on (default: 4173, 0 picks a free one)
  --host H    dev only: interface to bind (default: 127.0.0.1 — see below)
  --headless  dev only: watch and re-check without serving a page
  --check     sync only: report what is out of date without writing
  --root DIR  sync/validate: project root that source paths are relative to (default: cwd)
  -h, --help  show this help

Exit codes:
  0  success
  1  problems found
  2  bad invocation

clotho dev writes the files a browser sends it, so it binds to loopback. Do not put
it on a network you do not control.`;

interface Args {
  readonly command: string | undefined;
  readonly paths: string[];
  readonly write: boolean;
  readonly fix: boolean;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly strict: boolean;
  readonly help: boolean;
  readonly fps?: number;
  readonly width?: number;
  readonly once: boolean;
  readonly background?: string;
  readonly port?: number;
  readonly host?: string;
  readonly headless: boolean;
  readonly check: boolean;
  readonly root?: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (
      arg === '--fps' ||
      arg === '--width' ||
      arg === '--background' ||
      arg === '--port' ||
      arg === '--host' ||
      arg === '--root'
    ) {
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
    fix: flags.has('--fix'),
    json: flags.has('--json'),
    quiet: flags.has('--quiet'),
    strict: flags.has('--strict'),
    help: flags.has('-h') || flags.has('--help'),
    fps: values.has('--fps') ? Number(values.get('--fps')) : undefined,
    width: values.has('--width') ? Number(values.get('--width')) : undefined,
    once: flags.has('--once'),
    background: values.get('--background'),
    port: values.has('--port') ? Number(values.get('--port')) : undefined,
    host: values.get('--host'),
    headless: flags.has('--headless'),
    check: flags.has('--check'),
    root: values.get('--root'),
  };
}

async function runLint(args: Args): Promise<number> {
  const files = await collectFiles(args.paths);
  let problemCount = 0;
  let fixCount = 0;
  const reports: { file: string; findings: readonly LintFinding[] }[] = [];
  for (const file of files) {
    const parsed = animationDocumentSchema.safeParse(readJson(await readFile(file, 'utf-8')));
    if (!parsed.success)
      throw new Error(`${file}: document must pass schema validation before linting`);
    const result = args.fix ? autofixDocument(parsed.data) : null;
    if (result) {
      fixCount += result.fixes.length;
      if (result.fixes.length > 0)
        await writeFile(file, `${JSON.stringify(result.document, null, 2)}\n`, 'utf-8');
    }
    const findings = result?.remaining ?? lintDocument(parsed.data);
    problemCount += findings.length;
    reports.push({ file, findings });
  }
  if (args.json)
    console.log(
      JSON.stringify(
        {
          command: 'lint',
          fix: args.fix,
          fileCount: files.length,
          fixCount,
          problemCount,
          files: reports
            .map(({ file, findings }) => ({ file: relative(process.cwd(), file), findings }))
            .filter(({ findings }) => findings.length > 0),
        },
        null,
        2,
      ),
    );
  else if (!args.quiet) {
    for (const report of reports)
      for (const issue of report.findings)
        console.log(
          `${issue.severity.toUpperCase()} ${relative(process.cwd(), report.file)}:${issue.path} [${issue.ruleId}] ${issue.message}`,
        );
    console.log(
      `${problemCount === 0 ? 'OK' : 'FAILED'} — ${files.length} file(s), ${fixCount} fix(es), ${problemCount} problem(s)`,
    );
  }
  return problemCount > 0 ? 1 : 0;
}

async function runGif(args: Args): Promise<number> {
  if (args.paths.length !== 2)
    throw new Error('gif needs one input JSON file and one output GIF path');
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
    // Freshness is a filesystem question, so it cannot live in `validateDocument`
    // (core reads no files). It belongs in the same report, though: "this document
    // no longer matches the code it claims to show" is exactly what a validate run
    // in CI should surface.
    const freshness = result.document
      ? await checkSourceFreshness(result.document, resolve(args.root ?? process.cwd()))
      : [];

    reports.push({
      file,
      findings: [...result.findings, ...freshness],
      errorCount: result.errorCount + freshness.filter((f) => f.severity === 'error').length,
      warningCount: result.warningCount + freshness.filter((f) => f.severity === 'warning').length,
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

/**
 * `clotho sync` — bring source-linked code elements back in line with their files.
 *
 * `--check` is the CI shape: it reports and exits non-zero without touching
 * anything, so a pull request that changed the code and not the animation fails
 * before anyone has to notice by eye.
 */
async function runSync(args: Args): Promise<number> {
  const root = resolve(args.root ?? process.cwd());
  const files = await collectFiles(args.paths);
  const results = await Promise.all(
    files.map((file) => syncFile(file, root, { write: !args.check })),
  );

  const stale = results.filter((result) => result.changes.some((change) => change.changed));
  const problems = results.flatMap((result) =>
    result.problems.map((problem) => ({ ...problem, document: result.file })),
  );

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          command: 'sync',
          check: args.check,
          files: results.map((result) => ({
            file: relative(process.cwd(), result.file),
            wrote: result.wrote,
            changed: result.changes.filter((change) => change.changed).map((c) => c.elementId),
            problems: result.problems,
          })),
        },
        null,
        2,
      ),
    );
  } else if (!args.quiet) {
    for (const result of results) {
      for (const change of result.changes.filter((c) => c.changed)) {
        const verb = args.check ? 'out of date' : 'updated';
        console.log(
          `${relative(process.cwd(), result.file)} · ${change.elementId}: ${verb} from ${change.file}`,
        );
      }
      for (const problem of result.problems) {
        console.error(
          `${relative(process.cwd(), result.file)} · ${problem.elementId}: ${problem.message}`,
        );
      }
    }
    const summary = args.check
      ? `${stale.length} document(s) out of date`
      : `${results.filter((r) => r.wrote).length} document(s) updated`;
    console.log(`${summary}, ${problems.length} problem(s)`);
  }

  if (problems.length > 0) return 1;
  return args.check && stale.length > 0 ? 1 : 0;
}

/**
 * Directories for the bare specifiers `dist` leaves external.
 *
 * Only `zod` today, and the preview's own entry does not reach it — this is what
 * keeps a page that imports something heavier from failing on a bare specifier.
 * Resolved from this package rather than from the served project, so the version the
 * browser loads is the one the runtime was built against.
 */
function resolveRuntimeDeps(): Record<string, string> {
  const require = createRequire(import.meta.url);
  const deps: Record<string, string> = {};
  for (const name of ['zod']) {
    try {
      deps[name] = dirname(require.resolve(`${name}/package.json`));
    } catch {
      // Absent means the runtime does not need it here; the import map simply omits it.
    }
  }
  return deps;
}

/**
 * `clotho dev` — the file-based authoring loop.
 *
 * Runs until interrupted, which makes it the one command that does not return a
 * verdict. `--headless` is the same watcher without the page, for a terminal-only
 * workflow, CI preview, or a model editing documents and reading the findings back.
 */
async function runDev(args: Args): Promise<number> {
  const dir = resolve(args.paths[0]!);
  const runtimeDir = runtimeDirFrom(dirname(fileURLToPath(import.meta.url)));
  if (runtimeDir === null) {
    console.error('clotho: the built runtime is missing — run `bun run build` first');
    return 2;
  }

  const report = async (): Promise<void> => {
    const documents = await listDocuments(dir);
    const broken = documents.filter((entry) => !entry.ok);
    const warnings = documents.reduce((total, entry) => total + entry.warnings, 0);
    const stamp = new Date().toLocaleTimeString();
    console.log(
      `[${stamp}] ${documents.length} document(s), ${broken.length} failing, ${warnings} warning(s)`,
    );
    for (const entry of documents) {
      for (const issue of entry.issues) console.log(`  ${entry.id}: ${issue}`);
      for (const finding of entry.findings)
        if (finding.severity === 'error') console.log(`  ${entry.id}: ${finding.message}`);
    }
  };

  if (args.headless) {
    const { watch } = await import('node:fs');
    await report();
    const debouncer = createDebouncer(60, () => void report());
    try {
      watch(dir, { recursive: true }, (_event, filename) => {
        if (filename?.toString().endsWith('.json')) debouncer.push(filename.toString());
      });
    } catch {
      console.error('clotho: recursive watching is unavailable here; showing one report only');
      return 0;
    }
    console.log(`watching ${dir} — ctrl+c to stop`);
    await new Promise(() => {});
    return 0;
  }

  const server = await startDevServer({
    dir,
    runtimeDir,
    deps: resolveRuntimeDeps(),
    port: args.port ?? 4173,
    host: args.host,
    onChange: () => void report(),
  });
  console.log(`clotho dev → ${server.url}`);
  console.log(`serving ${dir}`);
  await report();
  await new Promise(() => {});
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.command === undefined) {
    console.log(USAGE);
    return args.command === undefined && !args.help ? 2 : 0;
  }

  if (
    args.command !== 'validate' &&
    args.command !== 'migrate' &&
    args.command !== 'gif' &&
    args.command !== 'lint' &&
    args.command !== 'dev' &&
    args.command !== 'sync'
  ) {
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
    if (args.command === 'lint') return await runLint(args);
    if (args.command === 'dev') return await runDev(args);
    if (args.command === 'sync') return await runSync(args);
    return await runGif(args);
  } catch (cause) {
    console.error(`clotho: ${(cause as Error).message}`);
    return 2;
  }
}

process.exit(await main());
