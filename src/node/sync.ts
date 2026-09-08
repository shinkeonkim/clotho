// `clotho sync` — refresh source-linked code elements from their files.
//
// The filesystem half of docs/SCHEMA-V1.md §2.17. Everything about *what* text a
// `source` selects lives in core/source; this reads the files, applies the result,
// and reports what moved.

import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { animationDocumentSchema, type AnimationDocument } from '../core/schema/document';
import type { CodeElement } from '../core/schema/elements';
import { extractSource, hashContent } from '../core/source';
import type { Finding } from '../core/validate/validate';

export interface SyncChange {
  readonly elementId: string;
  readonly file: string;
  /** Absent when the element had no recorded content to compare against. */
  readonly changed: boolean;
}

export interface SyncProblem {
  readonly elementId: string;
  readonly file: string;
  readonly message: string;
}

export interface SyncResult {
  readonly document: AnimationDocument;
  readonly changes: readonly SyncChange[];
  readonly problems: readonly SyncProblem[];
}

/** Read the file a source points at, relative to `root`. */
async function readSourceFile(root: string, file: string): Promise<string | null> {
  try {
    return await readFile(resolve(root, file), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Refresh every source-linked `code` element in a document.
 *
 * Returns a new document rather than mutating: the caller decides whether to write,
 * and `--check` wants the comparison without the side effect.
 */
export async function syncDocument(document: AnimationDocument, root: string): Promise<SyncResult> {
  const changes: SyncChange[] = [];
  const problems: SyncProblem[] = [];
  const cache = new Map<string, string | null>();

  const elements = await Promise.all(
    document.elements.map(async (element) => {
      if (element.type !== 'code' || !element.source) return element;
      const code = element as CodeElement;
      const source = code.source!;

      if (!cache.has(source.file)) cache.set(source.file, await readSourceFile(root, source.file));
      const text = cache.get(source.file) ?? null;
      if (text === null) {
        problems.push({
          elementId: code.id,
          file: source.file,
          message: `cannot read ${relative(process.cwd(), resolve(root, source.file))}`,
        });
        return element;
      }

      const extracted = extractSource(text, source);
      if (!extracted.ok) {
        problems.push({ elementId: code.id, file: source.file, message: extracted.message });
        return element;
      }

      changes.push({
        elementId: code.id,
        file: source.file,
        changed: extracted.text !== code.content,
      });

      return {
        ...code,
        content: extracted.text,
        source: { ...source, hash: await hashContent(extracted.text) },
      };
    }),
  );

  return { document: { ...document, elements }, changes, problems };
}

export interface SyncFileResult extends SyncResult {
  readonly file: string;
  readonly wrote: boolean;
}

/** Sync one document file, optionally writing the result back. */
export async function syncFile(
  file: string,
  root: string,
  options: { readonly write: boolean },
): Promise<SyncFileResult> {
  const parsed = animationDocumentSchema.parse(JSON.parse(await readFile(file, 'utf-8')));
  const result = await syncDocument(parsed, root);
  const changed = result.changes.some((change) => change.changed);

  // Written only when something actually moved: rewriting an unchanged file would
  // touch its mtime and show up in a diff for no reason.
  if (options.write && changed) {
    await writeFile(file, `${JSON.stringify(result.document, null, 2)}\n`, 'utf-8');
  }
  return { ...result, file, wrote: options.write && changed };
}

/**
 * Findings for documents that have fallen behind their sources.
 *
 * Not part of `validateDocument`, which is core and therefore must not read files —
 * so the freshness check lives here and the CLI appends its findings to the
 * validation report. The distinction matters: a document is *valid* whether or not
 * it is current, and only a caller with a filesystem can tell the difference.
 */
export async function checkSourceFreshness(
  document: AnimationDocument,
  root: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const cache = new Map<string, string | null>();

  for (const [index, element] of document.elements.entries()) {
    if (element.type !== 'code' || !element.source) continue;
    const source = element.source;
    const path = `elements.${index}.source`;

    if (!cache.has(source.file)) cache.set(source.file, await readSourceFile(root, source.file));
    const text = cache.get(source.file) ?? null;
    if (text === null) {
      findings.push({
        severity: 'warning',
        code: 'unreadable-source',
        path: `${path}.file`,
        message: `code "${element.id}" points at ${source.file}, which cannot be read`,
      });
      continue;
    }

    const extracted = extractSource(text, source);
    if (!extracted.ok) {
      findings.push({
        severity: 'warning',
        code: 'unresolved-source',
        path,
        message: `code "${element.id}": ${extracted.message}`,
      });
      continue;
    }

    if (extracted.text !== element.content) {
      findings.push({
        severity: 'warning',
        code: 'stale-code',
        path: `${path}.hash`,
        message: `code "${element.id}" no longer matches ${source.file} — run \`clotho sync\``,
      });
    }
  }

  return findings;
}
