// Text → document, with the encoding hazards handled.
//
// Kept separate from the fetch and filesystem loaders so both share one notion of
// "read this JSON safely", and so the core keeps no I/O of its own.

import { parseDocument, type ParseResult } from '../schema';
import { migrateLegacyDocument, needsMigration } from '../migrate/legacy';
import { stripBom } from '../text/base64';

export interface LoadOptions {
  /**
   * Migrate a legacy document instead of rejecting it. Off by default: silently
   * accepting legacy input is how a codebase ends up permanently bilingual.
   */
  readonly migrateLegacy?: boolean;
}

export interface LoadFailure {
  readonly ok: false;
  readonly issues: readonly string[];
}

export type LoadResult = ParseResult | LoadFailure;

/**
 * Parse JSON text into a document.
 *
 * Strips a UTF-8 BOM first: a leading BOM makes `JSON.parse` throw on a character
 * no editor displays, and files that have been through a Windows tool or an Excel
 * export routinely carry one.
 */
export function parseDocumentText(text: string, options: LoadOptions = {}): LoadResult {
  let json: unknown;
  try {
    json = JSON.parse(stripBom(text)) as unknown;
  } catch (cause) {
    return { ok: false, issues: [`<root>: invalid JSON — ${(cause as Error).message}`] };
  }
  return parseUnknown(json, options);
}

/** Parse an already-decoded value, migrating first when asked. */
export function parseUnknown(value: unknown, options: LoadOptions = {}): LoadResult {
  if (needsMigration(value)) {
    if (!options.migrateLegacy) {
      return {
        ok: false,
        issues: [
          '<root>: legacy (version 3/4) document — pass { migrateLegacy: true } or migrate it on disk',
        ],
      };
    }
    return parseDocument(migrateLegacyDocument(value).document);
  }
  return parseDocument(value);
}

/** Document id pattern, mirrored from the schema for path-safety checks. */
const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * True when `id` is safe to interpolate into a path or URL.
 *
 * Loaders build `${dir}/${id}.json`, so an id containing `../` would escape the
 * directory. The schema already constrains ids, but a loader is handed the id
 * *before* anything is parsed, so it has to check for itself.
 */
export function isSafeDocumentId(id: string): boolean {
  return SAFE_ID.test(id);
}
