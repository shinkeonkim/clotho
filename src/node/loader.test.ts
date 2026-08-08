import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDocumentIds, loadAllDocuments, loadDocument } from './loader';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clotho-loader-'));
  await writeFile(join(dir, 'good.json'), JSON.stringify({ clothoVersion: 1, id: 'good' }));
  await writeFile(join(dir, 'bad-id.json'), JSON.stringify({ clothoVersion: 1, id: 'Bad Id' }));
  await writeFile(join(dir, 'legacy.json'), JSON.stringify({ version: 4, id: 'legacy' }));
  await writeFile(join(dir, 'broken.json'), '{ not json');
  await writeFile(
    join(dir, 'bom.json'),
    `\ufeff${JSON.stringify({ clothoVersion: 1, id: 'bom' })}`,
  );
  await writeFile(join(dir, 'notes.txt'), 'ignored');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('listDocumentIds', () => {
  it('lists json files only, sorted', async () => {
    expect(await listDocumentIds(dir)).toEqual(['bad-id', 'bom', 'broken', 'good', 'legacy']);
  });

  it('returns nothing for a missing directory', async () => {
    expect(await listDocumentIds(join(dir, 'nope'))).toEqual([]);
  });
});

describe('loadDocument', () => {
  it('loads a valid document', async () => {
    const result = await loadDocument(dir, 'good');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.id).toBe('good');
  });

  it('strips a BOM', async () => {
    expect((await loadDocument(dir, 'bom')).ok).toBe(true);
  });

  // Legacy returned null here and the caller said "animation not found". The
  // uppercase-id case is exactly how an animation once shipped invisible.
  it('reports why a schema-invalid document failed instead of returning null', async () => {
    const result = await loadDocument(dir, 'bad-id');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.startsWith('id:'))).toBe(true);
      expect(result.file).toContain('bad-id.json');
    }
  });

  it('reports invalid JSON', async () => {
    const result = await loadDocument(dir, 'broken');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain('invalid JSON');
  });

  it('reports a missing file', async () => {
    const result = await loadDocument(dir, 'absent');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain('ENOENT');
  });

  it('gates legacy documents but migrates on request', async () => {
    expect((await loadDocument(dir, 'legacy')).ok).toBe(false);
    expect((await loadDocument(dir, 'legacy', { migrateLegacy: true })).ok).toBe(true);
  });

  it('refuses a traversing id without touching the filesystem', async () => {
    const result = await loadDocument(dir, '../../etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain('unsafe document id');
  });
});

describe('loadAllDocuments', () => {
  it('returns one result per file, good and bad alike', async () => {
    const results = await loadAllDocuments(dir);
    expect(results).toHaveLength(5);
    expect(
      results
        .filter((r) => r.ok)
        .map((r) => r.id)
        .sort(),
    ).toEqual(['bom', 'good']);
    expect(results.filter((r) => !r.ok)).toHaveLength(3);
  });

  it('lets a build step see every broken document in one pass', async () => {
    const failures = (await loadAllDocuments(dir)).filter((r) => !r.ok);
    expect(failures.map((f) => f.id).sort()).toEqual(['bad-id', 'broken', 'legacy']);
  });
});
