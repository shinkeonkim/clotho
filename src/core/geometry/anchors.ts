// Element centers and connector endpoint resolution.
//
// Ported from the legacy engine's phase-styles.ts (`elementCenterFromState`) and
// render-elements/arrows.tsx (`anchorOffset`, `resolveArrowCoords`), which mixed
// this geometry into React components.
//
// One behavior is new: endpoints are resolved through group transforms. Legacy
// read snapshot coordinates directly, which was correct only because its groups
// did not work and every coordinate was therefore absolute. With v1 nesting, an
// arrow anchored to an element inside a translated group has to resolve that
// endpoint in root space and then express it in its own local space.

import type { Anchor } from '../schema/primitives';
import type { AnimationElement, ArrowElement, LineElement } from '../schema/elements';
import { IDENTITY, applyToPoint, invert, type Matrix, type Point } from './matrix';

/** Live element state as produced by computeSnapshot. */
type State = Record<string, unknown>;

function num(state: State, key: string): number {
  const value = state[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * The element's center in its own coordinate space, or null for shapes that have
 * no meaningful center (connectors without resolved endpoints, groups, code).
 *
 * Kept faithful to legacy, including the quirks: `text` reports its anchor point
 * rather than a visual center (text metrics are not available here), and
 * connectors report the midpoint of their explicit coordinates only.
 */
export function elementCenter(el: AnimationElement, state: State): Point | null {
  if (el.type === 'rect' || el.type === 'image') {
    return {
      x: num(state, 'x') + num(state, 'width') / 2,
      y: num(state, 'y') + num(state, 'height') / 2,
    };
  }
  if (el.type === 'text') return { x: num(state, 'x'), y: num(state, 'y') };
  if (el.type === 'circle') return { x: num(state, 'cx'), y: num(state, 'cy') };
  if (el.type === 'line' || el.type === 'arrow') {
    const x1 = state.x1;
    const y1 = state.y1;
    const x2 = state.x2;
    const y2 = state.y2;
    if (
      typeof x1 === 'number' &&
      typeof y1 === 'number' &&
      typeof x2 === 'number' &&
      typeof y2 === 'number'
    ) {
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    }
    return null;
  }
  if (el.type === 'path') return { x: num(state, 'x'), y: num(state, 'y') };
  return null;
}

/**
 * The point on an element's edge named by `anchor`, in the element's own space.
 *
 * Anchors are only defined for box-like shapes (`rect`, `image`) and `circle`;
 * anything else — including `auto` and unsupported combinations — falls back to
 * the center, as legacy did.
 */
export function anchorPoint(el: AnimationElement, state: State, anchor: Anchor | undefined): Point {
  const center = elementCenter(el, state) ?? { x: 0, y: 0 };
  const isBox = el.type === 'rect' || el.type === 'image';
  const isCircle = el.type === 'circle';

  switch (anchor) {
    case 'top':
      if (isBox) return { x: center.x, y: num(state, 'y') };
      if (isCircle) return { x: center.x, y: num(state, 'cy') - num(state, 'r') };
      return center;
    case 'bottom':
      if (isBox) return { x: center.x, y: num(state, 'y') + num(state, 'height') };
      if (isCircle) return { x: center.x, y: num(state, 'cy') + num(state, 'r') };
      return center;
    case 'left':
      if (isBox) return { x: num(state, 'x'), y: center.y };
      if (isCircle) return { x: num(state, 'cx') - num(state, 'r'), y: center.y };
      return center;
    case 'right':
      if (isBox) return { x: num(state, 'x') + num(state, 'width'), y: center.y };
      if (isCircle) return { x: num(state, 'cx') + num(state, 'r'), y: center.y };
      return center;
    case 'top-left':
      return isBox ? { x: num(state, 'x'), y: num(state, 'y') } : center;
    case 'top-right':
      return isBox ? { x: num(state, 'x') + num(state, 'width'), y: num(state, 'y') } : center;
    case 'bottom-left':
      return isBox ? { x: num(state, 'x'), y: num(state, 'y') + num(state, 'height') } : center;
    case 'bottom-right':
      return isBox
        ? { x: num(state, 'x') + num(state, 'width'), y: num(state, 'y') + num(state, 'height') }
        : center;
    default:
      return center;
  }
}

export interface Endpoints {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface EndpointContext {
  readonly snapshot: Map<string, State>;
  readonly elementById: Map<string, AnimationElement>;
  /** Root-space matrix per element id. Omit for flat documents. */
  readonly matrices?: Map<string, Matrix>;
}

/**
 * Resolve a connector's two endpoints in the connector's own coordinate space.
 *
 * Returns null when either end cannot be determined — an anchored element that is
 * missing, or explicit coordinates that were never supplied. Legacy did the same,
 * and callers skip drawing rather than guessing a position.
 */
export function resolveEndpoints(
  connector: LineElement | ArrowElement,
  state: State,
  ctx: EndpointContext,
): Endpoints | null {
  const from = resolveEnd(
    connector.fromId,
    connector.fromAnchor,
    state,
    'x1',
    'y1',
    connector.id,
    ctx,
  );
  const to = resolveEnd(connector.toId, connector.toAnchor, state, 'x2', 'y2', connector.id, ctx);
  if (!from || !to) return null;
  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
}

function resolveEnd(
  targetId: string | undefined,
  anchor: Anchor | undefined,
  connectorState: State,
  xKey: 'x1' | 'x2',
  yKey: 'y1' | 'y2',
  connectorId: string,
  ctx: EndpointContext,
): Point | null {
  if (targetId === undefined) {
    const x = connectorState[xKey];
    const y = connectorState[yKey];
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return { x, y };
  }

  const targetState = ctx.snapshot.get(targetId);
  const targetElement = ctx.elementById.get(targetId);
  if (!targetState || !targetElement) return null;

  const local = anchorPoint(targetElement, targetState, anchor);
  return toConnectorSpace(local, targetId, connectorId, ctx);
}

/**
 * Convert a point from the target's space into the connector's space.
 *
 * Short-circuits to the identity path when no matrices are supplied or both
 * elements share the same frame, so flat documents cost nothing extra and match
 * legacy exactly.
 */
function toConnectorSpace(
  point: Point,
  targetId: string,
  connectorId: string,
  ctx: EndpointContext,
): Point {
  const matrices = ctx.matrices;
  if (!matrices) return point;

  const targetMatrix = matrices.get(targetId) ?? IDENTITY;
  const connectorMatrix = matrices.get(connectorId) ?? IDENTITY;
  if (targetMatrix === connectorMatrix) return point;

  const root = applyToPoint(targetMatrix, point);
  const inverse = invert(connectorMatrix);
  // A degenerate connector frame (zero scale) has no local space to speak of;
  // root coordinates are the least-wrong answer and keep the line on screen.
  if (!inverse) return root;
  return applyToPoint(inverse, root);
}

/**
 * Quadratic control point for a curved arrow, offset perpendicular to the chord.
 * Ported from arrows.tsx.
 */
export function curveControlPoint(ends: Endpoints, curvature: number): Point {
  const midX = (ends.x1 + ends.x2) / 2;
  const midY = (ends.y1 + ends.y2) / 2;
  const dx = ends.x2 - ends.x1;
  const dy = ends.y2 - ends.y1;
  const length = Math.hypot(dx, dy) || 1;
  return { x: midX + (-dy / length) * curvature, y: midY + (dx / length) * curvature };
}

/** Centroid of an SVG `points` list, used as the rotation origin for polygons. */
export function polygonCentroid(points: string): Point {
  const parsed = points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x: x ?? 0, y: y ?? 0 };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  if (parsed.length === 0) return { x: 0, y: 0 };
  const sum = parsed.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / parsed.length, y: sum.y / parsed.length };
}
