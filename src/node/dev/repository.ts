// The filesystem as a document repository.
//
// The editor already abstracts storage behind `AnimationRepository`, and its two
// implementations are browser storage and an HTTP API. Neither can be a directory in
// a git working tree, because a browser cannot reach one — which is the whole reason
// the authoring loop still ends in "download the JSON and move it into the repo".
//
// This is that missing implementation, on the server side of the same interface.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeDocumentId } from '../../core/load/parse';
import { validateDocument, type Finding } from '../../core/validate/validate';
import { lintDocument, type LintFinding } from '../../core/lint';
import type { AnimationDocument } from '../../core/schema/document';
import { listDocumentIds, loadDocument } from '../loader';

export interface DocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly duration: number;
  readonly ok: boolean;
  /** Count of error-severity findings, so the list can show a state without the detail. */
  readonly errors: number;
  readonly warnings: number;
}

export interface DocumentDetail extends DocumentSummary {
  readonly document: AnimationDocument | null;
  readonly issues: readonly string[];
  readonly findings: readonly Finding[];
  readonly lint: readonly LintFinding[];
}

/**
 * Check a document the way the CLI would, so the browser sees the same verdict.
 *
 * Running both here rather than in the page is what makes the dev loop worth
 * having: today an author saves, switches to a terminal, and runs `clotho validate`
 * to find out what they broke.
 */
export function inspect(id: string, document: AnimationDocument): DocumentDetail {
  const validation = validateDocument(document);
  const lint = lintDocument(document);
  return {
    id,
    title: document.title,
    duration: document.duration,
    ok: validation.findings.every((finding) => finding.severity !== 'error'),
    errors: validation.findings.filter((finding) => finding.severity === 'error').length,
    warnings:
      validation.findings.filter((finding) => finding.severity === 'warning').length + lint.length,
    document,
    issues: [],
    findings: validation.findings,
    lint,
  };
}

function failure(id: string, issues: readonly string[]): DocumentDetail {
  return {
    id,
    title: id,
    duration: 0,
    ok: false,
    errors: issues.length,
    warnings: 0,
    document: null,
    issues,
    findings: [],
    lint: [],
  };
}

/** Every document in `dir`, broken ones included and marked. */
export async function listDocuments(dir: string): Promise<DocumentDetail[]> {
  const ids = await listDocumentIds(dir);
  return Promise.all(ids.map((id) => readDocument(dir, id)));
}

export async function readDocument(dir: string, id: string): Promise<DocumentDetail> {
  const result = await loadDocument(dir, id);
  return result.ok ? inspect(id, result.document) : failure(id, result.issues);
}

export interface WriteResult {
  readonly ok: boolean;
  readonly issues: readonly string[];
  readonly detail?: DocumentDetail;
}

/**
 * Write a document back to `<dir>/<id>.json`.
 *
 * The id is checked against the same pattern the loader uses before it touches the
 * filesystem. This endpoint accepts input from a browser and writes to disk, so a
 * `../` in the id would be a path traversal rather than merely a bad name.
 *
 * The document is parsed before it is written: a dev server that happily persists a
 * malformed file has made the loop worse, not better.
 */
export async function writeDocument(dir: string, id: string, value: unknown): Promise<WriteResult> {
  if (!isSafeDocumentId(id)) {
    return { ok: false, issues: [`unsafe document id ${JSON.stringify(id)}`] };
  }

  const { parseDocument } = await import('../../core/schema/index');
  const parsed = parseDocument(value);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };

  // Two-space JSON with a trailing newline: what prettier produces for these files,
  // so writing one does not show up as a whitespace diff.
  await writeFile(join(dir, `${id}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  return { ok: true, issues: [], detail: inspect(id, parsed.document) };
}

/** Read a file under `dir`, refusing anything that resolves outside it. */
export async function readAsset(dir: string, relativePath: string): Promise<Buffer | null> {
  const resolved = join(dir, relativePath);
  if (!resolved.startsWith(dir)) return null;
  try {
    return await readFile(resolved);
  } catch {
    return null;
  }
}
