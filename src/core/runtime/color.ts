// Hex color parsing for keyframe interpolation. Ported verbatim in behavior from
// the legacy engine's schema/runtime.ts.
//
// Only hex forms are understood. Named colors, rgb()/hsl() functions, and CSS
// variables all fail to parse — and that is deliberate rather than a gap: when
// parsing fails the interpolator steps between the authored strings instead, so
// `var(--brand)` keeps working as a discrete value rather than being mangled into
// a numeric blend. Widening this would change how existing documents render.

import { lerp } from '../timing/ease';

/** Red, green, blue, alpha — each 0..255. */
export type Rgba = readonly [number, number, number, number];

const HEX_3 = /^#([0-9a-f]{3})$/i;
const HEX_6 = /^#([0-9a-f]{6})$/i;
const HEX_8 = /^#([0-9a-f]{8})$/i;

/** Parse `#rgb`, `#rrggbb`, or `#rrggbbaa`. Returns null for anything else. */
export function parseColor(value: string): Rgba | null {
  if (!value) return null;

  const six = HEX_6.exec(value);
  if (six) {
    const n = parseInt(six[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }

  const eight = HEX_8.exec(value);
  if (eight) {
    const n = parseInt(eight[1]!, 16);
    return [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const three = HEX_3.exec(value);
  if (three) {
    const digits = three[1]!;
    const r = parseInt(digits[0]! + digits[0]!, 16);
    const g = parseInt(digits[1]! + digits[1]!, 16);
    const b = parseInt(digits[2]! + digits[2]!, 16);
    return [r, g, b, 255];
  }

  return null;
}

function channel(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, '0');
}

/** Serialize to `#rrggbb`, or `#rrggbbaa` when not fully opaque. */
export function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const base = `#${channel(r)}${channel(g)}${channel(b)}`;
  return a >= 255 ? base : `${base}${channel(a)}`;
}

/**
 * Blend two colors channel-wise. Returns null when either side is unparseable,
 * leaving the caller to fall back to stepping.
 */
export function lerpColor(from: string, to: string, t: number): string | null {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return null;
  return rgbaToHex(
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
    lerp(a[3], b[3], t),
  );
}
