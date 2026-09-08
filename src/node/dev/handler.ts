// The dev server's routes, as a function rather than as a listener.
//
// Written this way so the routing, the traversal guards and the response shapes can
// be tested without opening a socket. The `node:http` binding in ./server.ts is a
// dozen lines of adapter on top.

import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { listDocuments, readAsset, readDocument, writeDocument } from './repository';
import { previewPage } from './preview';

export interface DevRequest {
  readonly method: string;
  /** Path only; the caller strips the query string. */
  readonly path: string;
  readonly body?: unknown;
}

export interface DevResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Buffer;
}

export interface DevContext {
  /** Absolute path of the directory being served. */
  readonly dir: string;
  /** Absolute path of the package's own `dist`, served as the browser runtime. */
  readonly runtimeDir: string;
  /**
   * Bare-specifier dependencies the runtime imports, as package name → directory.
   *
   * `dist` keeps its dependencies external, so any entry that reaches one of them
   * carries a bare specifier a browser cannot resolve. Serving those directories and
   * declaring an import map is what lets the page load the real build rather than a
   * copy compiled specially for it. The preview only needs the `dom` entry, which is
   * free of them; the map is what keeps that from being a constraint.
   */
  readonly deps?: Readonly<Record<string, string>>;
  /** Shown in the page header so two servers are distinguishable. */
  readonly label?: string;
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
};

const NO_STORE = { 'cache-control': 'no-store' } as const;

function json(status: number, value: unknown): DevResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
    body: JSON.stringify(value),
  };
}

function html(body: string): DevResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE },
    body,
  };
}

/**
 * Resolve a request path under a root, or null if it cannot be contained.
 *
 * Traversal is neutralized rather than rejected: `/../secrets.env` normalizes to
 * `/secrets.env` inside the root, which is how static file servers have always
 * behaved and keeps a legitimate `a/../b.json` working. The guarantee this function
 * makes is containment, not refusal — the result is always inside the root or null.
 *
 * Decoding happens first, because `%2e%2e%2f` is `../` by the time the filesystem
 * sees it, and the containment check uses a trailing separator so that
 * `/srv/animations-secret` does not count as being inside `/srv/animations`.
 */
export function resolveWithin(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const target = resolve(root, `.${normalize(`/${decoded}`)}`);
  const base = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(base) ? target : null;
}

/** One request. Pure apart from reading the two directories it is given. */
export async function handleDevRequest(
  request: DevRequest,
  context: DevContext,
): Promise<DevResponse> {
  const { method, path } = request;

  if (path === '/' || path === '/index.html') {
    if (method !== 'GET') return json(405, { error: 'method not allowed' });
    const importMap = Object.fromEntries(
      Object.keys(context.deps ?? {}).map((name) => [name, `/_clotho_deps/${name}/index.js`]),
    );
    return html(previewPage(context.label ?? context.dir, importMap));
  }

  if (path === '/api/documents') {
    if (method !== 'GET') return json(405, { error: 'method not allowed' });
    const documents = await listDocuments(context.dir);
    return json(200, {
      dir: context.dir,
      documents: documents.map(({ document: _document, ...summary }) => summary),
    });
  }

  const documentMatch = /^\/api\/documents\/(.+)$/.exec(path);
  if (documentMatch) {
    const id = decodeURIComponent(documentMatch[1]!);
    if (method === 'GET') {
      const detail = await readDocument(context.dir, id);
      return json(detail.document ? 200 : 404, detail);
    }
    if (method === 'PUT') {
      const result = await writeDocument(context.dir, id, request.body);
      return json(result.ok ? 200 : 400, result);
    }
    return json(405, { error: 'method not allowed' });
  }

  const depMatch = /^\/_clotho_deps\/([^/]+)\/(.*)$/.exec(path);
  if (depMatch) {
    if (method !== 'GET') return json(405, { error: 'method not allowed' });
    const root = context.deps?.[decodeURIComponent(depMatch[1]!)];
    if (!root) return json(404, { error: 'unknown dependency' });
    const target = resolveWithin(root, `/${depMatch[2]!}`);
    if (!target) return json(403, { error: 'outside the dependency directory' });
    const file = await readAsset(root, target.slice(root.length + 1));
    if (!file) return json(404, { error: 'not found' });
    return {
      status: 200,
      headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream', ...NO_STORE },
      body: file,
    };
  }

  // The package's own dist, so the preview page can import the real runtime rather
  // than a copy that could drift from it.
  if (path.startsWith('/_clotho/')) {
    if (method !== 'GET') return json(405, { error: 'method not allowed' });
    const relative = path.slice('/_clotho/'.length);
    const target = resolveWithin(context.runtimeDir, relative);
    if (!target) return json(403, { error: 'outside the runtime directory' });
    const file = await readAsset(context.runtimeDir, target.slice(context.runtimeDir.length + 1));
    if (!file) return json(404, { error: 'not found' });
    return {
      status: 200,
      headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream', ...NO_STORE },
      body: file,
    };
  }

  // Anything else is looked for in the served directory, so a document's `external`
  // image assets resolve the way they will in production.
  if (method === 'GET') {
    const target = resolveWithin(context.dir, path);
    if (!target) return json(403, { error: 'outside the served directory' });
    const file = await readAsset(context.dir, target.slice(context.dir.length + 1));
    if (file) {
      return {
        status: 200,
        headers: {
          'content-type': MIME[extname(target)] ?? 'application/octet-stream',
          ...NO_STORE,
        },
        body: file,
      };
    }
  }

  return json(404, { error: 'not found' });
}

/**
 * Where the package's built runtime lives, relative to the module doing the asking.
 *
 * Installed, the CLI is `dist/cli/index.js` and the answer is one level up. Run from
 * source during development it is `src/cli/index.ts`, where the sibling directory
 * holds TypeScript the browser cannot import — so the repository's `dist` is tried
 * as well. Checked rather than assumed, because a wrong guess here produces a page
 * that loads and then silently imports nothing.
 */
export function runtimeDirFrom(moduleDir: string): string | null {
  const candidates = [
    join(moduleDir, '..'),
    join(moduleDir, '..', '..', 'dist'),
    join(moduleDir, '..', '..', '..', 'dist'),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'core', 'index.js'))) ?? null;
}
