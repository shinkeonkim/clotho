// How consecutive keyframe values are blended.
//
// Legacy decided this purely from property-name sets in schema/keys.ts. v1 keeps
// that heuristic as the `auto` mode (which is what makes migration lossless) and
// lets a track state its mode explicitly — see docs/SCHEMA-V1.md §2.2.
//
// The name sets are reproduced exactly. They are behavior for 383 existing
// documents: adding `labelOffsetX` to the numeric set, say, would turn a stepped
// property into a blended one wherever it is tracked. A survey of the corpus
// confirms every tracked property is already classified, and the one unclassified
// case (`strokeDasharray`, 3 occurrences) is a value like "4 4" that *should*
// step rather than blend.

import type { Interpolation, TrackValue } from '../schema/primitives';
import { lerp } from '../timing/ease';
import { lerpColor } from './color';

const NUMERIC_PROPERTIES = new Set([
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'x1',
  'y1',
  'x2',
  'y2',
  'rotation',
  'opacity',
  'strokeWidth',
  'cornerRadius',
  'fontSize',
  'labelSize',
  'subtitleSize',
  'curvature',
]);

const COLOR_PROPERTIES = new Set(['fill', 'stroke', 'color', 'labelColor']);

/**
 * Textual properties.
 *
 * Note for anyone comparing against legacy: this classification has **no effect
 * on interpolation**. Legacy's `lerpValue` had a text branch that returned
 * `t < 0.5 ? prev : target` — byte-identical to its own fallback for unclassified
 * properties. The set is kept because editors and validators want to know which
 * properties hold prose, not because it changes blending.
 *
 * `assetId` and `alt` are v1 additions; `src` is gone from the element schemas.
 */
const TEXT_PROPERTIES = new Set(['label', 'subtitle', 'content', 'title', 'assetId', 'alt']);

export type PropertyKind = 'number' | 'color' | 'text' | 'unknown';

/** Classify a property by name, as legacy's schema/keys.ts did. */
export function classifyProperty(property: string): PropertyKind {
  if (NUMERIC_PROPERTIES.has(property)) return 'number';
  if (COLOR_PROPERTIES.has(property)) return 'color';
  if (TEXT_PROPERTIES.has(property)) return 'text';
  return 'unknown';
}

export function isNumericProperty(property: string): boolean {
  return NUMERIC_PROPERTIES.has(property);
}

export function isColorProperty(property: string): boolean {
  return COLOR_PROPERTIES.has(property);
}

export function isTextProperty(property: string): boolean {
  return TEXT_PROPERTIES.has(property);
}

/** The three blending strategies an interpolation mode can resolve to. */
export type BlendMode = 'number' | 'color' | 'discrete';

/**
 * Resolve a track's declared mode against its property name.
 *
 * `auto` (and an omitted mode) reproduces legacy: numeric names blend
 * numerically, color names blend as colors, everything else steps.
 */
export function resolveBlendMode(mode: Interpolation | undefined, property: string): BlendMode {
  if (mode === 'number' || mode === 'color' || mode === 'discrete') return mode;
  const kind = classifyProperty(property);
  if (kind === 'number') return 'number';
  if (kind === 'color') return 'color';
  return 'discrete';
}

/** Step at the midpoint — legacy's nearest-neighbor behavior. */
function step(from: TrackValue, to: TrackValue, t: number): TrackValue {
  return t < 0.5 ? from : to;
}

/**
 * Blend two keyframe values.
 *
 * Every mode degrades to stepping when the values are not the shape it needs
 * (a `number` mode over strings, a `color` mode over `var(--brand)`), so a
 * mislabeled track renders as a discrete swap rather than producing NaN.
 */
export function blendValues(
  from: TrackValue,
  to: TrackValue,
  t: number,
  mode: BlendMode,
): TrackValue {
  if (mode === 'number') {
    if (typeof from === 'number' && typeof to === 'number') return lerp(from, to, t);
    return step(from, to, t);
  }
  if (mode === 'color') {
    if (typeof from === 'string' && typeof to === 'string') {
      const blended = lerpColor(from, to, t);
      if (blended !== null) return blended;
    }
    return step(from, to, t);
  }
  return step(from, to, t);
}
