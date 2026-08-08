import { describe, expect, it } from 'bun:test';
import { isSafeDocumentId, parseDocumentText, parseUnknown } from './parse';
import { createDocumentCache, documentUrl, fetchDocument, type FetchLike } from './fetch';

const v1 = JSON.stringify({ clothoVersion: 1, id: 'demo', title: 'Demo' });
const legacy = JSON.stringify({ version: 4, id: 'demo', title: 'Demo' });

describe('parseDocumentText', () => {
  it('parses a v1 document', () => {
    const result = parseDocumentText(v1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.title).toBe('Demo');
  });

  it('reports invalid JSON with the parser message', () => {
    const result = parseDocumentText('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain('invalid JSON');
  });

  // A BOM is invisible in every editor, so the raw JSON.parse error it produces is
  // one of the more baffling failures a loader can hand back.
  it('tolerates a UTF-8 BOM', () => {
    expect(parseDocumentText(`\ufeff${v1}`).ok).toBe(true);
  });

  it('refuses a legacy document by default, and says how to proceed', () => {
    const result = parseDocumentText(legacy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain('migrateLegacy');
  });

  it('migrates a legacy document when asked', () => {
    const result = parseDocumentText(legacy, { migrateLegacy: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.clothoVersion).toBe(1);
  });

  it('reports schema issues from a well-formed but invalid document', () => {
    const result = parseDocumentText('{"clothoVersion":1,"id":"Bad Id"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.startsWith('id:'))).toBe(true);
  });

  it('preserves non-ASCII content through the whole path', () => {
    const text = JSON.stringify({ clothoVersion: 1, id: 'demo', title: '벨만-포드 ✅' });
    const result = parseDocumentText(text);
    if (result.ok) expect(result.document.title).toBe('벨만-포드 ✅');
  });
});

describe('parseUnknown', () => {
  it('accepts an already-decoded value', () => {
    expect(parseUnknown({ clothoVersion: 1, id: 'demo' }).ok).toBe(true);
  });

  it('applies the same legacy gate', () => {
    expect(parseUnknown({ version: 4, id: 'demo' }).ok).toBe(false);
    expect(parseUnknown({ version: 4, id: 'demo' }, { migrateLegacy: true }).ok).toBe(true);
  });
});

describe('isSafeDocumentId', () => {
  it('accepts schema-shaped ids', () => {
    expect(isSafeDocumentId('bellman-ford')).toBe(true);
    expect(isSafeDocumentId('0-1-bfs')).toBe(true);
  });

  // The loader interpolates the id into a path before anything is parsed, so it
  // cannot rely on the schema having vetted it.
  it('rejects traversal and other unsafe shapes', () => {
    for (const id of ['../secrets', 'a/b', 'A', '', 'a b', './x', 'a%2F']) {
      expect(isSafeDocumentId(id), id).toBe(false);
    }
  });
});

function stubFetch(body: string, ok = true, status = 200): FetchLike {
  return () => Promise.resolve({ ok, status, text: () => Promise.resolve(body) });
}

describe('documentUrl', () => {
  it('builds a default path', () => {
    expect(documentUrl('demo')).toBe('/animations/demo.json');
  });

  it('honors a custom base and trims trailing slashes', () => {
    expect(documentUrl('demo', 'https://cdn.example.com/anim/')).toBe(
      'https://cdn.example.com/anim/demo.json',
    );
  });
});

describe('fetchDocument', () => {
  it('loads and parses a document', async () => {
    const result = await fetchDocument('demo', { fetch: stubFetch(v1) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.id).toBe('demo');
  });

  it('reports the HTTP status on failure', async () => {
    const result = await fetchDocument('demo', { fetch: stubFetch('', false, 404) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain('HTTP 404');
  });

  it('reports a thrown network error rather than propagating it', async () => {
    const result = await fetchDocument('demo', {
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain('offline');
  });

  it('rejects an unsafe id before making a request', async () => {
    let called = false;
    const result = await fetchDocument('../etc/passwd', {
      fetch: () => {
        called = true;
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(v1) });
      },
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('passes a cache mode through', async () => {
    let seen: unknown;
    await fetchDocument('demo', {
      cache: 'no-store',
      fetch: (_url, init) => {
        seen = init;
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(v1) });
      },
    });
    expect(seen).toEqual({ cache: 'no-store' });
  });
});

describe('createDocumentCache', () => {
  it('collapses repeated and concurrent loads into one request', async () => {
    let calls = 0;
    const cache = createDocumentCache({
      fetch: () => {
        calls += 1;
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(v1) });
      },
    });
    const [a, b] = await Promise.all([cache.load('demo'), cache.load('demo')]);
    await cache.load('demo');
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(cache.size).toBe(1);
  });

  it('clears', async () => {
    const cache = createDocumentCache({ fetch: stubFetch(v1) });
    await cache.load('demo');
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
