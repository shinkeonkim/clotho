// Extracting a `code` element's text from a source file.
//
// Pure string work, in the core, so the same rules apply wherever they run: the CLI
// syncing a directory, the validator deciding whether a document has fallen behind,
// and a test asserting either. Reading the file is the caller's job — that is the
// only part that needs a filesystem, and it is the part the browser must never do.

import type { CodeSource } from '../schema/source';

export interface ExtractSuccess {
  readonly ok: true;
  readonly text: string;
  /** 1-based line span the text came from, for error messages. */
  readonly from: number;
  readonly to: number;
}

export interface ExtractFailure {
  readonly ok: false;
  readonly reason:
    | 'missing-region'
    | 'unterminated-region'
    | 'duplicate-region'
    | 'empty-region'
    | 'lines-out-of-range'
    | 'no-selector';
  readonly message: string;
}

export type ExtractResult = ExtractSuccess | ExtractFailure;

/**
 * Region markers, in the comment syntaxes that actually appear in source files.
 *
 * Matched loosely on purpose: a marker is a comment, and which comment leader a
 * language uses is not something the document should have to declare.
 */
const REGION_START = /^\s*(?:\/\/|#|--|\/\*|<!--|;)\s*#?region\s+([A-Za-z0-9_-]+)/i;
const REGION_END = /^\s*(?:\/\/|#|--|\/\*|<!--|;)\s*#?endregion\b/i;

/** Split on any line ending, keeping the caller free of platform concerns. */
function toLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * Remove the indentation every line shares.
 *
 * A region inside a function is indented by its surroundings, and a snippet that
 * arrives pre-indented by eight spaces wastes a third of the code element's width on
 * nothing. Blank lines are ignored when measuring, since they are usually empty
 * rather than deliberately un-indented.
 */
export function dedent(lines: readonly string[]): string[] {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => /^[ \t]*/.exec(line)![0]!.length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(common));
}

function extractRegion(source: string, region: string): ExtractResult {
  const lines = toLines(source);

  // Counted across the whole file before extracting, not while extracting: a second
  // declaration usually appears *after* the first one closes, so noticing it on the
  // way past would mean never noticing it at all. Two spans with one name is
  // ambiguous, and picking the first silently is how a document ends up showing the
  // wrong snippet with no sign of trouble.
  const declarations = lines.filter((line) => REGION_START.exec(line)?.[1] === region).length;
  if (declarations > 1) {
    return {
      ok: false,
      reason: 'duplicate-region',
      message: `region "${region}" is declared ${declarations} times`,
    };
  }

  let start: number | null = null;
  let end: number | null = null;
  let depth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const opened = REGION_START.exec(line);

    if (opened) {
      if (opened[1] === region) {
        start = i + 1;
        depth = 0;
        continue;
      }
      // A differently named region nested inside ours: track it so its `#endregion`
      // does not close ours early.
      if (start !== null) depth += 1;
      continue;
    }

    if (REGION_END.test(line) && start !== null) {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      end = i;
      break;
    }
  }

  if (start === null) {
    return { ok: false, reason: 'missing-region', message: `region "${region}" was not found` };
  }
  if (end === null) {
    return {
      ok: false,
      reason: 'unterminated-region',
      message: `region "${region}" has no #endregion`,
    };
  }

  const body = dedent(lines.slice(start, end));
  // Trim blank lines at the edges: a marker on its own line usually has one.
  while (body.length > 0 && body[0]!.trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1]!.trim() === '') body.pop();

  if (body.length === 0) {
    return { ok: false, reason: 'empty-region', message: `region "${region}" is empty` };
  }
  return { ok: true, text: body.join('\n'), from: start + 1, to: end };
}

function extractLines(source: string, span: readonly [number, number]): ExtractResult {
  const lines = toLines(source);
  const [from, to] = span;
  if (from > to || from < 1 || to > lines.length) {
    return {
      ok: false,
      reason: 'lines-out-of-range',
      message: `lines ${from}–${to} are outside a file of ${lines.length} line(s)`,
    };
  }
  return { ok: true, text: dedent(lines.slice(from - 1, to)).join('\n'), from, to };
}

/** The text a `source` selects out of the file's contents. */
export function extractSource(fileText: string, source: CodeSource): ExtractResult {
  if (source.region !== undefined) return extractRegion(fileText, source.region);
  if (source.lines !== undefined) return extractLines(fileText, source.lines);
  return {
    ok: false,
    reason: 'no-selector',
    message: 'source needs either a region or a line range',
  };
}

/**
 * Content hash, as `sha256:<hex>`.
 *
 * Line endings are normalized first so a document synced on Windows does not read as
 * stale on Linux, and vice versa.
 */
export async function hashContent(text: string): Promise<string> {
  const normalized = text.replace(/\r\n/g, '\n');
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

/** Whether `content` still matches what `source.hash` recorded. */
export async function isStale(content: string, source: CodeSource): Promise<boolean> {
  if (source.hash === undefined) return false;
  return (await hashContent(content)) !== source.hash;
}
