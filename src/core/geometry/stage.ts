// Stage sizing. Ported from oh-my-blog's stage-geometry.ts.
//
// Aspect ratio belongs to the animation canvas, not to the viewport or theme, so
// this stays free of any environment awareness. Adapters apply `aspectRatioStyle`
// to the `<svg>` itself; whether a narrow screen should surface a rotate hint is
// decided in CSS media queries, with `isWideAspect` only saying whether the
// content is landscape enough to warrant one.

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Content wider than this (w/h) counts as landscape for hint purposes. */
export const WIDE_ASPECT_THRESHOLD = 1.5;

/** width / height, guarded to 0 for degenerate dimensions — never Infinity or NaN. */
export function aspectRatio(size: Size): number {
  if (size.width <= 0 || size.height <= 0) return 0;
  return size.width / size.height;
}

export function isWideAspect(size: Size, threshold: number = WIDE_ASPECT_THRESHOLD): boolean {
  const ratio = aspectRatio(size);
  return ratio > 0 && ratio >= threshold;
}

/** A CSS `aspect-ratio` value like `"800 / 500"`, falling back to 16/9. */
export function aspectRatioStyle(size: Size): string {
  if (size.width <= 0 || size.height <= 0) return '16 / 9';
  return `${size.width} / ${size.height}`;
}

/** `viewBox` for a canvas of this size. */
export function viewBox(size: Size): string {
  return `0 0 ${size.width} ${size.height}`;
}

export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * `viewBox` for an arbitrary rectangle, as the camera produces.
 *
 * Numbers are trimmed to six decimals for the same reason scene attributes are:
 * without it React and the DOM adapter would emit the raw float where the string
 * serializer emits a rounded one, and the adapters would stop agreeing byte for
 * byte.
 */
export function viewBoxFromRect(rect: ViewRect): string {
  return [rect.x, rect.y, rect.width, rect.height].map(formatViewBoxNumber).join(' ');
}

function formatViewBoxNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n === 0 ? 0 : n);
  const rounded = Number(n.toFixed(6));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
