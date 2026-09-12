// Axis-aligned bounding boxes for elements.
//
// The scene builder never needed these: every element type knows how to draw
// itself from its own state, and connectors resolve endpoints through
// core/geometry/anchors. A camera does need them — "frame these two nodes" is a
// question about extent, not about position — and so will spotlight masks and
// chart axis placement.
//
// Text is the one type without an exact answer here. Its box depends on font
// metrics the core does not have, so it is estimated from `estimateTextWidth` and
// marked `approximate`. Callers that add padding (every current caller does) are
// unaffected by the error; callers that need exactness must inject a measurer.

import type { AnimationElement } from '../schema/elements';
import { estimateMonospaceWidth, estimateTextWidth } from '../text/width';
import type { TextMeasurer } from '../text/width';
import { applyToPoint, type Matrix, type Point } from './matrix';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Bounds extends Rect {
  /** True when the box was estimated rather than derived exactly (text, path curves). */
  readonly approximate: boolean;
}

/** Live element state as produced by computeSnapshot. */
type State = Record<string, unknown>;

export interface BoundsOptions {
  readonly measurer?: TextMeasurer;
  readonly fontFamily?: string;
  readonly monospaceFamily?: string;
}

function num(state: State, key: string, fallback = 0): number {
  const value = state[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(state: State, key: string, fallback = ''): string {
  const value = state[key];
  return typeof value === 'string' ? value : fallback;
}

function rect(x: number, y: number, width: number, height: number, approximate = false): Bounds {
  return {
    x: width < 0 ? x + width : x,
    y: height < 0 ? y + height : y,
    width: Math.abs(width),
    height: Math.abs(height),
    approximate,
  };
}

/** The smallest box containing every point, or null for an empty list. */
export function boundsOfPoints(points: readonly Point[], approximate = false): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, approximate };
}

/** The smallest box containing every input box, or null when there are none. */
export function unionBounds(boxes: readonly (Bounds | null)[]): Bounds | null {
  const present = boxes.filter((box): box is Bounds => box !== null);
  if (present.length === 0) return null;
  const corners = present.flatMap((box) => [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
  ]);
  const merged = boundsOfPoints(corners);
  if (!merged) return null;
  return { ...merged, approximate: present.some((box) => box.approximate) };
}

/** Grow a box by `padding` on every side. */
export function padBounds(box: Bounds, padding: number): Bounds {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
    approximate: box.approximate,
  };
}

/**
 * Re-express a box in another coordinate space.
 *
 * The result is the axis-aligned box around the transformed corners, so a rotated
 * box grows — which is the correct answer for "what area does this occupy".
 */
export function transformBounds(box: Bounds, matrix: Matrix): Bounds {
  const corners: Point[] = [
    applyToPoint(matrix, { x: box.x, y: box.y }),
    applyToPoint(matrix, { x: box.x + box.width, y: box.y }),
    applyToPoint(matrix, { x: box.x, y: box.y + box.height }),
    applyToPoint(matrix, { x: box.x + box.width, y: box.y + box.height }),
  ];
  const transformed = boundsOfPoints(corners, box.approximate);
  return transformed ?? box;
}

/** Every number in a string, in order. Used for `path.d` and `polygon.points`. */
function numbersIn(source: string): number[] {
  const matches = source.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!matches) return [];
  const out: number[] = [];
  for (const match of matches) {
    const value = Number(match);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

function pointsFromPairs(source: string): Point[] {
  const numbers = numbersIn(source);
  const points: Point[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push({ x: numbers[i]!, y: numbers[i + 1]! });
  }
  return points;
}

/**
 * The element's box in its own coordinate space, or null when it has no extent
 * the core can determine (a connector whose endpoints are anchored elsewhere, an
 * empty group).
 *
 * Rotation is not applied: like `accumulatedMatrices`, this reports the untilted
 * box and leaves the element's own rotation to the caller, which knows whether it
 * wants the drawn area or the layout box.
 */
export function elementLocalBounds(
  el: AnimationElement,
  state: State,
  options: BoundsOptions = {},
): Bounds | null {
  switch (el.type) {
    case 'rect':
    case 'image':
      return rect(num(state, 'x'), num(state, 'y'), num(state, 'width'), num(state, 'height'));

    case 'code':
      return rect(num(state, 'x'), num(state, 'y'), num(state, 'width'), num(state, 'height'));

    case 'circle': {
      const r = num(state, 'r');
      return rect(num(state, 'cx') - r, num(state, 'cy') - r, r * 2, r * 2);
    }

    case 'line':
    case 'arrow': {
      const { x1, y1, x2, y2 } = state;
      if (
        typeof x1 !== 'number' ||
        typeof y1 !== 'number' ||
        typeof x2 !== 'number' ||
        typeof y2 !== 'number'
      ) {
        return null;
      }
      return boundsOfPoints([
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ]);
    }

    case 'text': {
      const fontSize = num(state, 'fontSize', 16);
      const content = str(state, 'content');
      const width = estimateTextWidth(content, fontSize, {
        measurer: options.measurer,
        fontFamily: options.fontFamily,
      });
      const anchor = str(state, 'textAnchor', 'start');
      const x = num(state, 'x');
      const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
      // `y` is the baseline; ascent is roughly 0.8em and descent 0.2em.
      return rect(left, num(state, 'y') - fontSize * 0.8, width, fontSize, true);
    }

    case 'math': {
      // Measured as the monospace source fallback, because that is the one rendering
      // the core can predict: a `mathRenderer` returns a subtree the host lays out,
      // and bounds runs without a scene to measure. So a typeset expression is
      // usually narrower than this says — `\\frac{-b}{2a}` typesets to about a third
      // of its source width.
      //
      // Reporting a generous box beats reporting none. Without a case here `math`
      // fell to `default: return null`, and every feature that resolves against
      // bounds refused to work on it while blaming the element: camera focus said
      // "no visible target", spotlight said "not on stage", and a trail reported no
      // position — for an element plainly on screen. Framing slightly wide is a
      // cosmetic error, and both camera focus and spotlight already have `padding`
      // for taste.
      const fontSize = num(state, 'fontSize', 16);
      const width = estimateMonospaceWidth(str(state, 'tex'), fontSize);
      const anchor = str(state, 'textAnchor', 'start');
      const x = num(state, 'x');
      const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
      // Same baseline-relative box as `text`, since the fallback *is* a line of text.
      // A typeset fraction reaches further above and below; `padding` covers it.
      return rect(left, num(state, 'y') - fontSize * 0.8, width, fontSize, true);
    }

    case 'path': {
      const points = pointsFromPairs(str(state, 'd'));
      const local = boundsOfPoints(points, true);
      if (!local) return null;
      // Control points are included, so the box is a superset of the drawn curve.
      return {
        ...local,
        x: local.x + num(state, 'x'),
        y: local.y + num(state, 'y'),
        approximate: true,
      };
    }

    case 'polygon':
      return boundsOfPoints(pointsFromPairs(str(state, 'points')));

    case 'group':
      // A group's extent is its children's; the tree walker unions them.
      return null;

    default:
      return null;
  }
}
