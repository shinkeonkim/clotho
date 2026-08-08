// Arrow head marker definitions.
//
// Ported from the legacy engine's markers.ts, which stored them as one HTML string
// and injected it with `dangerouslySetInnerHTML`. As data they serialize the same
// way as the rest of the scene, which is what lets the svg-string and DOM adapters
// exist at all (TASKS 2.5).
//
// Two changes:
//   - id prefix `anim-h-` → `cloth-h-` (N3)
//   - only the markers a frame actually references are emitted, instead of all
//     thirteen on every stage
//
// Markers carry their color directly rather than inheriting it.
//
// Legacy filled them with `currentColor` and set CSS `color` on the connector's `<g>`,
// which does not work: `currentColor` inside a `<marker>` resolves against the marker's
// own ancestors (`<defs>` → `<svg>`), not against the element referencing it. Every
// arrowhead therefore rendered in the page's default text color instead of its line's —
// verified in Chrome on a real page, where a `#94a3b8` arrow drew a near-black head.
//
// It fails the same way in the svg-string adapter, where a standalone file has no
// inherited color at all. So the color is baked into the marker and its id, and
// connectors of different colors get different markers.

import type { ArrowHead } from '../schema/primitives';
import { compactAttrs, type SceneDef, type SceneNode } from './nodes';

/** Prefix for marker element ids. */
export const MARKER_ID_PREFIX = 'cloth-h';

interface MarkerSpec {
  readonly refX: number;
  readonly width: number;
  readonly height: number;
  /** Whether a `-start` variant exists (heads that point along the path). */
  readonly directional: boolean;
  readonly children: readonly ShapeBuilder[];
}

type ShapeBuilder = (color: string) => SceneNode;

function path(d: string, filled: boolean): ShapeBuilder {
  return (color) => ({
    kind: 'path',
    key: 'shape',
    attrs: compactAttrs(
      filled ? { d, fill: color } : { d, fill: 'none', stroke: color, 'stroke-width': 1.5 },
    ),
  });
}

const TRIANGLE_FILLED = 'M 0 0 L 10 5 L 0 10 z';
const TRIANGLE_OPEN = 'M 0 0 L 10 5 L 0 10';
const DIAMOND = 'M 0 5 L 5 0 L 10 5 L 5 10 z';

const SPECS: Record<Exclude<ArrowHead, 'none'>, MarkerSpec> = {
  arrow: {
    refX: 9,
    width: 7,
    height: 7,
    directional: true,
    children: [path(TRIANGLE_FILLED, true)],
  },
  triangle: {
    refX: 9,
    width: 7,
    height: 7,
    directional: true,
    children: [path(TRIANGLE_FILLED, true)],
  },
  'triangle-open': {
    refX: 9,
    width: 9,
    height: 9,
    directional: true,
    children: [path(TRIANGLE_OPEN, false)],
  },
  circle: {
    refX: 5,
    width: 6,
    height: 6,
    directional: false,
    children: [
      (color) => ({
        kind: 'circle',
        key: 'shape',
        attrs: compactAttrs({ cx: 5, cy: 5, r: 4, fill: color }),
      }),
    ],
  },
  'circle-open': {
    refX: 5,
    width: 7,
    height: 7,
    directional: false,
    children: [
      (color) => ({
        kind: 'circle',
        key: 'shape',
        // Legacy fills this white rather than with a theme token; keeping it means an
        // open circle head stays readable on a dark stage, where `transparent` would let
        // the line show through the middle.
        attrs: compactAttrs({
          cx: 5,
          cy: 5,
          r: 4,
          fill: 'white',
          stroke: color,
          'stroke-width': 1.5,
        }),
      }),
    ],
  },
  diamond: { refX: 9, width: 8, height: 8, directional: true, children: [path(DIAMOND, true)] },
  'diamond-open': {
    refX: 9,
    width: 8,
    height: 8,
    directional: true,
    children: [
      (color) => ({
        kind: 'path',
        key: 'shape',
        attrs: compactAttrs({ d: DIAMOND, fill: 'white', stroke: color, 'stroke-width': 1.5 }),
      }),
    ],
  },
  bar: {
    refX: 5,
    width: 5,
    height: 10,
    directional: true,
    children: [
      (color) => ({
        kind: 'rect',
        key: 'shape',
        attrs: compactAttrs({ x: 4, y: 0, width: 2, height: 10, fill: color }),
      }),
    ],
  },
};

export type MarkerEnd = 'start' | 'end';

/** Fallback when a connector has no stroke of its own. */
export const DEFAULT_MARKER_COLOR = '#6366f1';

/**
 * Turn a color into something usable inside an element id.
 *
 * Colors reach here as authored: `#6366f1`, `rgb(1,2,3)`, `var(--brand)`. Only
 * `[A-Za-z0-9-]` survives, which keeps ids valid without needing to parse color syntax.
 */
function colorToken(color: string): string {
  const token = color
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || 'default';
}

/** Marker element id for a head, or undefined when nothing should be drawn. */
export function markerId(
  head: ArrowHead | undefined,
  end: MarkerEnd,
  color: string = DEFAULT_MARKER_COLOR,
): string | undefined {
  if (!head || head === 'none') return undefined;
  const spec = SPECS[head];
  if (!spec) return undefined;
  const suffix = colorToken(color);
  if (!spec.directional) return `${MARKER_ID_PREFIX}-${head}-${suffix}`;
  return end === 'start'
    ? `${MARKER_ID_PREFIX}-${head}-start-${suffix}`
    : `${MARKER_ID_PREFIX}-${head}-${suffix}`;
}

/** `url(#…)` reference for a `marker-start` / `marker-end` attribute. */
export function markerUrl(
  head: ArrowHead | undefined,
  end: MarkerEnd,
  color?: string,
): string | undefined {
  const id = markerId(head, end, color);
  return id === undefined ? undefined : `url(#${id})`;
}

function buildDef(head: Exclude<ArrowHead, 'none'>, end: MarkerEnd, color: string): SceneDef {
  const spec = SPECS[head];
  const isStart = spec.directional && end === 'start';
  const id = markerId(head, end, color)!;
  return {
    key: id,
    kind: 'marker',
    attrs: compactAttrs({
      id,
      viewBox: '0 0 10 10',
      refX: isStart ? 1 : spec.refX,
      refY: 5,
      markerWidth: spec.width,
      markerHeight: spec.height,
      // Non-directional heads (circles) must not rotate with the path.
      orient: spec.directional ? (isStart ? 'auto-start-reverse' : 'auto') : undefined,
    }),
    children: spec.children.map((build) => build(color)),
  };
}

/**
 * Marker definitions for the heads a frame actually uses.
 *
 * Emitting only what is referenced keeps the DOM small when a page holds several
 * stages, and means a document with no arrows produces no `<defs>` at all.
 */
export interface MarkerUse {
  readonly head: ArrowHead | undefined;
  readonly end: MarkerEnd;
  /** The connector's stroke. Different colors produce different markers. */
  readonly color?: string;
}

export function collectMarkerDefs(used: Iterable<MarkerUse>): SceneDef[] {
  const byId = new Map<string, SceneDef>();
  for (const { head, end, color } of used) {
    if (!head || head === 'none' || !SPECS[head]) continue;
    const def = buildDef(head, end, color ?? DEFAULT_MARKER_COLOR);
    if (!byId.has(def.key)) byId.set(def.key, def);
  }
  return [...byId.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Every marker definition, for hosts that would rather emit one shared `<defs>`. */
export function allMarkerDefs(color: string = DEFAULT_MARKER_COLOR): SceneDef[] {
  const heads = Object.keys(SPECS) as Exclude<ArrowHead, 'none'>[];
  return collectMarkerDefs(
    heads.flatMap((head) => [
      { head, end: 'start' as MarkerEnd, color },
      { head, end: 'end' as MarkerEnd, color },
    ]),
  );
}
