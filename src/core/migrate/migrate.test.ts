import { describe, expect, it } from 'bun:test';
import { migrateLegacyDocument, needsMigration } from './legacy';
import { parseDocument } from '../schema';
import { toBase64 } from '../text/base64';

const legacyBase = {
  version: 4,
  id: 'demo',
  title: 'Demo',
  category: 'algorithm',
  duration: 1000,
  elements: [],
};

function migrated(input: Record<string, unknown>) {
  const result = migrateLegacyDocument(input);
  const parsed = parseDocument(result.document);
  if (!parsed.ok) throw new Error(`migrated document failed to parse: ${parsed.issues.join('; ')}`);
  return { doc: parsed.document, notes: result.notes };
}

describe('needsMigration', () => {
  it('recognizes legacy envelopes', () => {
    expect(needsMigration({ version: 3, id: 'a' })).toBe(true);
    expect(needsMigration({ version: 4, id: 'a' })).toBe(true);
  });

  it('leaves v1 and unrelated values alone', () => {
    expect(needsMigration({ clothoVersion: 1, id: 'a' })).toBe(false);
    expect(needsMigration({ version: 2, id: 'a' })).toBe(false);
    expect(needsMigration(null)).toBe(false);
    expect(needsMigration('x')).toBe(false);
  });
});

describe('envelope', () => {
  it('replaces version with clothoVersion', () => {
    const { doc } = migrated(legacyBase);
    expect(doc.clothoVersion).toBe(1);
    expect((doc as Record<string, unknown>).version).toBeUndefined();
  });

  it('migrates version 3 the same as version 4', () => {
    expect(migrated({ ...legacyBase, version: 3 }).doc.clothoVersion).toBe(1);
  });

  it('keeps every other envelope field verbatim', () => {
    const { doc } = migrated({
      ...legacyBase,
      title: '벨만-포드',
      description: 'desc',
      tags: ['graph'],
      canvas: { width: 640, height: 480, background: '#fff' },
      settings: { loop: false, autoplay: false, showCaption: true, showChapterList: true },
      updatedAt: '2026-01-01',
    });
    expect(doc.title).toBe('벨만-포드');
    expect(doc.tags).toEqual(['graph']);
    expect(doc.canvas).toEqual({ width: 640, height: 480, background: '#fff' });
    expect(doc.settings).toEqual({
      loop: false,
      autoplay: false,
      showCaption: true,
      showChapterList: true,
      chapterListPosition: 'right',
    });
    expect(doc.updatedAt).toBe('2026-01-01');
  });

  it('carries the legacy category through as a free string', () => {
    for (const category of ['network', 'cache', 'protocol', 'general']) {
      expect(migrated({ ...legacyBase, category }).doc.category).toBe(category);
    }
  });

  it('notes an unexpected version but still migrates', () => {
    const { notes } = migrated({ ...legacyBase, version: 9 });
    expect(notes.some((n) => n.code === 'unknown-version')).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(() => migrateLegacyDocument('nope')).toThrow(TypeError);
  });
});

describe('tracks and appearances', () => {
  it('leaves tracks untouched, adding no interpolate field', () => {
    const { doc } = migrated({
      ...legacyBase,
      elements: [
        {
          type: 'rect',
          id: 'r',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          appearances: [{ start: 0, end: 1000 }],
          tracks: [{ property: 'fill', keyframes: [{ time: 0, value: '#fff' }] }],
        },
      ],
    });
    const track = doc.elements[0]!.tracks[0]!;
    expect(track.interpolate).toBeUndefined();
    expect(track.property).toBe('fill');
  });
});

describe('group childIds → parentId', () => {
  const withGroup = (groupOverrides: Record<string, unknown> = {}) => ({
    ...legacyBase,
    elements: [
      { type: 'group', id: 'g', childIds: ['a', 'b'], ...groupOverrides },
      { type: 'rect', id: 'a', x: 10, y: 20, width: 5, height: 5 },
      { type: 'rect', id: 'b', x: 30, y: 40, width: 5, height: 5 },
    ],
  });

  it('assigns parentId to each listed child and drops childIds', () => {
    const { doc } = migrated(withGroup());
    expect(doc.elements[1]!.parentId).toBe('g');
    expect(doc.elements[2]!.parentId).toBe('g');
    expect(doc.elements[0]).not.toHaveProperty('childIds');
  });

  it('leaves child coordinates alone, since legacy drew them absolutely', () => {
    const { doc } = migrated(withGroup());
    expect(doc.elements[1]).toMatchObject({ x: 10, y: 20 });
    expect(doc.elements[2]).toMatchObject({ x: 30, y: 40 });
  });

  // The one place migration deliberately discards a declared value, because
  // honoring it would move artwork that legacy rendered elsewhere.
  it('resets a declared group transform and says so', () => {
    const { doc, notes } = migrated(withGroup({ x: 100, y: 50, rotation: 15 }));
    expect(doc.elements[0]).toMatchObject({ x: 0, y: 0, rotation: 0 });
    const note = notes.find((n) => n.code === 'group-transform-dropped');
    expect(note?.elementId).toBe('g');
    expect(note?.message).toContain('legacy renderer ignored');
  });

  it('stays quiet when the group transform was already identity', () => {
    const { notes } = migrated(withGroup({ x: 0, y: 0 }));
    expect(notes.some((n) => n.code === 'group-transform-dropped')).toBe(false);
  });

  it('notes a child that does not exist', () => {
    const { notes } = migrated({
      ...legacyBase,
      elements: [{ type: 'group', id: 'g', childIds: ['ghost'] }],
    });
    expect(notes.some((n) => n.code === 'group-child-missing')).toBe(true);
  });

  it('gives a doubly-claimed child to the first group', () => {
    const { doc } = migrated({
      ...legacyBase,
      elements: [
        { type: 'group', id: 'g1', childIds: ['a'] },
        { type: 'group', id: 'g2', childIds: ['a'] },
        { type: 'rect', id: 'a', x: 0, y: 0, width: 1, height: 1 },
      ],
    });
    expect(doc.elements[2]!.parentId).toBe('g1');
  });

  it('produces a tree that resolves without issues', () => {
    const { doc } = migrated(withGroup());
    expect(doc.elements.filter((el) => el.parentId === 'g')).toHaveLength(2);
  });
});

describe('image src → assets', () => {
  const imageDoc = (src: unknown) => ({
    ...legacyBase,
    elements: [{ type: 'image', id: 'im', x: 0, y: 0, width: 10, height: 10, src }],
  });

  it('moves a URL into an external asset', () => {
    const { doc, notes } = migrated(imageDoc('/images/logo.png'));
    const el = doc.elements[0]!;
    expect(el).toMatchObject({ type: 'image', assetId: 'img-im' });
    expect(el).not.toHaveProperty('src');
    expect(doc.assets['img-im']).toEqual({ kind: 'external', url: '/images/logo.png' });
    expect(notes.some((n) => n.code === 'image-src-external')).toBe(true);
  });

  it('moves a data URI into an inline asset, keeping the bytes', () => {
    const data = toBase64('binary-ish');
    const { doc, notes } = migrated(imageDoc(`data:image/png;base64,${data}`));
    expect(doc.assets['img-im']).toEqual({ kind: 'inline', mime: 'image/png', data });
    expect(notes.some((n) => n.code === 'image-src-inlined')).toBe(true);
  });

  it('treats a non-image data URI as an external reference', () => {
    const { doc } = migrated(imageDoc('data:text/plain;base64,aGk='));
    expect(doc.assets['img-im']!.kind).toBe('external');
  });

  it('keeps the element when src is missing, so validation can name the problem', () => {
    const { doc, notes } = migrated(imageDoc(undefined));
    expect(doc.elements[0]).toMatchObject({ assetId: 'img-im' });
    expect(doc.assets['img-im']).toBeUndefined();
    expect(notes.some((n) => n.code === 'image-src-missing')).toBe(true);
  });

  it('does not collide asset ids across images', () => {
    const { doc } = migrated({
      ...legacyBase,
      assets: { 'img-im': { kind: 'external', url: '/taken.png' } },
      elements: [{ type: 'image', id: 'im', x: 0, y: 0, width: 1, height: 1, src: '/new.png' }],
    });
    expect(doc.assets['img-im']).toEqual({ kind: 'external', url: '/taken.png' });
    expect(doc.assets['img-im-2']).toEqual({ kind: 'external', url: '/new.png' });
    expect(doc.elements[0]).toMatchObject({ assetId: 'img-im-2' });
  });

  it('is idempotent for an already-migrated image', () => {
    const once = migrateLegacyDocument(imageDoc('/a.png')).document;
    const twice = migrateLegacyDocument({ ...once, version: 4 }).document;
    expect(twice.elements).toEqual(once.elements);
    expect(twice.assets).toEqual(once.assets);
  });

  it('omits the assets key entirely when there are no images', () => {
    expect(migrateLegacyDocument(legacyBase).document.assets).toBeUndefined();
  });
});

describe('non-mutation', () => {
  it('does not modify the input document', () => {
    const input = {
      ...legacyBase,
      elements: [
        { type: 'group', id: 'g', childIds: ['a'], x: 5 },
        { type: 'image', id: 'a', x: 0, y: 0, width: 1, height: 1, src: '/a.png' },
      ],
    };
    const snapshot = JSON.stringify(input);
    migrateLegacyDocument(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
