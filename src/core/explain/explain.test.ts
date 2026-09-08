// Inspector tests.
//
// The load-bearing one is at the bottom: whatever the explanation says the value is
// must be what the snapshot says it is. An inspector that disagrees with the
// renderer is worse than no inspector, and the only way it stays honest is to be
// checked against the thing it explains.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import { computeSnapshot } from '../runtime/snapshot';
import { describeReason, explainElement, explainValue } from './index';

const ALWAYS = [{ start: 0, end: 4000, entryDuration: 0, exitDuration: 0 }];

function animation(over: Record<string, unknown> = {}): AnimationDocument {
  const { elements, ...rest } = over as { elements?: Record<string, unknown>[] };
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'doc',
    duration: 4000,
    canvas: { width: 400, height: 300 },
    elements: (
      elements ?? [
        {
          type: 'rect',
          id: 'box',
          x: 10,
          y: 20,
          width: 50,
          height: 30,
          fill: '#fef3c7',
          tracks: [
            {
              property: 'x',
              keyframes: [
                { time: 0, value: 10 },
                { time: 1000, value: 110, ease: 'linear' },
                { time: 2000, value: 210, ease: 'linear' },
              ],
            },
          ],
        },
      ]
    ).map((element) => ({ appearances: ALWAYS, ...element })),
    ...rest,
  });
}

describe('explainValue', () => {
  it('names the keyframe pair being blended and how far through it is', () => {
    const explanation = explainValue(animation(), 500, 'box', 'x')!;
    expect(explanation.source).toBe('track');
    expect(explanation.track).toMatchObject({
      keyframeCount: 3,
      from: { time: 0, value: 10 },
      to: { time: 1000, value: 110 },
      ease: 'linear',
      clamped: false,
    });
    expect(explanation.track!.progress).toBeCloseTo(0.5, 6);
    expect(explanation.value).toBeCloseTo(60, 6);
  });

  it('resolves the interpolation mode rather than reporting "auto"', () => {
    const explanation = explainValue(animation(), 500, 'box', 'x')!;
    expect(explanation.track!.interpolate).toBe('auto');
    expect(explanation.track!.blend).toBe('number');
  });

  it('says a value is clamped past the last keyframe', () => {
    const explanation = explainValue(animation(), 3500, 'box', 'x')!;
    expect(explanation.track!.clamped).toBe(true);
    expect(explanation.track!.progress).toBe(1);
    expect(explanation.value).toBe(210);
  });

  it('says a value is clamped before the first keyframe', () => {
    const explanation = explainValue(animation(), 0, 'box', 'x')!;
    expect(explanation.track!.clamped).toBe(true);
    expect(explanation.value).toBe(10);
  });

  it('reports an untracked property as coming from the element itself', () => {
    const explanation = explainValue(animation(), 500, 'box', 'height')!;
    expect(explanation.source).toBe('base');
    expect(explanation.track).toBeUndefined();
    expect(explanation.value).toBe(30);
    expect(explanation.contributors).toEqual([{ stage: 'base', value: 30 }]);
  });

  it('lists the stages a value passed through', () => {
    const explanation = explainValue(animation(), 500, 'box', 'x')!;
    expect(explanation.contributors.map((c) => c.stage)).toEqual(['base', 'track']);
  });

  /**
   * The case that sends authors hunting: the track says one colour, the screen
   * shows another, and nothing connects the two.
   */
  it('attributes a colour an effect took over', () => {
    const scenario = animation({
      effects: [
        {
          type: 'highlight',
          id: 'h',
          elementId: 'box',
          time: 400,
          duration: 400,
          color: '#facc15',
        },
      ],
    });
    const explanation = explainValue(scenario, 500, 'box', 'fill')!;
    expect(explanation.source).toBe('effect');
    expect(explanation.value).toBe('#facc15');
    expect(explanation.contributors.at(-1)).toMatchObject({ stage: 'effect', by: 'h' });
  });

  it('leaves the colour alone once the effect is over', () => {
    const scenario = animation({
      effects: [
        {
          type: 'highlight',
          id: 'h',
          elementId: 'box',
          time: 400,
          duration: 400,
          color: '#facc15',
        },
      ],
    });
    expect(explainValue(scenario, 900, 'box', 'fill')!.value).toBe('#fef3c7');
  });

  it('returns null for an element or property that is not there', () => {
    expect(explainValue(animation(), 0, 'nope', 'x')).toBeNull();
    expect(explainValue(animation(), 0, 'box', 'notAProperty')).toBeNull();
  });
});

describe('explainElement — why can I not see it', () => {
  const hidden = (elements: Record<string, unknown>[], time: number) =>
    explainElement(animation({ elements }), time, 'box')!;

  it('is silent when the element is simply on stage', () => {
    const explanation = explainElement(animation(), 500, 'box')!;
    expect(explanation.visible).toBe(true);
    expect(explanation.invisibleBecause).toEqual([]);
  });

  it('reports an element with no appearance windows at all', () => {
    const explanation = hidden(
      [{ type: 'rect', id: 'box', x: 0, y: 0, width: 10, height: 10, appearances: [] }],
      500,
    );
    expect(explanation.invisibleBecause).toEqual([{ kind: 'no-appearances' }]);
  });

  it('reports a time outside every window, and names the nearest one', () => {
    const explanation = hidden(
      [
        {
          type: 'rect',
          id: 'box',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          appearances: [{ start: 2000, end: 3000 }],
        },
      ],
      500,
    );
    expect(explanation.invisibleBecause[0]).toEqual({
      kind: 'outside-appearance',
      nearest: { start: 2000, end: 3000 },
    });
  });

  it('reports an ancestor group that is off stage', () => {
    const explanation = hidden(
      [
        { type: 'group', id: 'g', x: 0, y: 0, appearances: [{ start: 3000, end: 4000 }] },
        { type: 'rect', id: 'box', parentId: 'g', x: 0, y: 0, width: 10, height: 10 },
      ],
      500,
    );
    expect(explanation.invisibleBecause).toContainEqual({ kind: 'parent-hidden', parentId: 'g' });
  });

  it('reports a broken place in the tree', () => {
    const explanation = hidden(
      [{ type: 'rect', id: 'box', parentId: 'ghost', x: 0, y: 0, width: 10, height: 10 }],
      500,
    );
    expect(explanation.invisibleBecause.map((r) => r.kind)).toContain('tree-issue');
  });

  it('reports zero opacity', () => {
    const explanation = hidden([{ type: 'path', id: 'box', d: 'M 0 0 L 10 10', opacity: 0 }], 500);
    expect(explanation.invisibleBecause).toContainEqual({ kind: 'zero-opacity' });
  });

  it('reports an element drawn off the canvas', () => {
    const explanation = hidden(
      [{ type: 'rect', id: 'box', x: 900, y: 900, width: 10, height: 10 }],
      500,
    );
    expect(explanation.invisibleBecause[0]!.kind).toBe('off-canvas');
  });

  it('does not call an on-canvas element off-canvas', () => {
    expect(explainElement(animation(), 500, 'box')!.invisibleBecause).toEqual([]);
  });

  /** Fixing one cause should not leave the author staring at a still-missing element. */
  it('collects every reason rather than stopping at the first', () => {
    const explanation = hidden(
      [
        { type: 'group', id: 'g', x: 0, y: 0, appearances: [{ start: 3000, end: 4000 }] },
        {
          type: 'rect',
          id: 'box',
          parentId: 'g',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          appearances: [{ start: 3500, end: 4000 }],
        },
      ],
      500,
    );
    expect(explanation.invisibleBecause.map((r) => r.kind).sort()).toEqual([
      'outside-appearance',
      'parent-hidden',
    ]);
  });

  it('explains every authored and tracked property', () => {
    const explanation = explainElement(animation(), 500, 'box')!;
    const properties = explanation.values.map((value) => value.property);
    expect(properties).toContain('x');
    expect(properties).toContain('fill');
    expect(properties).toContain('width');
  });

  it('returns null for an element that is not in the animation', () => {
    expect(explainElement(animation(), 0, 'nope')).toBeNull();
  });
});

describe('describeReason', () => {
  it('produces a sentence for every kind', () => {
    const reasons = [
      { kind: 'no-appearances' },
      { kind: 'outside-appearance', nearest: { start: 1, end: 2 } },
      { kind: 'parent-hidden', parentId: 'g' },
      { kind: 'tree-issue', message: 'cycle' },
      { kind: 'off-canvas', bounds: { x: 900, y: 900, width: 10, height: 10 } },
      { kind: 'zero-opacity' },
    ] as const;
    for (const reason of reasons) {
      expect(describeReason(reason).length).toBeGreaterThan(10);
    }
  });
});

/**
 * The check the whole feature rests on.
 *
 * The explanation is computed a second time rather than by instrumenting the render
 * path, which is the right trade for a function that runs on a click instead of
 * sixty times a second — but it means the two could drift. They must not.
 */
describe('the explanation agrees with the renderer', () => {
  it('matches computeSnapshot at every sampled time', () => {
    const scenario = animation({
      elements: [
        {
          type: 'circle',
          id: 'dot',
          cx: 0,
          cy: 50,
          r: 10,
          fill: '#112233',
          tracks: [
            {
              property: 'cx',
              keyframes: [
                { time: 0, value: 0 },
                { time: 1500, value: 300, ease: 'easeInOut' },
                { time: 3000, value: 100 },
              ],
            },
            {
              property: 'fill',
              keyframes: [
                { time: 0, value: '#112233' },
                { time: 2000, value: '#ffffff' },
              ],
            },
            {
              property: 'r',
              keyframes: [
                { time: 0, value: 10 },
                { time: 1000, value: 40, ease: 'easeIn' },
              ],
            },
          ],
        },
      ],
    });

    for (const time of [0, 250, 700, 1000, 1499, 1500, 2200, 3000, 3999]) {
      const snapshot = computeSnapshot(scenario, time).get('dot')!;
      for (const property of ['cx', 'fill', 'r']) {
        expect(explainValue(scenario, time, 'dot', property)!.value).toEqual(snapshot[property]);
      }
    }
  });

  it('matches for untracked properties too', () => {
    const snapshot = computeSnapshot(animation(), 500).get('box')!;
    for (const property of ['width', 'height', 'fill']) {
      expect(explainValue(animation(), 500, 'box', property)!.value).toEqual(snapshot[property]);
    }
  });
});
