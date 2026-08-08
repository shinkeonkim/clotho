// Easing and linear blending. Extracted from the legacy engine's
// schema/runtime.ts, where `easeApply` and `lerp` were file-local helpers.
//
// Pulled out because the scene builder, the player controller, and the
// interpolator all need them, and because easing is a timing concern rather than
// a schema one.

import type { Ease } from '../schema/primitives';

/** Default applied when a keyframe omits `ease` — matches legacy behavior. */
export const DEFAULT_EASE: Ease = 'easeInOut';

/**
 * Map normalized progress `t` (0..1) through an easing curve.
 *
 * Curves are kept byte-identical to legacy: `easeIn` is quadratic, `easeOut` is
 * its mirror, and `easeInOut` is the standard piecewise quadratic. Any change
 * here silently alters every one of the 383 existing animations.
 */
export function easeApply(fn: Ease, t: number): number {
  if (fn === 'linear') return t;
  if (fn === 'easeIn') return t * t;
  if (fn === 'easeOut') return 1 - (1 - t) * (1 - t);
  const first = 2 * t * t;
  const second = 1 - Math.pow(-2 * t + 2, 2) / 2;
  return t < 0.5 ? first : second;
}

/** Linear blend from `a` to `b`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Constrain `value` to `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
