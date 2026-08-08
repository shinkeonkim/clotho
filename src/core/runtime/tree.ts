// Group tree resolution (docs/SCHEMA-V1.md §2.1).
//
// Entirely new: legacy declared a `group` element but never rendered one — its
// `RenderElement` had no branch for it, so groups returned null, and the
// `childIds` reference list could not have produced nested `<g>` transforms
// anyway. v1 stores a flat element array with `parentId` pointers and builds the
// tree here.
//
// Robustness stance: a broken `parentId` (missing, cyclic, or pointing at a
// non-group) must not stop the animation from rendering. Such elements are
// re-rooted and the problem is reported as an issue, which core/validate turns
// into an error for authors. A malformed document degrading to a visible-but-flat
// render beats a blank stage with the reason hidden in a console.

import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import { IDENTITY, groupMatrix, multiply, type Matrix } from '../geometry/matrix';
import type { SnapshotMap } from './snapshot';

export interface ElementNode {
  readonly element: AnimationElement;
  readonly children: ElementNode[];
  /** 0 for roots. */
  readonly depth: number;
}

export type TreeIssueCode = 'missing-parent' | 'non-group-parent' | 'parent-cycle' | 'self-parent';

export interface TreeIssue {
  readonly code: TreeIssueCode;
  readonly elementId: string;
  readonly parentId: string;
  readonly message: string;
}

export interface ElementTree {
  readonly roots: ElementNode[];
  readonly byId: Map<string, ElementNode>;
  /** Structural problems found while building. Empty for a well-formed document. */
  readonly issues: TreeIssue[];
}

/**
 * Build the parent/child tree from a flat element list.
 *
 * Sibling order follows document order, which is also paint order.
 */
export function buildElementTree(doc: AnimationDocument): ElementTree {
  const elements = doc.elements;
  const byId = new Map<string, ElementNode>();
  const issues: TreeIssue[] = [];

  const elementById = new Map<string, AnimationElement>();
  for (const el of elements) elementById.set(el.id, el);

  /** Parent each element will actually get, after rejecting broken links. */
  const effectiveParent = new Map<string, string | undefined>();

  for (const el of elements) {
    const parentId = el.parentId;
    if (parentId === undefined) {
      effectiveParent.set(el.id, undefined);
      continue;
    }
    if (parentId === el.id) {
      issues.push({
        code: 'self-parent',
        elementId: el.id,
        parentId,
        message: `element "${el.id}" is its own parent`,
      });
      effectiveParent.set(el.id, undefined);
      continue;
    }
    const parent = elementById.get(parentId);
    if (!parent) {
      issues.push({
        code: 'missing-parent',
        elementId: el.id,
        parentId,
        message: `element "${el.id}" references parent "${parentId}", which does not exist`,
      });
      effectiveParent.set(el.id, undefined);
      continue;
    }
    if (parent.type !== 'group') {
      issues.push({
        code: 'non-group-parent',
        elementId: el.id,
        parentId,
        message: `element "${el.id}" has parent "${parentId}" of type "${parent.type}"; only groups may contain children`,
      });
      effectiveParent.set(el.id, undefined);
      continue;
    }
    effectiveParent.set(el.id, parentId);
  }

  // Break cycles by re-rooting the element that closes one. Walking upward per
  // element is O(depth) and documents are shallow, so this stays cheap.
  for (const el of elements) {
    const seen = new Set<string>([el.id]);
    let cursor = effectiveParent.get(el.id);
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        issues.push({
          code: 'parent-cycle',
          elementId: el.id,
          parentId: cursor,
          message: `element "${el.id}" is part of a parent cycle through "${cursor}"`,
        });
        effectiveParent.set(el.id, undefined);
        break;
      }
      seen.add(cursor);
      cursor = effectiveParent.get(cursor);
    }
  }

  for (const el of elements) {
    byId.set(el.id, { element: el, children: [], depth: 0 });
  }

  const roots: ElementNode[] = [];
  for (const el of elements) {
    const node = byId.get(el.id)!;
    const parentId = effectiveParent.get(el.id);
    if (parentId === undefined) {
      roots.push(node);
      continue;
    }
    byId.get(parentId)!.children.push(node);
  }

  // Depth is assigned by walking down, so it reflects the repaired tree.
  const assignDepth = (node: ElementNode, depth: number): void => {
    (node as { depth: number }).depth = depth;
    for (const child of node.children) assignDepth(child, depth + 1);
  };
  for (const root of roots) assignDepth(root, 0);

  return { roots, byId, issues };
}

/** Elements in paint order: parents before their children, siblings in document order. */
export function flattenTree(tree: ElementTree): ElementNode[] {
  const out: ElementNode[] = [];
  const visit = (node: ElementNode): void => {
    out.push(node);
    for (const child of node.children) visit(child);
  };
  for (const root of tree.roots) visit(root);
  return out;
}

/**
 * Effective visibility per element, with group visibility inherited downward.
 *
 * A group that is off stage takes its whole subtree with it (S4 in
 * docs/SCHEMA-V1.md §5) — that is what makes a group one unit rather than a
 * coordinate convenience.
 */
export function resolveVisibility(tree: ElementTree, snapshot: SnapshotMap): Map<string, boolean> {
  const visible = new Map<string, boolean>();
  const visit = (node: ElementNode, parentVisible: boolean): void => {
    const own = snapshot.get(node.element.id)?.visible === true;
    const effective = parentVisible && own;
    visible.set(node.element.id, effective);
    for (const child of node.children) visit(child, effective);
  };
  for (const root of tree.roots) visit(root, true);
  return visible;
}

/**
 * Root-space transform for each element's own coordinate system, i.e. the
 * composition of every ancestor group's transform.
 *
 * A group's live `x`/`y`/`rotation` come from the snapshot, so a group animated by
 * tracks moves its children with it. The element's own rotation is not included:
 * that is applied by the renderer about the element's own center, and mixing the
 * two here would rotate children about the wrong origin.
 */
export function accumulatedMatrices(tree: ElementTree, snapshot: SnapshotMap): Map<string, Matrix> {
  const matrices = new Map<string, Matrix>();

  const visit = (node: ElementNode, parentMatrix: Matrix): void => {
    matrices.set(node.element.id, parentMatrix);
    if (node.children.length === 0) return;

    const state = snapshot.get(node.element.id);
    const x = numberOr(state?.x, 0);
    const y = numberOr(state?.y, 0);
    const rotationDegrees = numberOr(state?.rotation, 0);
    const own = groupMatrix(x, y, rotationDegrees);
    const childMatrix = multiply(parentMatrix, own);
    for (const child of node.children) visit(child, childMatrix);
  };

  for (const root of tree.roots) visit(root, IDENTITY);
  return matrices;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Ancestor ids from nearest to furthest. */
export function ancestorIds(tree: ElementTree, elementId: string): string[] {
  const out: string[] = [];
  let current = tree.byId.get(elementId)?.element.parentId;
  const guard = new Set<string>([elementId]);
  while (current !== undefined && !guard.has(current)) {
    const node = tree.byId.get(current);
    if (!node) break;
    out.push(current);
    guard.add(current);
    current = node.element.parentId;
  }
  return out;
}
