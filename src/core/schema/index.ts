// clotho v1 document schema. See docs/SCHEMA-V1.md for the format spec.

export * from './primitives';
export * from './assets';
export * from './elements';
export * from './layout';
export * from './checkpoints';
export * from './data';
export * from './responsive';
export * from './effects';
export * from './document';

import { animationDocumentSchema, type AnimationDocument } from './document';

export interface ParseSuccess {
  readonly ok: true;
  readonly document: AnimationDocument;
}

export interface ParseFailure {
  readonly ok: false;
  /** One `<path>: <message>` line per issue, ready to print. */
  readonly issues: readonly string[];
}

export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Parse an unknown value as a clotho v1 document.
 *
 * Returns a result rather than throwing: the common caller is a loader walking a
 * directory of documents, and one bad file should not abort the batch. Legacy's
 * loader swallowed failures into `null`, which is how an uppercase id once
 * shipped an animation that silently never rendered — so the issue list is part
 * of the return value, not something the caller has to reconstruct.
 */
export function parseDocument(value: unknown): ParseResult {
  const result = animationDocumentSchema.safeParse(value);
  if (result.success) return { ok: true, document: result.data };
  return { ok: false, issues: formatIssues(result.error) };
}

/**
 * Parse, or throw with every issue in the message. For callers that treat a
 * malformed document as a programmer error.
 */
export function parseDocumentOrThrow(value: unknown): AnimationDocument {
  const result = parseDocument(value);
  if (result.ok) return result.document;
  throw new Error(`invalid clotho document:\n  ${result.issues.join('\n  ')}`);
}

function formatIssues(error: {
  issues: readonly { path: unknown[]; message: string }[];
}): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
}
