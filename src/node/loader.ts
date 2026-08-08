// Filesystem loader. Ported from shinkeonkim's engine/loader.ts.
//
// Lives in the node adapter rather than the core so browser bundles never pull in
// `node:fs` (docs/ARCHITECTURE.md §1).
//
// One behavior deliberately changed: legacy returned `null` for any failure —
// missing file, bad JSON, schema violation — and its caller rendered "animation not
// found". That is how an uppercase id once shipped an animation that silently never
// drew. Here every loader returns the issues alongside the failure.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeDocumentId, parseDocumentText, type LoadOptions } from '../core/load/parse';
import type { AnimationDocument } from '../core/schema/document';

export interface FileLoadFailure {
  readonly ok: false;
  readonly id: string;
  readonly file: string;
  readonly issues: readonly string[];
}

export interface FileLoadSuccess {
  readonly ok: true;
  readonly id: string;
  readonly file: string;
  readonly document: AnimationDocument;
}

export type FileLoadResult = FileLoadSuccess | FileLoadFailure;

/** Names of the `.json` files in `dir`, sorted. Empty when the directory is absent. */
export async function listDocumentFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

/** Document ids in `dir`, derived from filenames. */
export async function listDocumentIds(dir: string): Promise<string[]> {
  return (await listDocumentFiles(dir)).map((name) => name.replace(/\.json$/, ''));
}

/**
 * Load `<dir>/<id>.json`.
 *
 * The id is pattern-checked before it reaches the filesystem: it arrives from a
 * URL or a markdown fence, and `../` in it would otherwise read outside `dir`.
 */
export async function loadDocument(
  dir: string,
  id: string,
  options: LoadOptions = {},
): Promise<FileLoadResult> {
  const file = join(dir, `${id}.json`);

  if (!isSafeDocumentId(id)) {
    return {
      ok: false,
      id,
      file,
      issues: [`<root>: unsafe document id ${JSON.stringify(id)}`],
    };
  }

  let text: string;
  try {
    text = await readFile(file, 'utf-8');
  } catch (cause) {
    return { ok: false, id, file, issues: [`<root>: ${(cause as Error).message}`] };
  }

  const parsed = parseDocumentText(text, options);
  if (!parsed.ok) return { ok: false, id, file, issues: parsed.issues };
  return { ok: true, id, file, document: parsed.document };
}

/**
 * Load every document in `dir`, reporting per-file outcomes.
 *
 * Returns results rather than throwing on the first bad file: a build step wants to
 * list all the broken documents in one pass, not fix them one rebuild at a time.
 */
export async function loadAllDocuments(
  dir: string,
  options: LoadOptions = {},
): Promise<FileLoadResult[]> {
  const ids = await listDocumentIds(dir);
  return Promise.all(ids.map((id) => loadDocument(dir, id, options)));
}
