// Element bounds in root canvas space.
//
// core/geometry/bounds answers "how big is this element in its own coordinates".
// This module answers "where is it on the canvas", which needs three things the
// geometry layer does not have: the snapshot (live values), the element tree
// (group nesting and children), and the accumulated matrices (ancestor
// transforms). The camera is the first caller; spotlight masks and chart layout
// will be the next.

import type { AnimationElement, ArrowElement, LineElement } from '../schema/elements';
import {
  boundsOfPoints,
  elementLocalBounds,
  transformBounds,
  unionBounds,
  type Bounds,
  type BoundsOptions,
} from '../geometry/bounds';
import { elementCenter, resolveEndpoints } from '../geometry/anchors';
import { applyToPoint, rotation, type Matrix, type Point } from '../geometry/matrix';
import type { SnapshotMap } from './snapshot';
import type { ElementTree } from './tree';

export interface BoundsContext {
  readonly snapshot: SnapshotMap;
  readonly tree: ElementTree;
  readonly elementById: Map<string, AnimationElement>;
  /** Root-space transform per element, from `accumulatedMatrices`. */
  readonly matrices: Map<string, Matrix>;
  readonly options?: BoundsOptions;
}

/**
 * Rotate a box about a point and take the axis-aligned box around the result.
 *
 * `accumulatedMatrices` deliberately leaves an element's own rotation out, since
 * the renderer applies it about the element's center. Bounds want the drawn area,
 * so the rotation goes back in here.
 */
function rotateBounds(box: Bounds, degrees: number, about: Point): Bounds {
  if (degrees === 0) return box;
  const m = rotation(degrees, about.x, about.y);
  const corners: Point[] = [
    applyToPoint(m, { x: box.x, y: box.y }),
    applyToPoint(m, { x: box.x + box.width, y: box.y }),
    applyToPoint(m, { x: box.x, y: box.y + box.height }),
    applyToPoint(m, { x: box.x + box.width, y: box.y + box.height }),
  ];
  return boundsOfPoints(corners, box.approximate) ?? box;
}

/** Local bounds including anchored connector endpoints, which need the snapshot. */
function localBounds(el: AnimationElement, ctx: BoundsContext): Bounds | null {
  const state = ctx.snapshot.get(el.id);
  if (!state) return null;

  if (el.type === 'line' || el.type === 'arrow') {
    const endpoints = resolveEndpoints(el as LineElement | ArrowElement, state, {
      snapshot: ctx.snapshot,
      elementById: ctx.elementById,
      matrices: ctx.matrices,
    });
    if (!endpoints) return null;
    return boundsOfPoints([
      { x: endpoints.x1, y: endpoints.y1 },
      { x: endpoints.x2, y: endpoints.y2 },
    ]);
  }

  return elementLocalBounds(el, state, ctx.options);
}

/**
 * An element's box in root canvas space, or null when it has no determinable
 * extent — a connector with unresolved endpoints, an empty group, or an element
 * missing from the document.
 *
 * A group reports the union of its subtree. That is what makes
 * `focus: { elementIds: ["stage-2"] }` work on a group id.
 */
export function elementRootBounds(elementId: string, ctx: BoundsContext): Bounds | null {
  const node = ctx.tree.byId.get(elementId);
  if (!node) return null;
  const el = node.element;
  const state = ctx.snapshot.get(el.id);
  const matrix = ctx.matrices.get(el.id);
  if (!state || !matrix) return null;

  const own = localBounds(el, ctx);
  const rotationDegrees = typeof state.rotation === 'number' ? state.rotation : 0;
  const center = elementCenter(el, state);
  const rotated = own && center ? rotateBounds(own, rotationDegrees, center) : own;
  const ownRoot = rotated ? transformBounds(rotated, matrix) : null;

  if (node.children.length === 0) return ownRoot;

  const childBoxes = node.children.map((child) => elementRootBounds(child.element.id, ctx));
  return unionBounds([ownRoot, ...childBoxes]);
}

export interface MultiBounds {
  readonly bounds: Bounds | null;
  /** Ids that contributed nothing: absent, invisible, or without determinable extent. */
  readonly unresolved: readonly string[];
}

/**
 * The union of several elements' boxes, reporting which ids contributed nothing.
 *
 * Invisible elements are skipped rather than framed. Framing an element that is
 * not on stage would point the camera at empty canvas, and the caller needs to
 * know that happened — hence `unresolved` instead of a silent null.
 */
export function elementsRootBounds(
  elementIds: readonly string[],
  ctx: BoundsContext,
  visibility?: Map<string, boolean>,
): MultiBounds {
  const boxes: (Bounds | null)[] = [];
  const unresolved: string[] = [];

  for (const id of elementIds) {
    if (visibility && visibility.get(id) !== true) {
      unresolved.push(id);
      continue;
    }
    const box = elementRootBounds(id, ctx);
    if (box === null) {
      unresolved.push(id);
      continue;
    }
    boxes.push(box);
  }

  return { bounds: unionBounds(boxes), unresolved };
}
