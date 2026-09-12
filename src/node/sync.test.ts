// `clotho sync` tests, against a real temporary project.
//
// The extraction rules are covered in core/source; what matters here is the
// filesystem behaviour — what gets written, what does not, and whether a document
// that has fallen behind its source is reported rather than quietly rendered.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { animationDocumentSchema } from '../core/schema/document';
import { buildScene } from '../core/scene/build';
import { checkSourceFreshness, syncDocument, syncFile } from './sync';

const SOURCE = [
  'export function outer() {',
  '  // #region compute',
  '  const a = 1;',
  '  const b = 2;',
  '  return a + b;',
  '  // #endregion',
  '}',
].join('\n');

const EXPECTED = 'const a = 1;\nconst b = 2;\nreturn a + b;';

const codeDocument = (over: Record<string, unknown> = {}) =>
  animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'doc',
    duration: 1000,
    elements: [
      {
        type: 'code',
        id: 'snippet',
        x: 10,
        y: 10,
        width: 300,
        height: 120,
        content: 'STALE',
        language: 'typescript',
        source: { file: 'src/example.ts', region: 'compute' },
        appearances: [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }],
        ...over,
      },
    ],
  });

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clotho-sync-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'example.ts'), SOURCE, 'utf-8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('syncDocument', () => {
  it('replaces the content with what the region holds', async () => {
    const result = await syncDocument(codeDocument(), root);
    const element = result.document.elements[0] as { content: string };
    expect(element.content).toBe(EXPECTED);
    expect(result.changes).toEqual([
      { elementId: 'snippet', file: 'src/example.ts', changed: true },
    ]);
  });

  it('records a hash so a later run can tell whether anything moved', async () => {
    const result = await syncDocument(codeDocument(), root);
    const element = result.document.elements[0] as { source: { hash?: string } };
    expect(element.source.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('reports no change when the content is already current', async () => {
    const first = await syncDocument(codeDocument(), root);
    const second = await syncDocument(first.document, root);
    expect(second.changes[0]!.changed).toBe(false);
  });

  it('leaves other fields alone', async () => {
    const result = await syncDocument(codeDocument({ title: 'kept', fontSize: 15 }), root);
    const element = result.document.elements[0] as { title?: string; fontSize: number };
    expect(element.title).toBe('kept');
    expect(element.fontSize).toBe(15);
  });

  it('leaves code elements without a source untouched', async () => {
    const plain = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'plain',
      duration: 1000,
      elements: [
        {
          type: 'code',
          id: 'literal',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          content: 'hand written',
          appearances: [{ start: 0, end: 1000 }],
        },
      ],
    });
    const result = await syncDocument(plain, root);
    expect((result.document.elements[0] as { content: string }).content).toBe('hand written');
    expect(result.changes).toEqual([]);
  });

  it('reports a file it cannot read instead of blanking the content', async () => {
    const result = await syncDocument(
      codeDocument({ source: { file: 'src/gone.ts', region: 'compute' } }),
      root,
    );
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.message).toContain('cannot read');
    expect((result.document.elements[0] as { content: string }).content).toBe('STALE');
  });

  it('reports a region that is not in the file', async () => {
    const result = await syncDocument(
      codeDocument({ source: { file: 'src/example.ts', region: 'absent' } }),
      root,
    );
    expect(result.problems[0]!.message).toContain('not found');
  });
});

describe('syncFile', () => {
  it('writes the refreshed document', async () => {
    const file = join(root, 'doc.json');
    await writeFile(file, JSON.stringify(codeDocument()), 'utf-8');

    const result = await syncFile(file, root, { write: true });
    expect(result.wrote).toBe(true);
    const written = JSON.parse(await readFile(file, 'utf-8'));
    expect(written.elements[0].content).toBe(EXPECTED);
  });

  it('does not touch a file that is already current', async () => {
    const file = join(root, 'doc.json');
    await writeFile(file, JSON.stringify(codeDocument()), 'utf-8');
    await syncFile(file, root, { write: true });

    const before = await stat(file);
    await new Promise((done) => setTimeout(done, 10));
    const second = await syncFile(file, root, { write: true });

    expect(second.wrote).toBe(false);
    // Rewriting an unchanged file would move its mtime and show up in a diff.
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it('writes nothing when asked only to check', async () => {
    const file = join(root, 'doc.json');
    await writeFile(file, JSON.stringify(codeDocument()), 'utf-8');

    const result = await syncFile(file, root, { write: false });
    expect(result.changes[0]!.changed).toBe(true);
    expect(result.wrote).toBe(false);
    expect(JSON.parse(await readFile(file, 'utf-8')).elements[0].content).toBe('STALE');
  });
});

describe('checkSourceFreshness', () => {
  it('says nothing about a document that matches its source', async () => {
    const synced = (await syncDocument(codeDocument(), root)).document;
    expect(await checkSourceFreshness(synced, root)).toEqual([]);
  });

  it('reports a document that has fallen behind, with the fix', async () => {
    const findings = await checkSourceFreshness(codeDocument(), root);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('stale-code');
    expect(findings[0]!.message).toContain('clotho sync');
  });

  it('notices when the source changes after a sync', async () => {
    const synced = (await syncDocument(codeDocument(), root)).document;
    await writeFile(join(root, 'src', 'example.ts'), SOURCE.replace('2;', '42;'), 'utf-8');
    const findings = await checkSourceFreshness(synced, root);
    expect(findings.map((f) => f.code)).toEqual(['stale-code']);
  });

  it('reports an unreadable file as a distinct problem', async () => {
    const findings = await checkSourceFreshness(
      codeDocument({ source: { file: 'src/gone.ts', region: 'compute' } }),
      root,
    );
    expect(findings[0]!.code).toBe('unreadable-source');
  });

  it('is silent about code elements with no source at all', async () => {
    const plain = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'plain',
      duration: 1000,
      elements: [
        {
          type: 'code',
          id: 'literal',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          content: 'hand written',
          appearances: [{ start: 0, end: 1000 }],
        },
      ],
    });
    expect(await checkSourceFreshness(plain, root)).toEqual([]);
  });
});

/**
 * The property that keeps a document exportable: `source` is provenance, and the
 * renderer never consults it. A document whose rendering depended on a file could
 * not be baked into a GIF, exported to SVG, or embedded anywhere.
 */
describe('the runtime ignores source entirely', () => {
  it('draws the inline content even when the source says otherwise', () => {
    const stale = codeDocument();
    const scene = buildScene(stale, 0);
    expect(JSON.stringify(scene)).toContain('STALE');
    expect(JSON.stringify(scene)).not.toContain('example.ts');
  });

  it('renders identically with and without the source metadata', () => {
    const withSource = buildScene(codeDocument(), 0);
    const withoutSource = buildScene(codeDocument({ source: undefined }), 0);
    expect(withoutSource.nodes).toEqual(withSource.nodes);
  });
});
