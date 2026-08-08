// 2D affine transforms, in SVG's own 6-value form.
//
// Needed because v1 groups nest (docs/SCHEMA-V1.md §2.1). Nested `<g transform>`
// handles rendering on its own, but connector anchoring does not: an arrow at the
// root pointing into a translated, rotated group must resolve its endpoint in root
// space. Legacy never faced this — its groups did not work, so every coordinate
// was already absolute.
//
// Layout matches SVG's `matrix(a b c d e f)`:
//   | a c e |
//   | b d f |
//   | 0 0 1 |

/** `matrix(a b c d e f)` — column-major, as SVG writes it. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** `m1` then `m2` applied to a point means `multiply(m1, m2)` — parent first. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

/** Rotation in degrees, matching SVG's `rotate()`. */
export function rotation(degrees: number, cx = 0, cy = 0): Matrix {
  if (degrees === 0) return translation(0, 0);
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  if (cx === 0 && cy === 0) return [cos, sin, -sin, cos, 0, 0];
  // rotate(θ, cx, cy) = translate(cx,cy) · rotate(θ) · translate(-cx,-cy)
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

export function scaling(sx: number, sy: number = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function applyToPoint(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/**
 * Compose a group's own transform: translate to its origin, then rotate about it.
 *
 * Rotating about the group origin rather than an arbitrary point is what makes a
 * group behave as one rigid unit — children keep their relative arrangement.
 */
export function groupMatrix(x: number, y: number, degrees: number): Matrix {
  const t = translation(x, y);
  if (degrees === 0) return t;
  return multiply(t, rotation(degrees));
}

/** Serialize for an SVG `transform` attribute. */
export function toSvgTransform(m: Matrix): string {
  return `matrix(${m.map(formatNumber).join(' ')})`;
}

/** Trim float noise so serialized output is stable and diffable. */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const rounded = Number(n.toFixed(6));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
