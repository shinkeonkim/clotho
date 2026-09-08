// Bounding box tests. All new behavior — nothing before the camera needed extent.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import { computeSnapshot } from '../runtime/snapshot';
import {
  boundsOfPoints,
  elementLocalBounds,
  padBounds,
  transformBounds,
  unionBounds,
} from './bounds';
import { rotation, scaling, translation } from './matrix';

const ALWAYS = [{ start: 0, end: 10_000, entryDuration: 0, exitDuration: 0 }];

/** Parse one element through the real schema so defaults are applied. */
function stateOf(element: Record<string, unknown>): {
  el: AnimationElement;
  state: Record<string, unknown>;
} {
  const parsed = animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'a',
    duration: 10_000,
    elements: [{ appearances: ALWAYS, ...element }],
  });
  const el = parsed.elements[0]!;
  return { el, state: computeSnapshot(parsed, 0).get(el.id)! };
}

function boundsOf(element: Record<string, unknown>) {
  const { el, state } = stateOf(element);
  return elementLocalBounds(el, state);
}

describe('boundsOfPoints', () => {
  it('returns null for an empty list', () => {
    expect(boundsOfPoints([])).toBeNull();
  });

  it('spans the extremes', () => {
    expect(
      boundsOfPoints([
        { x: 3, y: 9 },
        { x: -1, y: 4 },
        { x: 2, y: 20 },
      ]),
    ).toEqual({
      x: -1,
      y: 4,
      width: 4,
      height: 16,
      approximate: false,
    });
  });

  it('ignores non-finite coordinates rather than poisoning the box', () => {
    const box = boundsOfPoints([
      { x: 0, y: 0 },
      { x: NaN, y: 5 },
      { x: 10, y: 10 },
    ]);
    expect(box).toEqual({ x: 0, y: 0, width: 10, height: 10, approximate: false });
  });

  it('gives a zero-size box for a single point', () => {
    expect(boundsOfPoints([{ x: 5, y: 5 }])).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
      approximate: false,
    });
  });
});

describe('unionBounds', () => {
  it('returns null when nothing is present', () => {
    expect(unionBounds([null, null])).toBeNull();
  });

  it('merges boxes and keeps approximateness sticky', () => {
    const exact = { x: 0, y: 0, width: 10, height: 10, approximate: false };
    const approx = { x: 20, y: 5, width: 5, height: 5, approximate: true };
    expect(unionBounds([exact, null, approx])).toEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 10,
      approximate: true,
    });
  });
});

describe('padBounds', () => {
  it('grows on every side', () => {
    expect(padBounds({ x: 10, y: 10, width: 5, height: 5, approximate: false }, 2)).toEqual({
      x: 8,
      y: 8,
      width: 9,
      height: 9,
      approximate: false,
    });
  });
});

describe('transformBounds', () => {
  const box = { x: 0, y: 0, width: 10, height: 4, approximate: false };

  it('translates', () => {
    expect(transformBounds(box, translation(5, -2))).toMatchObject({
      x: 5,
      y: -2,
      width: 10,
      height: 4,
    });
  });

  it('scales', () => {
    expect(transformBounds(box, scaling(2, 3))).toMatchObject({
      x: 0,
      y: 0,
      width: 20,
      height: 12,
    });
  });

  it('grows to the axis-aligned box around a rotated one', () => {
    const rotated = transformBounds(box, rotation(90));
    expect(rotated.width).toBeCloseTo(4, 6);
    expect(rotated.height).toBeCloseTo(10, 6);
  });
});

describe('elementLocalBounds', () => {
  it('boxes a rect from its own coordinates', () => {
    expect(boundsOf({ type: 'rect', id: 'r', x: 10, y: 20, width: 30, height: 40 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      approximate: false,
    });
  });

  it('boxes a circle around its radius', () => {
    expect(boundsOf({ type: 'circle', id: 'c', cx: 50, cy: 50, r: 10 })).toEqual({
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      approximate: false,
    });
  });

  it('boxes an image and a code block by width and height', () => {
    expect(
      boundsOf({ type: 'code', id: 'k', x: 5, y: 5, width: 100, height: 60, content: 'x' }),
    ).toMatchObject({
      x: 5,
      y: 5,
      width: 100,
      height: 60,
    });
  });

  it('boxes a connector between explicit endpoints, in either order', () => {
    expect(boundsOf({ type: 'line', id: 'l', x1: 90, y1: 10, x2: 10, y2: 50 })).toEqual({
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      approximate: false,
    });
  });

  it('returns null for a connector whose endpoints are anchored elsewhere', () => {
    expect(boundsOf({ type: 'line', id: 'l', fromId: 'a', toId: 'b' })).toBeNull();
  });

  it('parses polygon points exactly', () => {
    expect(boundsOf({ type: 'polygon', id: 'p', points: '0,0 20,5 10,30' })).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 30,
      approximate: false,
    });
  });

  it('boxes a path from its coordinate numbers, offset by x/y, and marks it approximate', () => {
    const box = boundsOf({ type: 'path', id: 'p', x: 100, y: 100, d: 'M 0 0 L 10 20 L 5 30' })!;
    expect(box).toEqual({ x: 100, y: 100, width: 10, height: 30, approximate: true });
  });

  it('estimates a text box around the baseline and marks it approximate', () => {
    const box = boundsOf({ type: 'text', id: 't', x: 0, y: 100, content: 'abc', fontSize: 20 })!;
    expect(box.approximate).toBe(true);
    expect(box.width).toBeGreaterThan(0);
    // The baseline sits inside the box, not at its top edge.
    expect(box.y).toBeLessThan(100);
    expect(box.y + box.height).toBeGreaterThan(100);
  });

  it('shifts a text box for middle and end anchors', () => {
    const start = boundsOf({
      type: 'text',
      id: 't',
      x: 100,
      y: 10,
      content: 'abc',
      textAnchor: 'start',
    })!;
    const middle = boundsOf({
      type: 'text',
      id: 't',
      x: 100,
      y: 10,
      content: 'abc',
      textAnchor: 'middle',
    })!;
    const end = boundsOf({
      type: 'text',
      id: 't',
      x: 100,
      y: 10,
      content: 'abc',
      textAnchor: 'end',
    })!;
    expect(middle.x).toBeCloseTo(start.x - start.width / 2, 6);
    expect(end.x).toBeCloseTo(start.x - start.width, 6);
  });

  it('uses an injected measurer instead of the estimate', () => {
    const { el, state } = stateOf({
      type: 'text',
      id: 't',
      x: 0,
      y: 0,
      content: 'abc',
      fontSize: 10,
    });
    const box = elementLocalBounds(el, state, { measurer: { measure: () => 123 } })!;
    expect(box.width).toBe(123);
  });

  it('reports no box of its own for a group', () => {
    expect(boundsOf({ type: 'group', id: 'g', x: 5, y: 5 })).toBeNull();
  });
});
