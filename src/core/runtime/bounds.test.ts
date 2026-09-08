// Root-space bounds: group nesting, connector resolution, own rotation.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import { computeSnapshot } from './snapshot';
import { accumulatedMatrices, buildElementTree, resolveVisibility } from './tree';
import { elementRootBounds, elementsRootBounds, type BoundsContext } from './bounds';

const ALWAYS = [{ start: 0, end: 10_000, entryDuration: 0, exitDuration: 0 }];

function doc(elements: Record<string, unknown>[]): AnimationDocument {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'a',
    duration: 10_000,
    elements: elements.map((el) => ({ appearances: ALWAYS, ...el })),
  });
}

function contextAt(animation: AnimationDocument, time = 0) {
  const snapshot = computeSnapshot(animation, time);
  const tree = buildElementTree(animation);
  const ctx: BoundsContext = {
    snapshot,
    tree,
    elementById: new Map(animation.elements.map((el) => [el.id, el])),
    matrices: accumulatedMatrices(tree, snapshot),
  };
  return { ctx, visibility: resolveVisibility(tree, snapshot) };
}

describe('elementRootBounds', () => {
  it('returns the local box for a root element', () => {
    const { ctx } = contextAt(
      doc([{ type: 'rect', id: 'r', x: 10, y: 10, width: 20, height: 20 }]),
    );
    expect(elementRootBounds('r', ctx)).toMatchObject({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('returns null for an element that is not in the animation', () => {
    const { ctx } = contextAt(doc([{ type: 'rect', id: 'r', x: 0, y: 0, width: 1, height: 1 }]));
    expect(elementRootBounds('nope', ctx)).toBeNull();
  });

  it('carries a child through its group transform', () => {
    const { ctx } = contextAt(
      doc([
        { type: 'group', id: 'g', x: 100, y: 50 },
        { type: 'rect', id: 'r', parentId: 'g', x: 10, y: 10, width: 20, height: 20 },
      ]),
    );
    expect(elementRootBounds('r', ctx)).toMatchObject({ x: 110, y: 60, width: 20, height: 20 });
  });

  it('composes nested group transforms', () => {
    const { ctx } = contextAt(
      doc([
        { type: 'group', id: 'outer', x: 100, y: 0 },
        { type: 'group', id: 'inner', parentId: 'outer', x: 10, y: 5 },
        { type: 'rect', id: 'r', parentId: 'inner', x: 0, y: 0, width: 4, height: 4 },
      ]),
    );
    expect(elementRootBounds('r', ctx)).toMatchObject({ x: 110, y: 5, width: 4, height: 4 });
  });

  it('reports a group as the union of its subtree', () => {
    const { ctx } = contextAt(
      doc([
        { type: 'group', id: 'g', x: 0, y: 0 },
        { type: 'rect', id: 'a', parentId: 'g', x: 0, y: 0, width: 10, height: 10 },
        { type: 'rect', id: 'b', parentId: 'g', x: 90, y: 40, width: 10, height: 10 },
      ]),
    );
    expect(elementRootBounds('g', ctx)).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('grows the box of a rotated element to the area it actually occupies', () => {
    const { ctx } = contextAt(
      doc([{ type: 'rect', id: 'r', x: 0, y: 0, width: 20, height: 10, rotation: 90 }]),
    );
    const box = elementRootBounds('r', ctx)!;
    expect(box.width).toBeCloseTo(10, 6);
    expect(box.height).toBeCloseTo(20, 6);
    // Rotation is about the element's own center, which does not move.
    expect(box.x + box.width / 2).toBeCloseTo(10, 6);
    expect(box.y + box.height / 2).toBeCloseTo(5, 6);
  });

  it('resolves an anchored connector into a real box', () => {
    const { ctx } = contextAt(
      doc([
        { type: 'circle', id: 'a', cx: 20, cy: 20, r: 5 },
        { type: 'circle', id: 'b', cx: 80, cy: 60, r: 5 },
        {
          type: 'arrow',
          id: 'edge',
          fromId: 'a',
          toId: 'b',
          fromAnchor: 'center',
          toAnchor: 'center',
        },
      ]),
    );
    expect(elementRootBounds('edge', ctx)).toMatchObject({ x: 20, y: 20, width: 60, height: 40 });
  });

  it('follows a tracked position', () => {
    const animation = doc([
      {
        type: 'rect',
        id: 'r',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        tracks: [
          {
            property: 'x',
            keyframes: [
              { time: 0, value: 0 },
              { time: 1000, value: 100 },
            ],
          },
        ],
      },
    ]);
    expect(elementRootBounds('r', contextAt(animation, 1000).ctx)).toMatchObject({ x: 100 });
  });
});

describe('elementsRootBounds', () => {
  const animation = doc([
    { type: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 },
    { type: 'rect', id: 'b', x: 90, y: 40, width: 10, height: 10 },
    {
      type: 'rect',
      id: 'later',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      appearances: [{ start: 5000, end: 9000 }],
    },
  ]);

  it('unions several elements', () => {
    const { ctx, visibility } = contextAt(animation);
    const result = elementsRootBounds(['a', 'b'], ctx, visibility);
    expect(result.bounds).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
    expect(result.unresolved).toEqual([]);
  });

  it('skips elements that are not on stage and names them', () => {
    const { ctx, visibility } = contextAt(animation, 0);
    const result = elementsRootBounds(['a', 'later'], ctx, visibility);
    expect(result.bounds).toMatchObject({ x: 0, y: 0, width: 10, height: 10 });
    expect(result.unresolved).toEqual(['later']);
  });

  it('reports a null box when nothing resolves', () => {
    const { ctx, visibility } = contextAt(animation, 0);
    const result = elementsRootBounds(['later', 'missing'], ctx, visibility);
    expect(result.bounds).toBeNull();
    expect(result.unresolved).toEqual(['later', 'missing']);
  });
});
