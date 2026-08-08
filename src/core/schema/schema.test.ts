// Schema tests. Ported from the legacy engine's schema/*.test.ts (the only
// reference implementation that had them) and extended for the v1 changes:
// clothoVersion, parentId, interpolate, assets, free-form category, image.alt.

import { describe, expect, it } from 'bun:test';
import {
  ID_RE,
  appearanceSchema,
  propertyTrackSchema,
  idSchema,
  interpolationSchema,
} from './primitives';
import { assetSchema, assetMapSchema, base64Schema } from './assets';
import { elementSchema, imageElementSchema, groupElementSchema, isConnector } from './elements';
import { effectSchema } from './effects';
import {
  FORMAT_VERSION,
  animationDocumentSchema,
  isClothoDocument,
  isLegacyDocument,
} from './document';
import { parseDocument, parseDocumentOrThrow } from './index';

const minimalDoc = { clothoVersion: 1, id: 'demo' };

describe('idSchema', () => {
  it('accepts lowercase, digits, dash, underscore', () => {
    for (const id of ['a', 'n-a', 'node_1', '0-1-bfs', 'z9']) {
      expect(idSchema.safeParse(id).success, id).toBe(true);
    }
  });

  it('rejects uppercase, leading punctuation, spaces, empty', () => {
    for (const id of ['Articulation', '-lead', '_lead', 'has space', '', 'péché']) {
      expect(idSchema.safeParse(id).success, id).toBe(false);
    }
  });

  it('keeps the legacy pattern so existing documents stay valid', () => {
    expect(ID_RE.source).toBe('^[a-z0-9][a-z0-9_-]*$');
  });
});

describe('appearanceSchema', () => {
  it('defaults entry/exit durations to 300ms', () => {
    const ap = appearanceSchema.parse({ start: 0, end: 1000 });
    expect(ap.entryDuration).toBe(300);
    expect(ap.exitDuration).toBe(300);
    expect(ap.entryMode).toBeUndefined();
  });

  it('rejects negative and non-integer times', () => {
    expect(appearanceSchema.safeParse({ start: -1, end: 10 }).success).toBe(false);
    expect(appearanceSchema.safeParse({ start: 0.5, end: 10 }).success).toBe(false);
  });

  // start > end is a semantic error, caught by core/validate rather than the
  // schema, which cannot express cross-field constraints without refinements
  // that would obscure the issue path.
  it('does not itself reject start > end', () => {
    expect(appearanceSchema.safeParse({ start: 500, end: 100 }).success).toBe(true);
  });
});

describe('propertyTrackSchema', () => {
  it('requires at least one keyframe', () => {
    expect(propertyTrackSchema.safeParse({ property: 'x', keyframes: [] }).success).toBe(false);
  });

  it('accepts string, number, and boolean keyframe values', () => {
    const t = propertyTrackSchema.parse({
      property: 'label',
      keyframes: [
        { time: 0, value: 'a' },
        { time: 1, value: 2 },
        { time: 2, value: true },
      ],
    });
    expect(t.keyframes).toHaveLength(3);
  });

  it('leaves interpolate absent when unspecified so migration adds nothing', () => {
    const t = propertyTrackSchema.parse({ property: 'x', keyframes: [{ time: 0, value: 1 }] });
    expect(t.interpolate).toBeUndefined();
  });

  it('accepts explicit interpolation modes', () => {
    for (const mode of ['auto', 'number', 'color', 'discrete']) {
      expect(interpolationSchema.safeParse(mode).success, mode).toBe(true);
    }
    expect(interpolationSchema.safeParse('bezier').success).toBe(false);
  });
});

describe('elements', () => {
  it('discriminates all ten types', () => {
    const types = [
      { type: 'rect', id: 'a', x: 0, y: 0, width: 1, height: 1 },
      { type: 'circle', id: 'b', cx: 0, cy: 0, r: 1 },
      { type: 'line', id: 'c' },
      { type: 'arrow', id: 'd' },
      { type: 'text', id: 'e', x: 0, y: 0, content: 'hi' },
      { type: 'image', id: 'f', x: 0, y: 0, width: 1, height: 1, assetId: 'logo' },
      { type: 'path', id: 'g', d: 'M0 0' },
      { type: 'polygon', id: 'h', points: '0,0 1,1' },
      { type: 'group', id: 'i' },
      { type: 'code', id: 'j', x: 0, y: 0, width: 1, height: 1, content: 'x' },
    ];
    for (const raw of types) {
      const parsed = elementSchema.safeParse(raw);
      expect(parsed.success, `${raw.type}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
    expect(types).toHaveLength(10);
  });

  it('preserves legacy default colors and sizes', () => {
    const rect = elementSchema.parse({ type: 'rect', id: 'a', x: 0, y: 0, width: 1, height: 1 });
    expect(rect).toMatchObject({
      fill: '#a5b4fc',
      stroke: '#6366f1',
      strokeWidth: 1.5,
      cornerRadius: 8,
      labelColor: '#0b0b0f',
      labelSize: 14,
      rotation: 0,
    });
  });

  it('rejects non-positive geometry', () => {
    expect(
      elementSchema.safeParse({ type: 'rect', id: 'a', x: 0, y: 0, width: 0, height: 1 }).success,
    ).toBe(false);
    expect(elementSchema.safeParse({ type: 'circle', id: 'a', cx: 0, cy: 0, r: -1 }).success).toBe(
      false,
    );
  });

  it('accepts parentId on any element and defaults it to absent (root)', () => {
    const child = elementSchema.parse({
      type: 'circle',
      id: 'dot',
      parentId: 'cluster',
      cx: 0,
      cy: 0,
      r: 1,
    });
    expect(child.parentId).toBe('cluster');
    const root = elementSchema.parse({ type: 'circle', id: 'dot', cx: 0, cy: 0, r: 1 });
    expect(root.parentId).toBeUndefined();
  });

  it('drops childIds from group — v1 nests via parentId instead', () => {
    const group = groupElementSchema.parse({ type: 'group', id: 'g', childIds: ['a', 'b'] });
    expect(group).not.toHaveProperty('childIds');
    expect(group.x).toBe(0);
    expect(group.y).toBe(0);
  });

  it('requires assetId on image and rejects a legacy src', () => {
    const legacyShape = { type: 'image', id: 'f', x: 0, y: 0, width: 1, height: 1, src: '/a.png' };
    expect(imageElementSchema.safeParse(legacyShape).success).toBe(false);
    const v1 = imageElementSchema.parse({
      type: 'image',
      id: 'f',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      assetId: 'logo',
      alt: '로고',
    });
    expect(v1.assetId).toBe('logo');
    expect(v1.alt).toBe('로고');
    expect(v1.preserveAspectRatio).toBe('xMidYMid meet');
  });

  it('identifies connectors', () => {
    expect(isConnector(elementSchema.parse({ type: 'arrow', id: 'a' }))).toBe(true);
    expect(isConnector(elementSchema.parse({ type: 'line', id: 'a' }))).toBe(true);
    expect(
      isConnector(elementSchema.parse({ type: 'rect', id: 'a', x: 0, y: 0, width: 1, height: 1 })),
    ).toBe(false);
  });
});

describe('effects', () => {
  it('applies documented defaults per type', () => {
    const base = { id: 'e1', elementId: 'n-a', time: 0 };
    expect(effectSchema.parse({ ...base, type: 'highlight' })).toMatchObject({
      color: '#facc15',
      duration: 500,
    });
    expect(effectSchema.parse({ ...base, type: 'pulse' })).toMatchObject({
      scale: 1.12,
      duration: 500,
    });
    expect(effectSchema.parse({ ...base, type: 'flow' })).toMatchObject({
      color: '#facc15',
      particles: 3,
      radius: 4,
      duration: 800,
    });
  });

  it('bounds flow particles to 1..10', () => {
    const base = { id: 'e1', elementId: 'n-a', time: 0, type: 'flow' as const };
    expect(effectSchema.safeParse({ ...base, particles: 0 }).success).toBe(false);
    expect(effectSchema.safeParse({ ...base, particles: 11 }).success).toBe(false);
    expect(effectSchema.safeParse({ ...base, particles: 10 }).success).toBe(true);
  });

  it('rejects unknown effect types', () => {
    expect(
      effectSchema.safeParse({ type: 'shake', id: 'e', elementId: 'n', time: 0 }).success,
    ).toBe(false);
  });
});

describe('assets', () => {
  it('accepts the three asset kinds', () => {
    expect(
      assetSchema.safeParse({ kind: 'inline', mime: 'image/png', data: 'iVBORw0KGgo=' }).success,
    ).toBe(true);
    expect(assetSchema.safeParse({ kind: 'external', url: 'https://x/y.png' }).success).toBe(true);
    expect(assetSchema.safeParse({ kind: 'ref', key: 'post-42/chart' }).success).toBe(true);
  });

  it('rejects a data: URI prefix in inline data with a guiding message', () => {
    const result = base64Schema.safeParse('data:image/png;base64,iVBORw0KGgo=');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('data:');
  });

  it('tolerates whitespace in base64 but rejects invalid characters', () => {
    expect(base64Schema.safeParse('iVBORw0K\n  Ggo=').success).toBe(true);
    expect(base64Schema.safeParse('not*valid$').success).toBe(false);
  });

  it('restricts inline mime to image/*', () => {
    expect(assetSchema.safeParse({ kind: 'inline', mime: 'text/html', data: 'aGk=' }).success).toBe(
      false,
    );
    expect(
      assetSchema.safeParse({ kind: 'inline', mime: 'image/svg+xml', data: 'aGk=' }).success,
    ).toBe(true);
  });

  it('maps ids to assets', () => {
    const map = assetMapSchema.parse({
      logo: { kind: 'external', url: '/a.png' },
      hero: { kind: 'ref', key: 'k' },
    });
    expect(Object.keys(map)).toEqual(['logo', 'hero']);
  });
});

describe('document envelope', () => {
  it('requires clothoVersion === 1', () => {
    expect(animationDocumentSchema.safeParse({ id: 'a' }).success).toBe(false);
    expect(animationDocumentSchema.safeParse({ clothoVersion: 2, id: 'a' }).success).toBe(false);
    expect(animationDocumentSchema.safeParse(minimalDoc).success).toBe(true);
    expect(FORMAT_VERSION).toBe(1);
  });

  it('rejects legacy version 3 and 4 envelopes outright', () => {
    expect(animationDocumentSchema.safeParse({ version: 4, id: 'a' }).success).toBe(false);
    expect(animationDocumentSchema.safeParse({ version: 3, id: 'a' }).success).toBe(false);
  });

  it('fills defaults for everything but clothoVersion and id', () => {
    const doc = animationDocumentSchema.parse(minimalDoc);
    expect(doc).toMatchObject({
      title: '',
      description: '',
      category: 'general',
      tags: [],
      duration: 5000,
      canvas: { width: 800, height: 500, background: 'transparent' },
      assets: {},
      elements: [],
      chapters: [],
      effects: [],
      settings: { loop: true, autoplay: true, showCaption: false, showChapterList: false },
    });
  });

  it('accepts any category string, unlike the legacy seven-value enum', () => {
    for (const category of ['algorithm', 'network', 'my-own-taxonomy', '자료구조']) {
      const doc = animationDocumentSchema.parse({ ...minimalDoc, category });
      expect(doc.category).toBe(category);
    }
  });

  it('keeps $schema when present and ignores it otherwise', () => {
    const doc = animationDocumentSchema.parse({
      ...minimalDoc,
      $schema: 'https://x/clotho-1.json',
    });
    expect(doc.$schema).toBe('https://x/clotho-1.json');
    expect(animationDocumentSchema.parse(minimalDoc).$schema).toBeUndefined();
  });

  it('preserves non-ASCII text verbatim', () => {
    const doc = animationDocumentSchema.parse({
      ...minimalDoc,
      title: '벨만-포드 (Bellman-Ford) ✅',
      tags: ['그래프', '最短経路'],
    });
    expect(doc.title).toBe('벨만-포드 (Bellman-Ford) ✅');
    expect(doc.tags).toEqual(['그래프', '最短経路']);
  });
});

describe('version probes', () => {
  it('separates clotho documents from legacy ones', () => {
    expect(isClothoDocument({ clothoVersion: 1, id: 'a' })).toBe(true);
    expect(isClothoDocument({ version: 4, id: 'a' })).toBe(false);
    expect(isLegacyDocument({ version: 4, id: 'a' })).toBe(true);
    expect(isLegacyDocument({ version: 3, id: 'a' })).toBe(true);
    expect(isLegacyDocument({ clothoVersion: 1, id: 'a' })).toBe(false);
  });

  it('treats unrelated values as neither', () => {
    for (const value of [null, undefined, 42, 'x', [], {}, { version: 2 }]) {
      expect(isClothoDocument(value)).toBe(false);
      expect(isLegacyDocument(value)).toBe(false);
    }
  });
});

describe('parseDocument', () => {
  it('returns the parsed document on success', () => {
    const result = parseDocument(minimalDoc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.id).toBe('demo');
  });

  it('reports every issue with a dotted path instead of throwing', () => {
    const result = parseDocument({
      clothoVersion: 1,
      id: 'Bad Id',
      elements: [{ type: 'rect', id: 'a', x: 0, y: 0, width: -1, height: 1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
      expect(result.issues.some((i) => i.startsWith('id:'))).toBe(true);
      expect(result.issues.some((i) => i.includes('elements.0.width'))).toBe(true);
    }
  });

  it('throws with all issues in the message via parseDocumentOrThrow', () => {
    expect(() => parseDocumentOrThrow({ clothoVersion: 1, id: 'Bad' })).toThrow(
      /invalid clotho document/,
    );
    expect(parseDocumentOrThrow(minimalDoc).id).toBe('demo');
  });
});
