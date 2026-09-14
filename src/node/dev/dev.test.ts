// Dev server tests.
//
// The routing and the guards are tested through `handleDevRequest` rather than
// through a socket, which is why that function takes a request shape instead of
// being a listener. The two things worth being strict about are path traversal —
// this server writes files a browser sends it — and that a broken document does not
// take the whole listing down with it.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleDevRequest, resolveWithin, type DevContext } from './handler';
import { createDebouncer } from './server';
import { listDocuments, readDocument, writeDocument } from './repository';

const ALWAYS = [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }];

const sampleDocument = (id: string, over: Record<string, unknown> = {}) => ({
  clothoVersion: 1,
  id,
  title: `Document ${id}`,
  duration: 1000,
  canvas: { width: 200, height: 100 },
  elements: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, appearances: ALWAYS }],
  ...over,
});

let dir: string;
let runtimeDir: string;
let context: DevContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clotho-dev-'));
  runtimeDir = await mkdtemp(join(tmpdir(), 'clotho-rt-'));
  context = { dir, runtimeDir, label: 'test' };
  await writeFile(join(dir, 'alpha.json'), JSON.stringify(sampleDocument('alpha')), 'utf-8');
  await writeFile(join(dir, 'beta.json'), JSON.stringify(sampleDocument('beta')), 'utf-8');
  await writeFile(join(runtimeDir, 'clotho.css'), '.cloth-wrapper{}', 'utf-8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(runtimeDir, { recursive: true, force: true });
});

const body = (response: { body: string | Buffer }): unknown => JSON.parse(response.body.toString());

describe('resolveWithin', () => {
  it('accepts a path inside the root', () => {
    expect(resolveWithin('/srv/docs', '/a/b.json')).toBe('/srv/docs/a/b.json');
  });

  it('keeps a legitimate interior climb working', () => {
    expect(resolveWithin('/srv/docs', '/a/../b.json')).toBe('/srv/docs/b.json');
  });

  /**
   * The guarantee is containment, not refusal: a climb is folded back to the root
   * the way every static file server folds it, so what matters is that no input
   * produces a path outside.
   */
  it.each([
    '/../secrets.env',
    '/a/../../secrets.env',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/../docs-secret/x',
    '/....//....//etc/passwd',
    '/a/b/../../../../../../etc/passwd',
  ])('contains %s inside the root', (attempt) => {
    const resolved = resolveWithin('/srv/docs', attempt);
    expect(resolved === null || resolved.startsWith('/srv/docs/') || resolved === '/srv/docs').toBe(
      true,
    );
    expect(resolved).not.toContain('/srv/docs-secret');
  });

  it('refuses a null byte and undecodable input outright', () => {
    expect(resolveWithin('/srv/docs', '/a%00b')).toBeNull();
    expect(resolveWithin('/srv/docs', '/%')).toBeNull();
  });
});

describe('repository', () => {
  it('lists every document with a verdict', async () => {
    const documents = await listDocuments(dir);
    expect(documents.map((d) => d.id).sort()).toEqual(['alpha', 'beta']);
    expect(documents.every((d) => d.ok)).toBe(true);
  });

  it('keeps listing when one file is broken', async () => {
    await writeFile(join(dir, 'broken.json'), '{ not json', 'utf-8');
    const documents = await listDocuments(dir);
    expect(documents).toHaveLength(3);
    const broken = documents.find((d) => d.id === 'broken')!;
    expect(broken.ok).toBe(false);
    expect(broken.document).toBeNull();
    expect(broken.issues.length).toBeGreaterThan(0);
  });

  it('reports schema failures rather than swallowing them', async () => {
    await writeFile(join(dir, 'bad.json'), JSON.stringify({ clothoVersion: 1 }), 'utf-8');
    const detail = await readDocument(dir, 'bad');
    expect(detail.ok).toBe(false);
    expect(detail.issues.join(' ')).toContain('id');
  });

  it('writes a document back and round-trips it', async () => {
    const next = sampleDocument('alpha', { title: 'Renamed' });
    const result = await writeDocument(dir, 'alpha', next);
    expect(result.ok).toBe(true);
    const text = await readFile(join(dir, 'alpha.json'), 'utf-8');
    expect(JSON.parse(text).title).toBe('Renamed');
    // Two-space JSON with a trailing newline, so a save is not a whitespace diff.
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "id"');
  });

  it('refuses to write a document that does not parse', async () => {
    const before = await readFile(join(dir, 'alpha.json'), 'utf-8');
    const result = await writeDocument(dir, 'alpha', { clothoVersion: 1 });
    expect(result.ok).toBe(false);
    expect(await readFile(join(dir, 'alpha.json'), 'utf-8')).toBe(before);
  });

  it('refuses an id that would escape the directory', async () => {
    const result = await writeDocument(dir, '../escaped', sampleDocument('escaped'));
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toContain('unsafe');
  });
});

describe('routes', () => {
  it('serves the preview page', async () => {
    const response = await handleDevRequest({ method: 'GET', path: '/' }, context);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body.toString()).toContain('/_clotho/dom/index.js');
  });

  it('lists documents without their contents', async () => {
    const response = await handleDevRequest({ method: 'GET', path: '/api/documents' }, context);
    expect(response.status).toBe(200);
    const payload = body(response) as { documents: { id: string; document?: unknown }[] };
    expect(payload.documents.map((d) => d.id).sort()).toEqual(['alpha', 'beta']);
    // The listing is a sidebar; shipping every document with it would send the whole
    // directory on each reload.
    expect(payload.documents[0]!.document).toBeUndefined();
  });

  it('serves one document with its findings', async () => {
    const response = await handleDevRequest(
      { method: 'GET', path: '/api/documents/alpha' },
      context,
    );
    expect(response.status).toBe(200);
    const payload = body(response) as { document: { id: string }; findings: unknown[] };
    expect(payload.document.id).toBe('alpha');
    expect(Array.isArray(payload.findings)).toBe(true);
  });

  it('404s an unknown document', async () => {
    const response = await handleDevRequest(
      { method: 'GET', path: '/api/documents/nope' },
      context,
    );
    expect(response.status).toBe(404);
  });

  it('writes through PUT and rejects a malformed body', async () => {
    const ok = await handleDevRequest(
      {
        method: 'PUT',
        path: '/api/documents/alpha',
        body: sampleDocument('alpha', { title: 'X' }),
      },
      context,
    );
    expect(ok.status).toBe(200);

    const bad = await handleDevRequest(
      { method: 'PUT', path: '/api/documents/alpha', body: { nope: true } },
      context,
    );
    expect(bad.status).toBe(400);
  });

  it('refuses a traversing document id on write', async () => {
    const response = await handleDevRequest(
      { method: 'PUT', path: '/api/documents/..%2fescaped', body: sampleDocument('escaped') },
      context,
    );
    expect(response.status).toBe(400);
  });

  it('serves the package runtime', async () => {
    const response = await handleDevRequest(
      { method: 'GET', path: '/_clotho/clotho.css' },
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/css');
  });

  it('cannot be walked out of the runtime directory to a real file', async () => {
    // A real, readable file one level up: if traversal worked, this would be served.
    const outside = join(runtimeDir, '..', 'clotho-dev-outside-secret.txt');
    await writeFile(outside, 'secret', 'utf-8');
    try {
      const response = await handleDevRequest(
        { method: 'GET', path: '/_clotho/../clotho-dev-outside-secret.txt' },
        context,
      );
      expect(response.status).toBe(404);
      expect(response.body.toString()).not.toContain('secret');
    } finally {
      await rm(outside, { force: true });
    }
  });

  it('serves assets sitting beside the documents', async () => {
    await mkdir(join(dir, 'img'), { recursive: true });
    await writeFile(join(dir, 'img', 'logo.svg'), '<svg/>', 'utf-8');
    const response = await handleDevRequest({ method: 'GET', path: '/img/logo.svg' }, context);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/svg+xml');
  });

  it('rejects the wrong method rather than falling through', async () => {
    const response = await handleDevRequest({ method: 'DELETE', path: '/api/documents' }, context);
    expect(response.status).toBe(405);
  });
});

describe('createDebouncer', () => {
  it('collapses a burst into one flush', async () => {
    const batches: readonly string[][] = [];
    const collected: string[][] = [];
    const debouncer = createDebouncer(10, (paths) => collected.push([...paths]));
    debouncer.push('a.json');
    debouncer.push('b.json');
    debouncer.push('c.json');
    await new Promise((done) => setTimeout(done, 30));
    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual(['a.json', 'b.json', 'c.json']);
    expect(batches).toEqual([]);
  });

  it('flushes again after the window', async () => {
    const collected: string[][] = [];
    const debouncer = createDebouncer(10, (paths) => collected.push([...paths]));
    debouncer.push('a.json');
    await new Promise((done) => setTimeout(done, 30));
    debouncer.push('b.json');
    await new Promise((done) => setTimeout(done, 30));
    expect(collected).toEqual([['a.json'], ['b.json']]);
  });

  it('drops pending work when cancelled', async () => {
    const collected: string[][] = [];
    const debouncer = createDebouncer(10, (paths) => collected.push([...paths]));
    debouncer.push('a.json');
    debouncer.cancel();
    await new Promise((done) => setTimeout(done, 30));
    expect(collected).toEqual([]);
  });
});
