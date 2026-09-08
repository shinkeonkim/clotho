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
import {
  applyToPoint,
  groupMatrix,
  IDENTITY,
  multiply,
  rotation,
  type Matrix,
  type Point,
} from '../geometry/matrix';
import { elementStateAt, type SnapshotMap } from './snapshot';
import type { ElementNode, ElementTree } from './tree';

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

/**
 * The group chain above an element, outermost first.
 *
 * Walked through the tree rather than through `parentId`, because the tree is what
 * the renderer uses: an element whose parent is missing or circular is re-rooted by
 * `buildElementTree`, and following its raw `parentId` here would apply a transform
 * that never reaches the screen.
 */
export function ancestorChain(tree: ElementTree, elementId: string): AnimationElement[] {
  const found: AnimationElement[] = [];
  const walk = (node: ElementNode, path: AnimationElement[]): boolean => {
    if (node.element.id === elementId) {
      found.push(...path);
      return true;
    }
    const next = [...path, node.element];
    return node.children.some((child) => walk(child, next));
  };
  for (const root of tree.roots) if (walk(root, [])) break;
  return found;
}

/**
 * An element's center in root canvas space at an arbitrary time.
 *
 * Unlike `elementRootBounds`, this evaluates the document itself rather than taking
 * a prepared context, because its callers ask about times other than the one being
 * rendered — a motion trail wants where the element *was*. Only the element and its
 * ancestor groups are evaluated, so sampling twelve past instants costs twelve
 * evaluations of a short chain rather than twelve full snapshots.
 *
 * Returns null when the element is missing, has no meaningful center (a group, a
 * connector without resolved endpoints), or was not on stage at that time —
 * including because an ancestor group was off stage, since a group takes its whole
 * subtree with it.
 */
export function elementRootCenterAt(
  tree: ElementTree,
  elementId: string,
  time: number,
  chain?: readonly AnimationElement[],
): Point | null {
  const node = tree.byId.get(elementId);
  if (!node) return null;

  const state = elementStateAt(node.element, time);
  if (state.visible !== true) return null;

  const center = elementCenter(node.element, state);
  if (!center) return null;

  // Compose the ancestor chain outward, mirroring accumulatedMatrices along one path.
  let matrix: Matrix = IDENTITY;
  for (const ancestor of chain ?? ancestorChain(tree, elementId)) {
    const ancestorState = elementStateAt(ancestor, time);
    if (ancestorState.visible !== true) return null;
    const x = typeof ancestorState.x === 'number' ? ancestorState.x : 0;
    const y = typeof ancestorState.y === 'number' ? ancestorState.y : 0;
    const degrees = typeof ancestorState.rotation === 'number' ? ancestorState.rotation : 0;
    matrix = multiply(matrix, groupMatrix(x, y, degrees));
  }

  return applyToPoint(matrix, center);
}
