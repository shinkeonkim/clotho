// Browser loader.
//
// `fetch` is a global in every environment clotho targets (browsers, Node 18+,
// Bun, Deno), so this stays in the core — it needs no DOM and no node: builtins.
// An injectable `fetch` keeps it testable and lets a host add auth headers or its
// own caching.
//
// Ported from shinkeonkim's hydrate-animations.ts, which had the fetch and the
// React root creation tangled together; only the fetching belongs here.

import { isSafeDocumentId, parseDocumentText, type LoadOptions } from './parse';
import type { AnimationDocument } from '../schema/document';

/**
 * Cache modes, spelled out rather than referencing the DOM's `RequestCache`.
 *
 * The published `.d.ts` must not depend on `lib.dom`: a Node consumer without DOM
 * types would otherwise fail to compile against this package.
 */
export type FetchCacheMode =
  'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';

/** The part of `Response` this loader touches, structurally. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { cache?: FetchCacheMode },
) => Promise<FetchResponseLike>;

export interface FetchLoadOptions extends LoadOptions {
  /** Base URL or path documents live under. Default `/animations`. */
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  readonly cache?: FetchCacheMode;
}

export interface FetchLoadFailure {
  readonly ok: false;
  readonly id: string;
  readonly url: string;
  readonly issues: readonly string[];
}

export interface FetchLoadSuccess {
  readonly ok: true;
  readonly id: string;
  readonly url: string;
  readonly document: AnimationDocument;
}

export type FetchLoadResult = FetchLoadSuccess | FetchLoadFailure;

const DEFAULT_BASE = '/animations';

export function documentUrl(id: string, baseUrl: string = DEFAULT_BASE): string {
  return `${baseUrl.replace(/\/+$/, '')}/${id}.json`;
}

/**
 * Fetch and parse one document.
 *
 * Reads the body as text rather than calling `response.json()` so a BOM can be
 * stripped first — `json()` would throw on it with no useful message.
 */
export async function fetchDocument(
  id: string,
  options: FetchLoadOptions = {},
): Promise<FetchLoadResult> {
  const url = documentUrl(id, options.baseUrl);

  if (!isSafeDocumentId(id)) {
    return { ok: false, id, url, issues: [`<root>: unsafe document id ${JSON.stringify(id)}`] };
  }

  // globalThis.fetch is standard in browsers, Node 18+, Bun, and Deno alike, so
  // this is portable rather than a DOM dependency. Cast because the global's
  // Response is wider than the structural type used above.
  const doFetch: FetchLike =
    options.fetch ?? ((u, init) => (globalThis.fetch as unknown as FetchLike)(u, init));

  let text: string;
  try {
    const response = await doFetch(url, options.cache ? { cache: options.cache } : undefined);
    if (!response.ok) {
      return { ok: false, id, url, issues: [`<root>: HTTP ${response.status} for ${url}`] };
    }
    text = await response.text();
  } catch (cause) {
    return { ok: false, id, url, issues: [`<root>: ${(cause as Error).message}`] };
  }

  const parsed = parseDocumentText(text, options);
  if (!parsed.ok) return { ok: false, id, url, issues: parsed.issues };
  return { ok: true, id, url, document: parsed.document };
}

/**
 * A fetcher that remembers in-flight and completed requests by id.
 *
 * The same animation often appears more than once on a page, and legacy cached
 * promises for exactly this reason. Caching the promise (not the result) also
 * collapses concurrent requests for the same id into one.
 */
export function createDocumentCache(options: FetchLoadOptions = {}) {
  const inFlight = new Map<string, Promise<FetchLoadResult>>();

  return {
    load(id: string): Promise<FetchLoadResult> {
      const existing = inFlight.get(id);
      if (existing) return existing;
      const promise = fetchDocument(id, options);
      inFlight.set(id, promise);
      return promise;
    },
    clear(): void {
      inFlight.clear();
    },
    get size(): number {
      return inFlight.size;
    },
  };
}
