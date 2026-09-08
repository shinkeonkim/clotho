// Motion trail tests.
//
// The property that matters most is that the trail is derived, not accumulated:
// the frame at t must not depend on how the player reached t.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../../schema/document';
import type { AnimationDocument } from '../../schema/document';
import { buildScene } from '../build';
import type { SceneNode } from '../nodes';
import { computeElementState, computeSnapshot } from '../../runtime/snapshot';
import { ancestorChain, elementRootCenterAt } from '../../runtime/bounds';
import { buildElementTree } from '../../runtime/tree';
import { trailSampleTimes } from './trail';

const ALWAYS = [{ start: 0, end: 10_000, entryDuration: 0, exitDuration: 0 }];

function animation(over: Record<string, unknown> = {}): AnimationDocument {
  const { elements, ...rest } = over as { elements?: Record<string, unknown>[] };
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'trail',
    duration: 10_000,
    canvas: { width: 800, height: 500 },
    elements: (
      elements ?? [
        {
          type: 'circle',
          id: 'cursor',
          cx: 0,
          cy: 100,
          r: 10,
          tracks: [
            {
              property: 'cx',
              keyframes: [
                { time: 0, value: 0 },
                { time: 1000, value: 1000, ease: 'linear' },
              ],
            },
          ],
        },
      ]
    ).map((el) => ({ appearances: ALWAYS, ...el })),
    ...rest,
  });
}

function trail(over: Record<string, unknown> = {}) {
  return {
    type: 'trail',
    id: 'tr',
    elementId: 'cursor',
    time: 0,
    duration: 10_000,
    window: 200,
    samples: 5,
    fade: false,
    ...over,
  };
}

const trailNodes = (nodes: readonly SceneNode[]): SceneNode[] =>
  nodes.filter((node) => typeof node.key === 'string' && node.key.startsWith('tr-'));

describe('computeElementState', () => {
  it('matches the whole-document snapshot exactly', () => {
    const animated = animation();
    const one = computeElementState(animated, 'cursor', 400);
    expect(one).toEqual(computeSnapshot(animated, 400).get('cursor')!);
  });

  it('returns null for an element the document does not have', () => {
    expect(computeElementState(animation(), 'nope', 0)).toBeNull();
  });
});

describe('elementRootCenterAt', () => {
  it('follows a tracked position through time', () => {
    const tree = buildElementTree(animation());
    expect(elementRootCenterAt(tree, 'cursor', 500)!.x).toBeCloseTo(500, 6);
    expect(elementRootCenterAt(tree, 'cursor', 1000)!.x).toBeCloseTo(1000, 6);
  });

  it('applies ancestor group transforms at that same instant', () => {
    const animated = animation({
      elements: [
        {
          type: 'group',
          id: 'g',
          x: 0,
          y: 0,
          tracks: [
            {
              property: 'x',
              keyframes: [
                { time: 0, value: 0 },
                { time: 1000, value: 200, ease: 'linear' },
              ],
            },
          ],
        },
        { type: 'circle', id: 'cursor', parentId: 'g', cx: 50, cy: 50, r: 5 },
      ],
    });
    const tree = buildElementTree(animated);
    expect(elementRootCenterAt(tree, 'cursor', 0)!.x).toBe(50);
    expect(elementRootCenterAt(tree, 'cursor', 1000)!.x).toBe(250);
    expect(ancestorChain(tree, 'cursor').map((el) => el.id)).toEqual(['g']);
  });

  it('reports nothing for an instant the element was off stage', () => {
    const animated = animation({
      elements: [
        {
          type: 'circle',
          id: 'cursor',
          cx: 10,
          cy: 10,
          r: 5,
          appearances: [{ start: 500, end: 900 }],
        },
      ],
    });
    const tree = buildElementTree(animated);
    expect(elementRootCenterAt(tree, 'cursor', 100)).toBeNull();
    expect(elementRootCenterAt(tree, 'cursor', 600)).not.toBeNull();
  });

  it('reports nothing while an ancestor group is off stage', () => {
    const animated = animation({
      elements: [
        { type: 'group', id: 'g', x: 0, y: 0, appearances: [{ start: 500, end: 900 }] },
        { type: 'circle', id: 'cursor', parentId: 'g', cx: 10, cy: 10, r: 5 },
      ],
    });
    const tree = buildElementTree(animated);
    expect(elementRootCenterAt(tree, 'cursor', 100)).toBeNull();
    expect(elementRootCenterAt(tree, 'cursor', 600)).not.toBeNull();
  });

  it('has no center for a group', () => {
    const animated = animation({
      elements: [
        { type: 'group', id: 'g', x: 5, y: 5 },
        { type: 'circle', id: 'cursor', parentId: 'g', cx: 1, cy: 1, r: 1 },
      ],
    });
    expect(elementRootCenterAt(buildElementTree(animated), 'g', 0)).toBeNull();
  });
});

describe('trailSampleTimes', () => {
  it('spans the window evenly, oldest first', () => {
    expect(trailSampleTimes(trail() as never, 1000)).toEqual([800, 850, 900, 950, 1000]);
  });

  it('clamps to the document start', () => {
    const times = trailSampleTimes(trail() as never, 100);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(100);
  });

  it('collapses to a single instant at time zero', () => {
    expect(trailSampleTimes(trail() as never, 0)).toEqual([0]);
  });
});

describe('trail in the scene', () => {
  it('adds nothing when the effect is not active', () => {
    const scene = buildScene(animation({ effects: [trail({ time: 5000, duration: 100 })] }), 0);
    expect(trailNodes(scene.nodes)).toHaveLength(0);
  });

  it('joins the samples with one path when fading is off', () => {
    const scene = buildScene(animation({ effects: [trail()] }), 500);
    const nodes = trailNodes(scene.nodes);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe('path');
    expect(nodes[0]!.attrs.d).toBe('M 300 100 L 350 100 L 400 100 L 450 100 L 500 100');
  });

  it('splits into per-segment opacities when fading is on', () => {
    const scene = buildScene(animation({ effects: [trail({ fade: true })] }), 500);
    const nodes = trailNodes(scene.nodes);
    expect(nodes).toHaveLength(4);
    const opacities = nodes.map((node) => node.attrs.opacity as number);
    expect(opacities).toEqual([...opacities].sort((a, b) => a - b));
    expect(opacities.at(-1)).toBe(1);
  });

  it('draws under the element it follows', () => {
    const scene = buildScene(animation({ effects: [trail()] }), 500);
    const trailIndex = scene.nodes.findIndex((node) => node.key.startsWith('tr-'));
    const cursorIndex = scene.nodes.findIndex((node) => node.key === 'cursor');
    expect(trailIndex).toBeLessThan(cursorIndex);
  });

  it('collapses to nothing for an element that has not moved', () => {
    const still = animation({
      elements: [{ type: 'circle', id: 'cursor', cx: 100, cy: 100, r: 10 }],
      effects: [trail()],
    });
    const nodes = trailNodes(buildScene(still, 500).nodes);
    // Still two points, but both at the same place: a zero-length path.
    expect(nodes[0]!.attrs.d).toBe('M 100 100 L 100 100 L 100 100 L 100 100 L 100 100');
  });

  it('draws dots rather than a line when the position steps', () => {
    const stepped = animation({
      elements: [
        {
          type: 'circle',
          id: 'cursor',
          cx: 0,
          cy: 100,
          r: 10,
          tracks: [
            {
              property: 'cx',
              interpolate: 'discrete',
              keyframes: [
                { time: 0, value: 0 },
                { time: 400, value: 100 },
                { time: 800, value: 200 },
              ],
            },
          ],
        },
      ],
      effects: [trail({ window: 800, samples: 5 })],
    });
    const nodes = trailNodes(buildScene(stepped, 800).nodes);
    expect(nodes.every((node) => node.kind === 'circle')).toBe(true);
    // The newest sample sits under the element itself and is not drawn.
    expect(nodes).toHaveLength(4);
  });

  it('honours an explicit mode over the automatic choice', () => {
    const scene = buildScene(animation({ effects: [trail({ mode: 'dots' })] }), 500);
    expect(trailNodes(scene.nodes).every((node) => node.kind === 'circle')).toBe(true);
  });

  it('starts at the moment the element appeared, using its full sample count there', () => {
    const late = animation({
      elements: [
        {
          type: 'circle',
          id: 'cursor',
          cx: 0,
          cy: 100,
          r: 10,
          appearances: [{ start: 450, end: 9000, entryDuration: 0, exitDuration: 0 }],
          tracks: [
            {
              property: 'cx',
              keyframes: [
                { time: 0, value: 0 },
                { time: 1000, value: 1000, ease: 'linear' },
              ],
            },
          ],
        },
      ],
      effects: [trail()],
    });
    // The window reaches back to 300ms but the element only exists from 450ms, so
    // the samples are redistributed over [450, 500] rather than mostly discarded —
    // otherwise a freshly appeared element would show no trail until the window
    // cleared its entry.
    expect(trailNodes(buildScene(late, 500).nodes)[0]!.attrs.d).toBe(
      'M 450 100 L 462.5 100 L 475 100 L 487.5 100 L 500 100',
    );
  });

  it('starts at the moment an ancestor group appeared', () => {
    const grouped = animation({
      elements: [
        {
          type: 'group',
          id: 'g',
          x: 0,
          y: 0,
          appearances: [{ start: 450, end: 9000, entryDuration: 0, exitDuration: 0 }],
        },
        {
          type: 'circle',
          id: 'cursor',
          parentId: 'g',
          cx: 0,
          cy: 100,
          r: 10,
          tracks: [
            {
              property: 'cx',
              keyframes: [
                { time: 0, value: 0 },
                { time: 1000, value: 1000, ease: 'linear' },
              ],
            },
          ],
        },
      ],
      effects: [trail()],
    });
    expect(trailNodes(buildScene(grouped, 500).nodes)[0]!.attrs.d).toBe(
      'M 450 100 L 462.5 100 L 475 100 L 487.5 100 L 500 100',
    );
  });

  it('adds nothing while the element is off stage', () => {
    const gone = animation({
      elements: [
        {
          type: 'circle',
          id: 'cursor',
          cx: 10,
          cy: 10,
          r: 5,
          appearances: [{ start: 800, end: 900 }],
        },
      ],
      effects: [trail()],
    });
    expect(trailNodes(buildScene(gone, 500).nodes)).toHaveLength(0);
  });

  it('reports when the element has no position at all', () => {
    const grouped = animation({
      elements: [
        { type: 'group', id: 'g', x: 0, y: 0 },
        { type: 'circle', id: 'cursor', parentId: 'g', cx: 1, cy: 1, r: 1 },
      ],
      effects: [trail({ elementId: 'g' })],
    });
    expect(buildScene(grouped, 500).diagnostics.map((d) => d.code)).toContain('trail-target');
  });

  /**
   * The reason the trail is re-derived rather than accumulated. A viewer who
   * scrubs backwards, an exporter rendering frame 900 first, and a player that
   * arrived by playing must all see the same trail.
   */
  it('does not depend on how the playhead reached the time', () => {
    const animated = animation({ effects: [trail({ fade: true })] });
    const direct = buildScene(animated, 700);
    for (const at of [0, 100, 200, 900, 400, 700]) buildScene(animated, at);
    const afterScrubbing = buildScene(animated, 700);
    expect(trailNodes(afterScrubbing.nodes)).toEqual(trailNodes(direct.nodes));
  });
});
