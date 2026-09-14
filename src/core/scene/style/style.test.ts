// Render style tests.
//
// The property that matters is determinism. A style that looks hand-drawn is only
// usable if it draws the same way every time — otherwise a GIF differs between
// bakes, a seek differs from playback, and every visual regression test fails for
// no reason.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../../schema/document';
import type { AnimationDocument } from '../../schema/document';
import { buildScene } from '../build';
import type { SceneNode } from '../nodes';
import { serializeScene } from '../../../svg/serialize';
import { applyRenderStyle, hashString, mulberry32, SKETCH_NODE_LIMIT } from './index';

const ALWAYS = [{ start: 0, end: 10_000, entryDuration: 0, exitDuration: 0 }];

function animation(over: Record<string, unknown> = {}): AnimationDocument {
  const { elements, ...rest } = over as { elements?: Record<string, unknown>[] };
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'styled',
    duration: 10_000,
    canvas: { width: 400, height: 300 },
    elements: (
      elements ?? [
        { type: 'rect', id: 'box', x: 20, y: 20, width: 100, height: 60, fill: '#a5b4fc' },
        { type: 'circle', id: 'dot', cx: 250, cy: 100, r: 30, fill: '#f97316' },
        { type: 'line', id: 'edge', x1: 20, y1: 200, x2: 380, y2: 200 },
        { type: 'polygon', id: 'tri', points: '40,260 90,220 140,260' },
        { type: 'text', id: 'label', x: 200, y: 280, content: 'hello' },
      ]
    ).map((el) => ({ appearances: ALWAYS, ...el })),
    ...rest,
  });
}

/** The drawn node for an element, unwrapping the `<g>` the builder puts around it. */
function shapeOf(scene: { nodes: readonly SceneNode[] }, key: string): SceneNode {
  const found = (nodes: readonly SceneNode[]): SceneNode | null => {
    for (const node of nodes) {
      if (node.key === key) return node;
      if (node.kind === 'g') {
        const inner = found(node.children);
        if (inner) return inner;
      }
    }
    return null;
  };
  const node = found(scene.nodes)!;
  return node.kind === 'g' && node.children.length === 1 ? node.children[0]! : node;
}

describe('random', () => {
  it('hashes deterministically', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('produces a repeatable stream in [0, 1)', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 20; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('diverges for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('clean', () => {
  it('is byte-identical to no style at all', () => {
    const plain = serializeScene(buildScene(animation(), 0));
    const clean = serializeScene(buildScene(animation({ style: { preset: 'clean' } }), 0));
    expect(clean).toBe(plain);
  });

  it('is what an absent style resolves to', () => {
    expect(applyRenderStyle([], undefined, 'x')).toEqual([]);
  });
});

describe('sketch', () => {
  const sketched = (over: Record<string, unknown> = {}) =>
    buildScene(animation({ style: { preset: 'sketch', ...over } }), 0);

  it('turns closed shapes into wobbling paths', () => {
    const scene = sketched();
    for (const key of ['box', 'dot', 'tri']) {
      const shape = shapeOf(scene, key);
      expect(shape.kind).toBe('path');
      expect(typeof shape.attrs.d).toBe('string');
    }
  });

  it('keeps every key, so the DOM patcher still matches between frames', () => {
    const keysOf = (nodes: readonly SceneNode[]): string[] =>
      nodes.flatMap((node) => [node.key, ...(node.kind === 'g' ? keysOf(node.children) : [])]);
    expect(keysOf(sketched().nodes)).toEqual(keysOf(buildScene(animation(), 0).nodes));
  });

  it('keeps the paint attributes it inherited', () => {
    expect(shapeOf(sketched(), 'box').attrs.fill).toBe('#a5b4fc');
  });

  it('moves a line only at its endpoints', () => {
    const shape = shapeOf(sketched(), 'edge');
    expect(shape.kind).toBe('line');
    expect(shape.attrs.x1).not.toBe(20);
    expect(Math.abs((shape.attrs.x1 as number) - 20)).toBeLessThan(4);
  });

  it('leaves text alone, since a jittered glyph is unreadable rather than informal', () => {
    const shape = shapeOf(sketched(), 'label');
    expect(shape.kind).toBe('text');
    expect(shape.attrs.x).toBe(200);
  });

  it('stays near the true shape', () => {
    const d = shapeOf(sketched({ roughness: 1 }), 'box').attrs.d as string;
    const numbers = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    // The box spans x 20..120 and y 20..80; nothing should be far outside that.
    expect(Math.min(...numbers)).toBeGreaterThan(16);
    expect(Math.max(...numbers)).toBeLessThan(124);
  });

  it('respects roughness', () => {
    const gentle = shapeOf(sketched({ roughness: 0.2 }), 'box').attrs.d as string;
    const wild = shapeOf(sketched({ roughness: 6 }), 'box').attrs.d as string;
    expect(gentle).not.toBe(wild);
  });

  it('does nothing at zero roughness', () => {
    expect(shapeOf(sketched({ roughness: 0 }), 'box').kind).toBe('rect');
  });

  /** The whole reason the seed excludes time. */
  it('draws the same wobble at every time, so the drawing does not boil', () => {
    const moving = animation({
      style: { preset: 'sketch' },
      elements: [
        {
          type: 'rect',
          id: 'box',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          tracks: [
            {
              property: 'x',
              keyframes: [
                { time: 0, value: 0 },
                { time: 1000, value: 100, ease: 'linear' },
              ],
            },
          ],
        },
      ],
    });
    const offsets = [0, 250, 500, 750, 1000].map((time) => {
      const d = shapeOf(buildScene(moving, time), 'box').attrs.d as string;
      const xs = (d.match(/M (-?\d+\.?\d*)/) ?? [])[1];
      return Number(xs) - (100 * time) / 1000;
    });
    // Every frame's first corner sits at the same offset from the element's own x.
    for (const offset of offsets) expect(offset).toBeCloseTo(offsets[0]!, 6);
  });

  it('is byte-identical across repeated renders', () => {
    const doc = animation({ style: { preset: 'sketch' } });
    expect(serializeScene(buildScene(doc, 400))).toBe(serializeScene(buildScene(doc, 400)));
  });

  it('changes with the seed and follows the document id by default', () => {
    const seeded = serializeScene(
      buildScene(animation({ style: { preset: 'sketch', seed: 'a' } }), 0),
    );
    const other = serializeScene(
      buildScene(animation({ style: { preset: 'sketch', seed: 'b' } }), 0),
    );
    const byDocId = serializeScene(buildScene(animation({ style: { preset: 'sketch' } }), 0));
    expect(seeded).not.toBe(other);
    expect(byDocId).not.toBe(seeded);
  });

  it('gives different elements different wobbles', () => {
    const scene = sketched();
    const box = shapeOf(scene, 'box').attrs.d as string;
    const tri = shapeOf(scene, 'tri').attrs.d as string;
    expect(box).not.toBe(tri);
  });

  it('degrades to clean on a scene too dense for it to help', () => {
    const many = Array.from({ length: SKETCH_NODE_LIMIT + 10 }, (_, i) => ({
      type: 'rect',
      id: `r${i}`,
      x: i % 20,
      y: Math.floor(i / 20),
      width: 4,
      height: 4,
    }));
    const scene = buildScene(animation({ style: { preset: 'sketch' }, elements: many }), 0);
    expect(shapeOf(scene, 'r0').kind).toBe('rect');
  });

  it('leaves the spotlight scrim square', () => {
    const scene = buildScene(
      animation({
        style: { preset: 'sketch' },
        effects: [
          {
            type: 'spotlight',
            id: 'sp',
            elementIds: ['box'],
            time: 0,
            duration: 1000,
            fadeIn: 0,
          },
        ],
      }),
      100,
    );
    const scrim = scene.nodes.find((node) => typeof node.attrs.mask === 'string')!;
    expect(scrim.kind).toBe('rect');
    expect(scrim.attrs.width).toBe(400);
  });
});

describe('mono', () => {
  const mono = (over: Record<string, unknown> = {}) =>
    buildScene(animation({ style: { preset: 'mono' }, ...over }), 0);

  it('greyscales a literal colour', () => {
    const fill = shapeOf(mono(), 'box').attrs.fill as string;
    expect(fill).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });

  it('keeps lightness order, so distinctions survive as tones', () => {
    const scene = mono();
    const box = shapeOf(scene, 'box').attrs.fill as string;
    const dot = shapeOf(scene, 'dot').attrs.fill as string;
    // #a5b4fc is lighter than #f97316 by luma.
    expect(box > dot).toBe(true);
  });

  it('leaves theme tokens alone, since the page decides those', () => {
    const scene = mono();
    const label = shapeOf(scene, 'label');
    expect(label.attrs.fill).toBe('var(--cloth-fg)');
  });

  it('leaves "none" alone', () => {
    const scene = mono({
      elements: [{ type: 'path', id: 'p', d: 'M 0 0 L 10 10', fill: 'none' }],
    });
    expect(shapeOf(scene, 'p').attrs.fill).toBe('none');
  });

  it('does not change any node kind', () => {
    const scene = mono();
    expect(shapeOf(scene, 'box').kind).toBe('rect');
    expect(shapeOf(scene, 'dot').kind).toBe('circle');
  });
});

/**
 * Arrowheads are markers and markers live in `<defs>`, which the node walk never
 * reaches. A greyscale figure with a blue arrowhead has failed at the one thing the
 * preset is for — found by looking at the rendered page rather than at the tests.
 */
describe('style and defs', () => {
  const arrowDoc = (style: Record<string, unknown>) =>
    animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'arrows',
      duration: 1000,
      canvas: { width: 200, height: 100 },
      style,
      elements: [
        {
          type: 'arrow',
          id: 'a',
          x1: 10,
          y1: 50,
          x2: 190,
          y2: 50,
          stroke: '#6366f1',
          headEnd: 'arrow',
          appearances: ALWAYS,
        },
      ],
    });

  const markerFills = (doc: AnimationDocument): unknown[] =>
    buildScene(doc, 0)
      .defs.filter((def) => def.kind === 'marker')
      .flatMap((def) => def.children.map((child) => child.attrs.fill));

  it('greyscales arrowheads under mono', () => {
    const fills = markerFills(arrowDoc({ preset: 'mono' }));
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) expect(String(fill)).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });

  it('leaves arrowheads alone under sketch, where a jittered head is a smudge', () => {
    expect(markerFills(arrowDoc({ preset: 'sketch' }))).toEqual(
      markerFills(arrowDoc({ preset: 'clean' })),
    );
  });
});

/**
 * Marker ids are document-global. The colour is baked into the id, so two markers
 * sharing an id used to have identical contents — a preset breaks that, and
 * `url(#…)` resolves to whichever definition the page loaded first. Two players side
 * by side, one styled and one not, drew the same arrowhead. Found on the page, not
 * in a test.
 */
describe('marker ids under a preset', () => {
  const arrow = (style?: Record<string, unknown>) =>
    animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'arrowed',
      duration: 1000,
      canvas: { width: 200, height: 100 },
      ...(style ? { style } : {}),
      elements: [
        {
          type: 'arrow',
          id: 'a',
          x1: 10,
          y1: 50,
          x2: 190,
          y2: 50,
          stroke: '#6366f1',
          headEnd: 'arrow',
          appearances: ALWAYS,
        },
      ],
    });

  const markerIdOf = (doc: AnimationDocument): string =>
    String(buildScene(doc, 0).defs.find((def) => def.kind === 'marker')!.attrs.id);

  const referenceOf = (doc: AnimationDocument): string => {
    const find = (nodes: readonly SceneNode[]): string | null => {
      for (const node of nodes) {
        if (typeof node.attrs['marker-end'] === 'string') return node.attrs['marker-end'];
        if (node.kind === 'g') {
          const inner = find(node.children);
          if (inner) return inner;
        }
      }
      return null;
    };
    return find(buildScene(doc, 0).nodes)!;
  };

  it('gives a styled marker its own id', () => {
    expect(markerIdOf(arrow({ preset: 'mono' }))).not.toBe(markerIdOf(arrow()));
  });

  it('points the reference at the renamed definition', () => {
    const doc = arrow({ preset: 'mono' });
    expect(referenceOf(doc)).toBe(`url(#${markerIdOf(doc)})`);
  });

  it('leaves ids alone when no preset touches the defs', () => {
    for (const doc of [arrow(), arrow({ preset: 'sketch' })]) {
      expect(markerIdOf(doc)).toBe('cloth-h-arrow-6366f1');
      expect(referenceOf(doc)).toBe('url(#cloth-h-arrow-6366f1)');
    }
  });
});
