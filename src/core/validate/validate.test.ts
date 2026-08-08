// Validator tests. Semantic rules ported from shinkeonkim's
// scripts/validate-animations.mjs; parent-link and asset rules are new to v1.

import { describe, expect, it } from 'bun:test';
import { formatFindings, validateDocument } from './validate';

const base = {
  clothoVersion: 1,
  id: 'demo',
  duration: 1000,
  elements: [] as Record<string, unknown>[],
  chapters: [] as Record<string, unknown>[],
  effects: [] as Record<string, unknown>[],
};

function doc(over: Record<string, unknown> = {}) {
  return validateDocument({ ...base, ...over });
}

function codes(result: ReturnType<typeof validateDocument>): string[] {
  return result.findings.map((f) => f.code);
}

const rect = (over: Record<string, unknown> = {}) => ({
  type: 'rect',
  id: 'r',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...over,
});

describe('validateDocument', () => {
  it('accepts a minimal document', () => {
    const result = doc();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.document?.id).toBe('demo');
  });

  it('reports schema issues with their path', () => {
    const result = validateDocument({ clothoVersion: 1, id: 'Bad Id' });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('schema');
    expect(result.findings[0]?.path).toBe('id');
  });

  // Being handed an unmigrated document is a distinct mistake from a malformed
  // one, and a wall of schema errors would bury the actual cause.
  it('names a legacy document as such instead of dumping schema errors', () => {
    const result = validateDocument({ version: 4, id: 'demo', elements: [] });
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.code).toBe('legacy-document');
    expect(result.findings[0]?.message).toContain('migrateLegacyDocument');
  });
});

describe('duplicate ids', () => {
  it('catches duplicate element ids', () => {
    const result = doc({ elements: [rect({ id: 'a' }), rect({ id: 'a' })] });
    expect(codes(result)).toContain('duplicate-id');
    expect(result.findings[0]?.path).toBe('elements.1.id');
  });

  it('catches duplicate chapter and effect ids', () => {
    const chapters = doc({
      chapters: [
        { id: 'c', time: 0 },
        { id: 'c', time: 1 },
      ],
    });
    expect(codes(chapters)).toContain('duplicate-id');

    const effects = doc({
      elements: [rect({ id: 'r' })],
      effects: [
        { type: 'pulse', id: 'e', elementId: 'r', time: 0 },
        { type: 'pulse', id: 'e', elementId: 'r', time: 1 },
      ],
    });
    expect(codes(effects)).toContain('duplicate-id');
  });

  // Namespaces are separate: legacy allowed an effect and an element to share an
  // id, and documents in the wild rely on it.
  it('allows the same id in different namespaces', () => {
    const result = doc({
      elements: [rect({ id: 'shared' })],
      effects: [{ type: 'pulse', id: 'shared', elementId: 'shared', time: 0 }],
    });
    expect(codes(result)).not.toContain('duplicate-id');
  });
});

describe('referential integrity', () => {
  it('catches a connector pointing at a missing element', () => {
    const result = doc({
      elements: [{ type: 'arrow', id: 'a', fromId: 'ghost', toId: 'ghost2' }],
    });
    const paths = result.findings.filter((f) => f.code === 'unknown-reference').map((f) => f.path);
    expect(paths).toEqual(['elements.0.fromId', 'elements.0.toId']);
  });

  it('accepts a connector with explicit coordinates', () => {
    const result = doc({
      elements: [{ type: 'line', id: 'l', x1: 0, y1: 0, x2: 1, y2: 1 }],
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('warns about a connector that can never resolve an endpoint', () => {
    const result = doc({ elements: [{ type: 'line', id: 'l', x1: 0, y1: 0 }] });
    expect(codes(result)).toContain('unresolvable-connector');
    expect(result.ok).toBe(true); // a warning, not an error
  });

  it('catches an effect targeting a missing element', () => {
    const result = doc({
      effects: [{ type: 'pulse', id: 'e', elementId: 'ghost', time: 0 }],
    });
    expect(codes(result)).toContain('unknown-reference');
    expect(result.ok).toBe(false);
  });

  it('warns when a flow effect targets something with no path to travel', () => {
    const result = doc({
      elements: [rect({ id: 'r' })],
      effects: [{ type: 'flow', id: 'e', elementId: 'r', time: 0 }],
    });
    expect(codes(result)).toContain('flow-target');
  });

  it('accepts a flow effect on a connector', () => {
    const result = doc({
      elements: [{ type: 'arrow', id: 'a', x1: 0, y1: 0, x2: 1, y2: 1 }],
      effects: [{ type: 'flow', id: 'e', elementId: 'a', time: 0 }],
    });
    expect(codes(result)).not.toContain('flow-target');
  });
});

describe('parent links (v1)', () => {
  it('catches a missing parent', () => {
    const result = doc({ elements: [rect({ id: 'r', parentId: 'ghost' })] });
    expect(codes(result)).toContain('missing-parent');
    expect(result.findings[0]?.path).toBe('elements.0.parentId');
  });

  it('catches a non-group parent', () => {
    const result = doc({ elements: [rect({ id: 'box' }), rect({ id: 'kid', parentId: 'box' })] });
    expect(codes(result)).toContain('non-group-parent');
  });

  it('catches a parent cycle', () => {
    const result = doc({
      elements: [
        { type: 'group', id: 'a', parentId: 'b' },
        { type: 'group', id: 'b', parentId: 'a' },
      ],
    });
    expect(codes(result)).toContain('parent-cycle');
  });

  it('accepts a well-formed group', () => {
    const result = doc({
      elements: [{ type: 'group', id: 'g' }, rect({ id: 'kid', parentId: 'g' })],
    });
    expect(result.ok).toBe(true);
  });
});

describe('temporal bounds', () => {
  it('catches an appearance whose start is not before its end', () => {
    const result = doc({ elements: [rect({ appearances: [{ start: 500, end: 500 }] })] });
    expect(codes(result)).toContain('inverted-window');
  });

  it('catches times beyond the duration', () => {
    const result = doc({ elements: [rect({ appearances: [{ start: 0, end: 5000 }] })] });
    const finding = result.findings.find((f) => f.code === 'out-of-range');
    expect(finding?.path).toBe('elements.0.appearances.0.end');
    expect(finding?.message).toContain('0..1000');
  });

  it('catches keyframe times beyond the duration', () => {
    const result = doc({
      elements: [rect({ tracks: [{ property: 'x', keyframes: [{ time: 9999, value: 1 }] }] })],
    });
    expect(codes(result)).toContain('out-of-range');
    expect(result.findings[0]?.path).toBe('elements.0.tracks.0.keyframes.0.time');
  });

  it('catches chapter and effect times beyond the duration', () => {
    expect(codes(doc({ chapters: [{ id: 'c', time: 2000 }] }))).toContain('out-of-range');
    expect(
      codes(
        doc({
          elements: [rect({ id: 'r' })],
          effects: [{ type: 'pulse', id: 'e', elementId: 'r', time: 2000 }],
        }),
      ),
    ).toContain('out-of-range');
  });

  it('warns about keyframes that are not in ascending order', () => {
    const result = doc({
      elements: [
        rect({
          tracks: [
            {
              property: 'x',
              keyframes: [
                { time: 500, value: 1 },
                { time: 100, value: 2 },
              ],
            },
          ],
        }),
      ],
    });
    expect(codes(result)).toContain('unsorted-keyframes');
    expect(result.ok).toBe(true);
  });

  it('warns about a zero-duration effect, which can never fire', () => {
    const result = doc({
      elements: [rect({ id: 'r' })],
      effects: [{ type: 'pulse', id: 'e', elementId: 'r', time: 0, duration: 0 }],
    });
    expect(codes(result)).toContain('zero-duration-effect');
  });

  it('accepts times exactly at the bounds', () => {
    const result = doc({
      elements: [rect({ appearances: [{ start: 0, end: 1000 }] })],
      chapters: [{ id: 'c', time: 1000 }],
    });
    expect(result.ok).toBe(true);
  });
});

describe('assets (v1)', () => {
  const image = (over: Record<string, unknown> = {}) => ({
    type: 'image',
    id: 'im',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    assetId: 'logo',
    ...over,
  });

  it('catches an image referencing an unregistered asset', () => {
    const result = doc({ elements: [image()] });
    expect(codes(result)).toContain('unknown-asset');
    expect(result.ok).toBe(false);
  });

  it('accepts a registered asset', () => {
    const result = doc({
      assets: { logo: { kind: 'external', url: '/a.png' } },
      elements: [image()],
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('warns about an asset nothing references', () => {
    const result = doc({ assets: { orphan: { kind: 'external', url: '/a.png' } } });
    expect(codes(result)).toContain('unused-asset');
    expect(result.ok).toBe(true);
  });
});

// zod strips unknown keys, so without this an author can write a property that does
// nothing and never find out. The corpus this package came from had 367 of them.
describe('unknown properties', () => {
  it('warns about a property the element type does not have', () => {
    const result = doc({
      elements: [{ type: 'line', id: 'l', x1: 0, y1: 0, x2: 1, y2: 1, label: 'x' }],
    });
    const finding = result.findings.find((f) => f.code === 'unknown-property');
    expect(finding?.path).toBe('elements.0.label');
    expect(finding?.message).toContain('"line" has no property "label"');
    expect(result.ok).toBe(true); // inert, so a warning
  });

  it('catches the real cases from the corpus', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ type: 'circle', id: 'c', cx: 0, cy: 0, r: 1, subtitle: 'x' }, 'elements.0.subtitle'],
      [
        { type: 'rect', id: 'r', x: 0, y: 0, width: 1, height: 1, strokeDasharray: '4 4' },
        'elements.0.strokeDasharray',
      ],
      [
        { type: 'arrow', id: 'a', x1: 0, y1: 0, x2: 1, y2: 1, arrowEnd: 'arrow' },
        'elements.0.arrowEnd',
      ],
      [
        { type: 'text', id: 't', x: 0, y: 0, content: 'x', fontFamily: 'serif' },
        'elements.0.fontFamily',
      ],
    ];
    for (const [element, path] of cases) {
      const result = doc({ elements: [element] });
      const paths = result.findings.filter((f) => f.code === 'unknown-property').map((f) => f.path);
      expect(paths, JSON.stringify(element)).toContain(path);
    }
  });

  it('warns about an unknown effect property', () => {
    const result = doc({
      elements: [rect({ id: 'r' })],
      effects: [{ type: 'pulse', id: 'e', elementId: 'r', time: 0, delay: 100 }],
    });
    expect(result.findings.find((f) => f.code === 'unknown-property')?.path).toBe(
      'effects.0.delay',
    );
  });

  it('warns about unknown document and chapter properties', () => {
    expect(doc({ author: 'me' }).findings.find((f) => f.code === 'unknown-property')?.path).toBe(
      'author',
    );
    expect(
      doc({ chapters: [{ id: 'c', time: 0, note: 'x' }] }).findings.find(
        (f) => f.code === 'unknown-property',
      )?.path,
    ).toBe('chapters.0.note');
  });

  // These are what migration replaces, so warning about them would be noise.
  it('stays quiet about legacy fields migration handles', () => {
    const result = validateDocument({
      clothoVersion: 1,
      id: 'demo',
      duration: 100,
      elements: [{ type: 'group', id: 'g', childIds: ['a'] }],
    });
    expect(result.findings.filter((f) => f.code === 'unknown-property')).toEqual([]);
  });

  it('says nothing for a document using only defined properties', () => {
    const result = doc({
      elements: [rect({ id: 'r', label: 'A', subtitle: 'B', cornerRadius: 4 })],
    });
    expect(result.findings.filter((f) => f.code === 'unknown-property')).toEqual([]);
  });
});

describe('result shape', () => {
  it('counts errors and warnings separately', () => {
    const result = doc({
      elements: [rect({ id: 'a', parentId: 'ghost' })],
      assets: { orphan: { kind: 'external', url: '/a.png' } },
    });
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.ok).toBe(false);
  });

  it('formats findings for printing', () => {
    const result = doc({ elements: [rect({ parentId: 'ghost' })] });
    const lines = formatFindings(result.findings);
    expect(lines[0]).toStartWith('ERROR elements.0.parentId:');
  });
});
