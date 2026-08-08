// Group tree tests. All new behavior — legacy never rendered a group.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import {
  accumulatedMatrices,
  ancestorIds,
  buildElementTree,
  flattenTree,
  resolveVisibility,
} from './tree';
import { computeSnapshot } from './snapshot';
import { applyToPoint, isIdentity } from '../geometry/matrix';

const ALWAYS = [{ start: 0, end: 10_000, entryDuration: 0, exitDuration: 0 }];

function doc(elements: Record<string, unknown>[]) {
  return animationDocumentSchema.parse({ clothoVersion: 1, id: 'a', duration: 10_000, elements });
}

function rect(over: Record<string, unknown> = {}) {
  return { type: 'rect', x: 0, y: 0, width: 10, height: 10, appearances: ALWAYS, ...over };
}

describe('buildElementTree', () => {
  it('roots every element when no parentId is used', () => {
    const tree = buildElementTree(doc([rect({ id: 'a' }), rect({ id: 'b' })]));
    expect(tree.roots).toHaveLength(2);
    expect(tree.issues).toEqual([]);
    expect(tree.byId.get('a')?.depth).toBe(0);
  });

  it('nests children under their group in document order', () => {
    const tree = buildElementTree(
      doc([
        { type: 'group', id: 'g', appearances: ALWAYS },
        rect({ id: 'first', parentId: 'g' }),
        rect({ id: 'second', parentId: 'g' }),
      ]),
    );
    expect(tree.roots.map((n) => n.element.id)).toEqual(['g']);
    expect(tree.byId.get('g')!.children.map((n) => n.element.id)).toEqual(['first', 'second']);
    expect(tree.byId.get('first')?.depth).toBe(1);
  });

  it('supports groups nested in groups', () => {
    const tree = buildElementTree(
      doc([
        { type: 'group', id: 'outer' },
        { type: 'group', id: 'inner', parentId: 'outer' },
        rect({ id: 'leaf', parentId: 'inner' }),
      ]),
    );
    expect(tree.byId.get('leaf')?.depth).toBe(2);
    expect(ancestorIds(tree, 'leaf')).toEqual(['inner', 'outer']);
    expect(tree.issues).toEqual([]);
  });

  it('accepts a child declared before its parent', () => {
    const tree = buildElementTree(
      doc([rect({ id: 'child', parentId: 'g' }), { type: 'group', id: 'g' }]),
    );
    expect(tree.issues).toEqual([]);
    expect(tree.byId.get('g')!.children.map((n) => n.element.id)).toEqual(['child']);
  });

  it('paints parents before children and keeps sibling order', () => {
    const tree = buildElementTree(
      doc([
        rect({ id: 'bg' }),
        { type: 'group', id: 'g' },
        rect({ id: 'in-1', parentId: 'g' }),
        rect({ id: 'in-2', parentId: 'g' }),
        rect({ id: 'fg' }),
      ]),
    );
    expect(flattenTree(tree).map((n) => n.element.id)).toEqual(['bg', 'g', 'in-1', 'in-2', 'fg']);
  });
});

describe('buildElementTree — malformed links', () => {
  it('re-roots an element whose parent does not exist and reports it', () => {
    const tree = buildElementTree(doc([rect({ id: 'orphan', parentId: 'ghost' })]));
    expect(tree.roots.map((n) => n.element.id)).toEqual(['orphan']);
    expect(tree.issues).toHaveLength(1);
    expect(tree.issues[0]).toMatchObject({ code: 'missing-parent', elementId: 'orphan' });
  });

  it('rejects a non-group parent', () => {
    const tree = buildElementTree(doc([rect({ id: 'box' }), rect({ id: 'kid', parentId: 'box' })]));
    expect(tree.issues[0]).toMatchObject({ code: 'non-group-parent', elementId: 'kid' });
    expect(tree.roots).toHaveLength(2);
    expect(tree.issues[0]?.message).toContain('only groups may contain children');
  });

  it('rejects self-parenting', () => {
    const tree = buildElementTree(doc([{ type: 'group', id: 'g', parentId: 'g' }]));
    expect(tree.issues[0]).toMatchObject({ code: 'self-parent', elementId: 'g' });
    expect(tree.roots).toHaveLength(1);
  });

  it('breaks a two-node cycle and still renders both elements', () => {
    const tree = buildElementTree(
      doc([
        { type: 'group', id: 'a', parentId: 'b' },
        { type: 'group', id: 'b', parentId: 'a' },
      ]),
    );
    expect(tree.issues.some((i) => i.code === 'parent-cycle')).toBe(true);
    expect(flattenTree(tree)).toHaveLength(2);
  });

  it('breaks a longer cycle', () => {
    const tree = buildElementTree(
      doc([
        { type: 'group', id: 'a', parentId: 'c' },
        { type: 'group', id: 'b', parentId: 'a' },
        { type: 'group', id: 'c', parentId: 'b' },
      ]),
    );
    expect(tree.issues.some((i) => i.code === 'parent-cycle')).toBe(true);
    expect(flattenTree(tree)).toHaveLength(3);
  });

  it('never loses an element, whatever the damage', () => {
    const tree = buildElementTree(
      doc([
        rect({ id: 'ok' }),
        rect({ id: 'orphan', parentId: 'ghost' }),
        { type: 'group', id: 'cyc-a', parentId: 'cyc-b' },
        { type: 'group', id: 'cyc-b', parentId: 'cyc-a' },
        rect({ id: 'nested', parentId: 'cyc-a' }),
      ]),
    );
    expect(
      flattenTree(tree)
        .map((n) => n.element.id)
        .sort(),
    ).toEqual(['cyc-a', 'cyc-b', 'nested', 'ok', 'orphan']);
  });
});

describe('resolveVisibility', () => {
  it('hides a subtree when the group is off stage', () => {
    const d = doc([
      { type: 'group', id: 'g', appearances: [{ start: 5000, end: 9000 }] },
      rect({ id: 'kid', parentId: 'g' }),
    ]);
    const tree = buildElementTree(d);

    const hidden = resolveVisibility(tree, computeSnapshot(d, 1000));
    expect(hidden.get('g')).toBe(false);
    expect(hidden.get('kid')).toBe(false);

    const shown = resolveVisibility(tree, computeSnapshot(d, 7000));
    expect(shown.get('g')).toBe(true);
    expect(shown.get('kid')).toBe(true);
  });

  it('still hides a child that is off stage inside a visible group', () => {
    const d = doc([
      { type: 'group', id: 'g', appearances: ALWAYS },
      rect({ id: 'kid', parentId: 'g', appearances: [{ start: 8000, end: 9000 }] }),
    ]);
    const visible = resolveVisibility(buildElementTree(d), computeSnapshot(d, 1000));
    expect(visible.get('g')).toBe(true);
    expect(visible.get('kid')).toBe(false);
  });

  it('propagates through two levels of grouping', () => {
    const d = doc([
      { type: 'group', id: 'outer', appearances: [] },
      { type: 'group', id: 'inner', parentId: 'outer', appearances: ALWAYS },
      rect({ id: 'leaf', parentId: 'inner' }),
    ]);
    const visible = resolveVisibility(buildElementTree(d), computeSnapshot(d, 1000));
    expect(visible.get('leaf')).toBe(false);
  });
});

describe('accumulatedMatrices', () => {
  it('gives root elements the identity transform', () => {
    const d = doc([rect({ id: 'a' })]);
    const m = accumulatedMatrices(buildElementTree(d), computeSnapshot(d, 0));
    expect(isIdentity(m.get('a')!)).toBe(true);
  });

  it('translates children by the group origin', () => {
    const d = doc([
      { type: 'group', id: 'g', x: 100, y: 50, appearances: ALWAYS },
      rect({ id: 'kid', parentId: 'g' }),
    ]);
    const m = accumulatedMatrices(buildElementTree(d), computeSnapshot(d, 0));
    expect(applyToPoint(m.get('kid')!, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
    expect(applyToPoint(m.get('kid')!, { x: 10, y: 10 })).toEqual({ x: 110, y: 60 });
    // The group's own matrix stays identity — its transform applies to children.
    expect(isIdentity(m.get('g')!)).toBe(true);
  });

  it('composes nested group translations', () => {
    const d = doc([
      { type: 'group', id: 'outer', x: 100, y: 0 },
      { type: 'group', id: 'inner', parentId: 'outer', x: 5, y: 20 },
      rect({ id: 'leaf', parentId: 'inner' }),
    ]);
    const m = accumulatedMatrices(buildElementTree(d), computeSnapshot(d, 0));
    expect(applyToPoint(m.get('leaf')!, { x: 0, y: 0 })).toEqual({ x: 105, y: 20 });
  });

  it('rotates children about the group origin', () => {
    const d = doc([
      { type: 'group', id: 'g', x: 0, y: 0, rotation: 90 },
      rect({ id: 'kid', parentId: 'g' }),
    ]);
    const m = accumulatedMatrices(buildElementTree(d), computeSnapshot(d, 0));
    const p = applyToPoint(m.get('kid')!, { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it('rotates about the translated origin, keeping the group rigid', () => {
    const d = doc([
      { type: 'group', id: 'g', x: 100, y: 100, rotation: 90 },
      rect({ id: 'kid', parentId: 'g' }),
    ]);
    const m = accumulatedMatrices(buildElementTree(d), computeSnapshot(d, 0));
    const origin = applyToPoint(m.get('kid')!, { x: 0, y: 0 });
    expect(origin.x).toBeCloseTo(100);
    expect(origin.y).toBeCloseTo(100);
    const offset = applyToPoint(m.get('kid')!, { x: 10, y: 0 });
    expect(offset.x).toBeCloseTo(100);
    expect(offset.y).toBeCloseTo(110);
  });

  it('follows a group animated by tracks so children move with it', () => {
    const d = doc([
      {
        type: 'group',
        id: 'g',
        x: 0,
        y: 0,
        tracks: [
          {
            property: 'x',
            keyframes: [
              { time: 0, value: 0, ease: 'linear' },
              { time: 1000, value: 200, ease: 'linear' },
            ],
          },
        ],
      },
      rect({ id: 'kid', parentId: 'g' }),
    ]);
    const tree = buildElementTree(d);
    const at = (t: number) =>
      applyToPoint(accumulatedMatrices(tree, computeSnapshot(d, t)).get('kid')!, { x: 0, y: 0 }).x;
    expect(at(0)).toBeCloseTo(0);
    expect(at(500)).toBeCloseTo(100);
    expect(at(1000)).toBeCloseTo(200);
  });

  it('ignores a leaf element own rotation, which the renderer applies itself', () => {
    const d = doc([rect({ id: 'a', rotation: 45 })]);
    const m = accumulatedMatrices(buildElementTree(d), computeSnapshot(d, 0));
    expect(isIdentity(m.get('a')!)).toBe(true);
  });
});
