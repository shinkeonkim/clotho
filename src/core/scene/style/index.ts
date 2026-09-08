// Render styles as a scene transform.
//
// This runs after `buildScene` has produced the node tree and before any adapter
// touches it, which is the only place it could sensibly live. Three things follow
// from that position:
//
//   - The eleven element builders are untouched. A preset is a rule about drawing,
//     not about what a circle is.
//   - All four adapters and the GIF renderer inherit it for free.
//   - A transform may change a node's *kind* — a `rect` becomes a wobbling `path` —
//     because nothing downstream cares, so long as the `key` survives for the DOM
//     patcher and React's reconciler to match on.
//
// Every transform here is pure and total. A preset that cannot express something
// leaves it alone rather than guessing.

import type { RenderStyle } from '../../schema/style';
import { parseColor, rgbaToHex } from '../../runtime/color';
import { compactAttrs, roundAttrNumber, type SceneDef, type SceneNode } from '../nodes';
import { jitterSource } from './random';

export * from './random';

/**
 * Above this many nodes the sketch preset stops.
 *
 * Jitter turns one rect into a path with eight points, so a large scene pays for it
 * twice: in nodes to diff and in path data to serialize. A drawing this dense is
 * also one where hand-drawn strokes stop reading as charm and start reading as
 * noise, so degrading to `clean` is the right answer on both counts.
 */
export const SKETCH_NODE_LIMIT = 400;

/** Nodes the presets must not touch, matched by key prefix. */
const PROTECTED_PREFIXES = ['cloth-spot'];

function isProtected(node: SceneNode): boolean {
  // The spotlight scrim covers the whole visible area; a wobbling edge would leave
  // a bright seam around the stage. Masks have the same problem in reverse.
  return PROTECTED_PREFIXES.some((prefix) => node.key.startsWith(prefix));
}

function countNodes(nodes: readonly SceneNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    if (node.kind === 'g') total += countNodes(node.children);
  }
  return total;
}

/**
 * Apply a preset to a node tree.
 *
 * `clean`, an absent style and an over-budget scene all return the input unchanged,
 * so the common path costs one comparison.
 */
export function applyRenderStyle(
  nodes: readonly SceneNode[],
  style: RenderStyle | undefined,
  seed: string,
): readonly SceneNode[] {
  if (!style || style.preset === 'clean') return nodes;
  if (style.preset === 'sketch') {
    if (style.roughness <= 0 || countNodes(nodes) > SKETCH_NODE_LIMIT) return nodes;
    return nodes.map((node) => sketchNode(node, style.roughness, style.seed ?? seed));
  }
  return nodes.map((node) => monoNode(node));
}

export interface StyledDefs {
  readonly defs: readonly SceneDef[];
  /** Old marker id → new marker id, for the references in the node tree. */
  readonly renamedMarkers: ReadonlyMap<string, string>;
}

/**
 * Apply a preset to the `<defs>` block.
 *
 * Only `mono` needs this, and it needs it badly: arrowheads are markers, markers
 * live in defs, and a greyscale figure with a blue arrowhead has failed at the one
 * thing the preset exists for. Sketch deliberately does not touch defs — jittering a
 * six-pixel arrowhead makes it a smudge, and a mask's contents have to stay exact.
 *
 * The rename is not cosmetic. Marker ids are document-global — `cloth-h-arrow-6366f1`
 * is the same string in every player on a page — which was harmless only because the
 * colour is baked into the id, so two markers sharing an id had identical contents.
 * A preset breaks that: a greyed marker and a coloured one would claim the same id,
 * and `url(#…)` resolves to whichever came first in the page. Two players side by
 * side, one styled and one not, would both draw whichever arrowhead loaded first.
 */
export function applyRenderStyleToDefs(
  defs: readonly SceneDef[],
  style: RenderStyle | undefined,
): StyledDefs {
  if (!style || style.preset !== 'mono') return { defs, renamedMarkers: new Map() };

  const renamedMarkers = new Map<string, string>();
  const styled = defs.map((def) => {
    if (def.kind !== 'marker') return def;
    const id = def.attrs.id;
    if (typeof id !== 'string') return { ...def, children: def.children.map(monoNode) };
    const renamed = `${id}-${style.preset}`;
    renamedMarkers.set(id, renamed);
    return {
      ...def,
      key: renamed,
      attrs: { ...def.attrs, id: renamed },
      children: def.children.map(monoNode),
    };
  });

  return { defs: styled, renamedMarkers };
}

const MARKER_ATTRS = ['marker-start', 'marker-end', 'marker-mid'] as const;

/** Point every `url(#…)` marker reference at its renamed definition. */
export function retargetMarkers(
  nodes: readonly SceneNode[],
  renames: ReadonlyMap<string, string>,
): readonly SceneNode[] {
  if (renames.size === 0) return nodes;

  const rewrite = (node: SceneNode): SceneNode => {
    const attrs = { ...node.attrs };
    let touched = false;
    for (const key of MARKER_ATTRS) {
      const value = attrs[key];
      if (typeof value !== 'string') continue;
      const match = /^url\(#(.+)\)$/.exec(value);
      const renamed = match ? renames.get(match[1]!) : undefined;
      if (!renamed) continue;
      attrs[key] = `url(#${renamed})`;
      touched = true;
    }
    if (node.kind === 'g') {
      return { ...node, attrs: touched ? attrs : node.attrs, children: node.children.map(rewrite) };
    }
    return touched ? { ...node, attrs } : node;
  };

  return nodes.map(rewrite);
}

// ---------------------------------------------------------------------------
// sketch

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A path through the points, closed if asked, with each point nudged. */
function wobblePath(
  points: readonly (readonly [number, number])[],
  jitter: () => number,
  close: boolean,
): string {
  const parts = points.map(([x, y], i) => {
    const px = roundAttrNumber(x + jitter());
    const py = roundAttrNumber(y + jitter());
    return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
  });
  if (close && points.length > 0) {
    // Overshoot the closing corner slightly rather than joining exactly, which is
    // what a pen does and what makes the shape read as drawn rather than plotted.
    const [x, y] = points[0]!;
    parts.push(`L ${roundAttrNumber(x + jitter())} ${roundAttrNumber(y + jitter())}`);
  }
  return parts.join(' ');
}

/**
 * Points around an ellipse, dense enough that the wobble reads as a curve.
 *
 * The count scales with size rather than being fixed: twenty points around a small
 * dot is more than enough, while the same twenty around a large circle leaves
 * straight sides long enough to read as a polygon.
 */
export function ellipseSteps(radius: number): number {
  return Math.min(48, Math.max(14, Math.round(radius * 0.9)));
}

function ellipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  steps = ellipseSteps(Math.max(rx, ry)),
): (readonly [number, number])[] {
  return Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2;
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry] as const;
  });
}

function parsePoints(value: unknown): (readonly [number, number])[] {
  if (typeof value !== 'string') return [];
  const numbers = value.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  const points: (readonly [number, number])[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push([numbers[i]!, numbers[i + 1]!] as const);
  }
  return points;
}

/**
 * Rewrite one node in the sketch style.
 *
 * `rect`, `circle` and `polygon` become paths, because a wobbling outline cannot be
 * expressed by those elements at all. `line` stays a line and only moves its
 * endpoints. `path`, `text` and `image` are left alone: re-drawing arbitrary path
 * data would need a full parser, and jittering a glyph makes it unreadable rather
 * than informal.
 */
function sketchNode(node: SceneNode, roughness: number, seed: string): SceneNode {
  if (node.kind === 'g') {
    return { ...node, children: node.children.map((child) => sketchNode(child, roughness, seed)) };
  }
  if (isProtected(node)) return node;

  const jitter = jitterSource(roughness, seed, node.key, node.kind);
  const attrs = node.attrs;

  if (node.kind === 'rect') {
    const x = num(attrs.x);
    const y = num(attrs.y);
    const width = num(attrs.width);
    const height = num(attrs.height);
    if (width <= 0 || height <= 0) return node;
    const { x: _x, y: _y, width: _w, height: _h, rx: _rx, ry: _ry, ...rest } = attrs;
    return {
      kind: 'path',
      key: node.key,
      style: node.style,
      attrs: compactAttrs({
        ...rest,
        d: wobblePath(
          [
            [x, y],
            [x + width, y],
            [x + width, y + height],
            [x, y + height],
          ],
          jitter,
          true,
        ),
      }),
    };
  }

  if (node.kind === 'circle') {
    const r = num(attrs.r);
    if (r <= 0) return node;
    const { cx: _cx, cy: _cy, r: _r, ...rest } = attrs;
    return {
      kind: 'path',
      key: node.key,
      style: node.style,
      attrs: compactAttrs({
        ...rest,
        d: wobblePath(ellipsePoints(num(attrs.cx), num(attrs.cy), r, r), jitter, true),
      }),
    };
  }

  if (node.kind === 'polygon') {
    const points = parsePoints(attrs.points);
    if (points.length === 0) return node;
    const { points: _points, ...rest } = attrs;
    return {
      kind: 'path',
      key: node.key,
      style: node.style,
      attrs: compactAttrs({ ...rest, d: wobblePath(points, jitter, true) }),
    };
  }

  if (node.kind === 'line') {
    return {
      ...node,
      attrs: compactAttrs({
        ...attrs,
        x1: roundAttrNumber(num(attrs.x1) + jitter()),
        y1: roundAttrNumber(num(attrs.y1) + jitter()),
        x2: roundAttrNumber(num(attrs.x2) + jitter()),
        y2: roundAttrNumber(num(attrs.y2) + jitter()),
      }),
    };
  }

  return node;
}

// ---------------------------------------------------------------------------
// mono

/** Rec. 709 luma, which is what "how light is this" means to an eye. */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Greyscale a colour, leaving anything that is not a literal colour alone.
 *
 * Theme tokens (`var(--cloth-fg)`) pass through untouched: their value is decided by
 * the page, so there is nothing here to convert, and they are already monochrome in
 * the sense that matters. `none` and `transparent` likewise.
 */
function monoColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const rgba = parseColor(value);
  if (!rgba) return undefined;
  const [r, g, b, a] = rgba;
  const grey = Math.round(luminance(r, g, b));
  return rgbaToHex(grey, grey, grey, a);
}

const COLOR_ATTRS = ['fill', 'stroke', 'color', 'stop-color'] as const;

function monoNode(node: SceneNode): SceneNode {
  if (isProtected(node)) {
    return node.kind === 'g' ? { ...node, children: node.children.map(monoNode) } : node;
  }

  const attrs = { ...node.attrs };
  for (const key of COLOR_ATTRS) {
    const converted = monoColor(attrs[key]);
    if (converted !== undefined) attrs[key] = converted;
  }

  if (node.kind === 'g') {
    return { ...node, attrs, children: node.children.map(monoNode) };
  }
  return { ...node, attrs };
}
