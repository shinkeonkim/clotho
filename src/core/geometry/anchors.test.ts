// Anchor and endpoint tests. Ported from the anchor logic embedded in legacy's
// arrows.tsx, plus new cases for resolution across group transforms.

import { describe, expect, it } from 'bun:test';
import { elementSchema, type AnimationElement } from '../schema/elements';
import {
  anchorPoint,
  curveControlPoint,
  elementCenter,
  polygonCentroid,
  resolveEndpoints,
} from './anchors';
import { translation, IDENTITY, type Matrix } from './matrix';

const box = elementSchema.parse({ type: 'rect', id: 'b', x: 100, y: 200, width: 80, height: 40 });
const boxState = { x: 100, y: 200, width: 80, height: 40 };
const circle = elementSchema.parse({ type: 'circle', id: 'c', cx: 50, cy: 60, r: 10 });
const circleState = { cx: 50, cy: 60, r: 10 };

describe('elementCenter', () => {
  it('centers a rect on its box', () => {
    expect(elementCenter(box, boxState)).toEqual({ x: 140, y: 220 });
  });

  it('uses the circle center', () => {
    expect(elementCenter(circle, circleState)).toEqual({ x: 50, y: 60 });
  });

  it('reports the text anchor point, since metrics are unavailable', () => {
    const text = elementSchema.parse({ type: 'text', id: 't', x: 5, y: 7, content: 'hi' });
    expect(elementCenter(text, { x: 5, y: 7 })).toEqual({ x: 5, y: 7 });
  });

  it('midpoints a connector with explicit coordinates', () => {
    const line = elementSchema.parse({ type: 'line', id: 'l', x1: 0, y1: 0, x2: 10, y2: 20 });
    expect(elementCenter(line, { x1: 0, y1: 0, x2: 10, y2: 20 })).toEqual({ x: 5, y: 10 });
  });

  it('returns null for a connector without coordinates', () => {
    const line = elementSchema.parse({ type: 'line', id: 'l', fromId: 'a', toId: 'b' });
    expect(elementCenter(line, {})).toBeNull();
  });

  it('returns null for shapes with no meaningful center', () => {
    expect(elementCenter(elementSchema.parse({ type: 'group', id: 'g' }), {})).toBeNull();
    expect(
      elementCenter(
        elementSchema.parse({
          type: 'code',
          id: 'k',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          content: '',
        }),
        {},
      ),
    ).toBeNull();
  });
});

describe('anchorPoint', () => {
  it('resolves the four sides of a box', () => {
    expect(anchorPoint(box, boxState, 'top')).toEqual({ x: 140, y: 200 });
    expect(anchorPoint(box, boxState, 'bottom')).toEqual({ x: 140, y: 240 });
    expect(anchorPoint(box, boxState, 'left')).toEqual({ x: 100, y: 220 });
    expect(anchorPoint(box, boxState, 'right')).toEqual({ x: 180, y: 220 });
  });

  it('resolves the four corners of a box', () => {
    expect(anchorPoint(box, boxState, 'top-left')).toEqual({ x: 100, y: 200 });
    expect(anchorPoint(box, boxState, 'top-right')).toEqual({ x: 180, y: 200 });
    expect(anchorPoint(box, boxState, 'bottom-left')).toEqual({ x: 100, y: 240 });
    expect(anchorPoint(box, boxState, 'bottom-right')).toEqual({ x: 180, y: 240 });
  });

  it('resolves circle sides using the radius', () => {
    expect(anchorPoint(circle, circleState, 'top')).toEqual({ x: 50, y: 50 });
    expect(anchorPoint(circle, circleState, 'right')).toEqual({ x: 60, y: 60 });
  });

  it('falls back to the center for auto, center, and undefined', () => {
    for (const anchor of ['auto', 'center', undefined] as const) {
      expect(anchorPoint(box, boxState, anchor), String(anchor)).toEqual({ x: 140, y: 220 });
    }
  });

  it('resolves circle corners on the circumference', () => {
    const point = anchorPoint(circle, circleState, 'top-left');
    expect(point.x).toBeCloseTo(50 - 10 / Math.SQRT2);
    expect(point.y).toBeCloseTo(60 - 10 / Math.SQRT2);
  });
});

function ctx(
  elements: AnimationElement[],
  states: Record<string, Record<string, unknown>>,
  matrices?: Map<string, Matrix>,
) {
  return {
    snapshot: new Map(Object.entries(states)),
    elementById: new Map(elements.map((el) => [el.id, el])),
    ...(matrices ? { matrices } : {}),
  };
}

describe('resolveEndpoints', () => {
  const arrow = elementSchema.parse({
    type: 'arrow',
    id: 'a',
    fromId: 'b',
    toId: 'c',
    fromAnchor: 'right',
    toAnchor: 'left',
  }) as Extract<AnimationElement, { type: 'arrow' }>;

  it('resolves both ends from anchored elements', () => {
    const ends = resolveEndpoints(arrow, {}, ctx([box, circle], { b: boxState, c: circleState }));
    expect(ends).toEqual({ x1: 180, y1: 220, x2: 40, y2: 60 });
  });

  it('resolves auto anchors to the edges facing the other endpoint', () => {
    const automatic = elementSchema.parse({
      type: 'arrow',
      id: 'auto-arrow',
      fromId: 'b',
      toId: 'c',
      fromAnchor: 'auto',
      toAnchor: 'auto',
    }) as Extract<AnimationElement, { type: 'arrow' }>;
    const ends = resolveEndpoints(
      automatic,
      {},
      ctx([box, circle], { b: boxState, c: circleState }),
    );
    expect(ends?.x1).toBe(100);
    expect(ends?.y1).toBe(200);
    expect(ends?.x2).toBeCloseTo(50 + 10 / Math.SQRT2);
    expect(ends?.y2).toBeCloseTo(60 + 10 / Math.SQRT2);
  });

  it('keeps auto anchor selection correct across group transforms', () => {
    const automatic = elementSchema.parse({
      type: 'arrow',
      id: 'auto-arrow',
      fromId: 'b',
      toId: 'c',
      fromAnchor: 'auto',
      toAnchor: 'auto',
    }) as Extract<AnimationElement, { type: 'arrow' }>;
    const matrices = new Map<string, Matrix>([
      ['auto-arrow', IDENTITY],
      ['b', translation(-200, 0)],
      ['c', translation(300, 0)],
    ]);
    const ends = resolveEndpoints(
      automatic,
      {},
      ctx([box, circle], { b: boxState, c: circleState }, matrices),
    );
    expect(ends).toEqual({ x1: -20, y1: 200, x2: 340, y2: 60 });
  });

  it('uses explicit coordinates when no element is anchored', () => {
    const line = elementSchema.parse({
      type: 'line',
      id: 'l',
      x1: 1,
      y1: 2,
      x2: 3,
      y2: 4,
    }) as Extract<AnimationElement, { type: 'line' }>;
    expect(resolveEndpoints(line, { x1: 1, y1: 2, x2: 3, y2: 4 }, ctx([], {}))).toEqual({
      x1: 1,
      y1: 2,
      x2: 3,
      y2: 4,
    });
  });

  it('returns null when an anchored element is missing', () => {
    expect(resolveEndpoints(arrow, {}, ctx([box], { b: boxState }))).toBeNull();
  });

  it('returns null when explicit coordinates are absent', () => {
    const line = elementSchema.parse({ type: 'line', id: 'l' }) as Extract<
      AnimationElement,
      { type: 'line' }
    >;
    expect(resolveEndpoints(line, {}, ctx([], {}))).toBeNull();
  });

  it('reads live coordinates from the snapshot, not the stored element', () => {
    const moved = { ...boxState, x: 500 };
    const ends = resolveEndpoints(arrow, {}, ctx([box, circle], { b: moved, c: circleState }));
    expect(ends?.x1).toBe(580);
  });

  // New in v1: legacy read snapshot coordinates directly, which only worked
  // because its groups never applied a transform.
  it('carries a target group transform into the connector space', () => {
    const matrices = new Map<string, Matrix>([
      ['a', IDENTITY],
      ['b', translation(1000, 0)],
      ['c', IDENTITY],
    ]);
    const ends = resolveEndpoints(
      arrow,
      {},
      ctx([box, circle], { b: boxState, c: circleState }, matrices),
    );
    expect(ends?.x1).toBe(1180);
    expect(ends?.x2).toBe(40);
  });

  it('expresses the endpoint in the connector own space when the connector is grouped', () => {
    const matrices = new Map<string, Matrix>([
      ['a', translation(100, 0)], // the arrow itself lives inside a translated group
      ['b', IDENTITY],
      ['c', IDENTITY],
    ]);
    const ends = resolveEndpoints(
      arrow,
      {},
      ctx([box, circle], { b: boxState, c: circleState }, matrices),
    );
    // Target is at root x=180; the arrow's frame is offset by 100, so locally 80.
    expect(ends?.x1).toBe(80);
  });

  it('matches the untransformed result when every matrix is identity', () => {
    const matrices = new Map<string, Matrix>([
      ['a', IDENTITY],
      ['b', IDENTITY],
      ['c', IDENTITY],
    ]);
    const withMatrices = resolveEndpoints(
      arrow,
      {},
      ctx([box, circle], { b: boxState, c: circleState }, matrices),
    );
    const without = resolveEndpoints(
      arrow,
      {},
      ctx([box, circle], { b: boxState, c: circleState }),
    );
    expect(withMatrices).toEqual(without);
  });
});

describe('curveControlPoint', () => {
  it('sits at the midpoint when curvature is zero', () => {
    expect(curveControlPoint({ x1: 0, y1: 0, x2: 100, y2: 0 }, 0)).toEqual({ x: 50, y: 0 });
  });

  it('offsets perpendicular to the chord', () => {
    const p = curveControlPoint({ x1: 0, y1: 0, x2: 100, y2: 0 }, 20);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(20);
  });

  it('flips the offset with the sign of curvature', () => {
    expect(curveControlPoint({ x1: 0, y1: 0, x2: 100, y2: 0 }, -20).y).toBeCloseTo(-20);
  });

  it('does not divide by zero for a degenerate chord', () => {
    const p = curveControlPoint({ x1: 5, y1: 5, x2: 5, y2: 5 }, 10);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe('polygonCentroid', () => {
  it('averages the points', () => {
    expect(polygonCentroid('0,0 10,0 10,10 0,10')).toEqual({ x: 5, y: 5 });
  });

  it('tolerates extra whitespace', () => {
    expect(polygonCentroid('  0,0   10,10  ')).toEqual({ x: 5, y: 5 });
  });

  it('returns the origin for empty or unparseable input', () => {
    expect(polygonCentroid('')).toEqual({ x: 0, y: 0 });
    expect(polygonCentroid('garbage')).toEqual({ x: 0, y: 0 });
  });
});
