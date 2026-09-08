// Spotlight tests. The scrim is one masked rectangle, so most of what matters is
// the mask's contents and the opacity curve.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import type { SpotlightEffect } from '../schema/effects';
import { buildScene } from './build';
import type { SceneDef, SceneNode } from './nodes';
import { SPOTLIGHT_ID_PREFIX, spotlightOpacity } from './spotlight';

const ALWAYS = [{ start: 0, end: 10_000, entryDuration: 0, exitDuration: 0 }];

function animation(over: Record<string, unknown> = {}): AnimationDocument {
  const { elements, ...rest } = over as { elements?: Record<string, unknown>[] };
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'spot',
    duration: 10_000,
    canvas: { width: 800, height: 500 },
    elements: (
      elements ?? [
        { type: 'rect', id: 'a', x: 100, y: 100, width: 100, height: 100 },
        { type: 'rect', id: 'b', x: 400, y: 200, width: 100, height: 100 },
      ]
    ).map((el) => ({ appearances: ALWAYS, ...el })),
    ...rest,
  });
}

function spot(over: Record<string, unknown> = {}) {
  return {
    type: 'spotlight',
    id: 'sp',
    elementIds: ['a'],
    time: 0,
    duration: 1000,
    fadeIn: 0,
    padding: 0,
    ...over,
  };
}

const maskOf = (defs: readonly SceneDef[]): SceneDef | undefined =>
  defs.find((def) => def.kind === 'mask');
const scrimOf = (nodes: readonly SceneNode[]): SceneNode | undefined =>
  nodes.find((node) => typeof node.attrs.mask === 'string');

describe('spotlightOpacity', () => {
  const effect = (over: Partial<SpotlightEffect> = {}): SpotlightEffect =>
    ({ ...spot({ duration: 1000, fadeIn: 200, dim: 0.8 }), ...over }) as SpotlightEffect;

  it('is zero outside the window, at both ends', () => {
    expect(spotlightOpacity(effect(), -1)).toBe(0);
    expect(spotlightOpacity(effect(), 1000)).toBe(0);
    expect(spotlightOpacity(effect(), 5000)).toBe(0);
  });

  it('ramps in and out over fadeIn', () => {
    expect(spotlightOpacity(effect(), 100)).toBeCloseTo(0.4, 6);
    expect(spotlightOpacity(effect(), 200)).toBeCloseTo(0.8, 6);
    expect(spotlightOpacity(effect(), 500)).toBeCloseTo(0.8, 6);
    expect(spotlightOpacity(effect(), 900)).toBeCloseTo(0.4, 6);
  });

  it('leaves no residue — it reaches zero exactly at the end', () => {
    expect(spotlightOpacity(effect(), 999.999)).toBeLessThan(0.001);
  });

  it('holds full dim with no fade requested', () => {
    expect(spotlightOpacity(effect({ fadeIn: 0 }), 500)).toBe(0.8);
  });

  it('caps each ramp at half the duration so a short spotlight still swells', () => {
    const short = effect({ duration: 200, fadeIn: 500 });
    expect(spotlightOpacity(short, 100)).toBeCloseTo(0.8, 6);
    expect(spotlightOpacity(short, 50)).toBeCloseTo(0.4, 6);
  });

  it('is inert at zero dim or zero duration', () => {
    expect(spotlightOpacity(effect({ dim: 0 }), 500)).toBe(0);
    expect(spotlightOpacity(effect({ duration: 0 }), 0)).toBe(0);
  });
});

describe('spotlight in the scene', () => {
  it('adds nothing when no spotlight is active', () => {
    const scene = buildScene(animation({ effects: [spot({ time: 5000 })] }), 0);
    expect(maskOf(scene.defs)).toBeUndefined();
    expect(scrimOf(scene.nodes)).toBeUndefined();
  });

  it('adds a masked scrim above every element while active', () => {
    const scene = buildScene(animation({ effects: [spot()] }), 500);
    const scrim = scrimOf(scene.nodes)!;
    expect(scrim).toBeDefined();
    expect(scene.nodes.at(-1)).toBe(scrim);
    expect(scrim.attrs.mask).toBe(`url(#${SPOTLIGHT_ID_PREFIX}-spot)`);
    expect(scrim.attrs.opacity).toBe(0.7);
    expect(scrim.attrs.fill).toContain('--cloth-scrim');
  });

  it('covers the canvas, and the camera rectangle when there is one', () => {
    const flat = scrimOf(buildScene(animation({ effects: [spot()] }), 500).nodes)!;
    expect(flat.attrs).toMatchObject({ x: 0, y: 0, width: 800, height: 500 });

    const zoomed = scrimOf(
      buildScene(
        animation({
          effects: [spot()],
          camera: { tracks: [{ property: 'zoom', keyframes: [{ time: 0, value: 2 }] }] },
        }),
        500,
      ).nodes,
    )!;
    expect(zoomed.attrs).toMatchObject({ x: 200, y: 125, width: 400, height: 250 });
  });

  it('uses a literal color for static export, where a CSS variable resolves to nothing', () => {
    const scene = buildScene(animation({ effects: [spot()] }), 500, { rawColors: true });
    expect(scrimOf(scene.nodes)!.attrs.fill).toBe('#0b1120');
  });

  it('names the mask after the document so two players on a page do not collide', () => {
    const scene = buildScene(animation({ id: 'other', effects: [spot()] }), 500);
    expect(maskOf(scene.defs)!.attrs.id).toBe(`${SPOTLIGHT_ID_PREFIX}-other`);
  });

  describe('mask geometry', () => {
    it('punches the targets bounding box, with padding', () => {
      const scene = buildScene(
        animation({ effects: [spot({ elementIds: ['a', 'b'], padding: 20 })] }),
        500,
      );
      const mask = maskOf(scene.defs)!;
      const [lit, hole] = mask.children as [SceneNode, SceneNode];
      expect(lit.attrs).toMatchObject({ fill: '#ffffff', width: 800, height: 500 });
      // Union of (100,100,100,100) and (400,200,100,100) is (100,100,400,200).
      expect(hole.kind).toBe('rect');
      expect(hole.attrs).toMatchObject({ x: 80, y: 80, width: 440, height: 240, fill: '#000000' });
    });

    it('punches a circle that circumscribes the box', () => {
      const scene = buildScene(
        animation({ effects: [spot({ shape: 'circle', padding: 5 })] }),
        500,
      );
      const hole = maskOf(scene.defs)!.children[1]!;
      expect(hole.kind).toBe('circle');
      expect(hole.attrs.cx).toBe(150);
      expect(hole.attrs.cy).toBe(150);
      expect(hole.attrs.r as number).toBeCloseTo(Math.hypot(100, 100) / 2 + 5, 6);
    });

    it('punches the element silhouettes, recolored so only coverage survives', () => {
      const scene = buildScene(
        animation({ effects: [spot({ shape: 'elements', padding: 4 })] }),
        500,
      );
      const hole = maskOf(scene.defs)!.children[1]!;
      // The element's own <g> wrapper, with the shape inside.
      expect(hole.kind).toBe('g');
      const shape = (hole as { children: readonly SceneNode[] }).children[0]!;
      expect(shape.attrs.fill).toBe('#000000');
      expect(shape.attrs.stroke).toBe('#000000');
      expect(shape.attrs['stroke-width']).toBe(8);
      expect(shape.attrs.opacity).toBeUndefined();
    });
  });

  it('shares one scrim between overlapping spotlights instead of stacking them', () => {
    const scene = buildScene(
      animation({
        effects: [
          spot({ id: 'one', elementIds: ['a'], dim: 0.4 }),
          spot({ id: 'two', elementIds: ['b'], dim: 0.9 }),
        ],
      }),
      500,
    );
    expect(scene.defs.filter((def) => def.kind === 'mask')).toHaveLength(1);
    expect(scene.nodes.filter((node) => typeof node.attrs.mask === 'string')).toHaveLength(1);
    // Both targets stay lit, and the stronger dim wins.
    expect(maskOf(scene.defs)!.children).toHaveLength(3);
    expect(scrimOf(scene.nodes)!.attrs.opacity).toBe(0.9);
  });

  it('sits the frame out and reports when no target is on stage', () => {
    const scene = buildScene(
      animation({
        elements: [
          { type: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 },
          {
            type: 'rect',
            id: 'late',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            appearances: [{ start: 8000, end: 9000 }],
          },
        ],
        effects: [spot({ elementIds: ['late'] })],
      }),
      500,
    );
    expect(scrimOf(scene.nodes)).toBeUndefined();
    expect(scene.diagnostics.map((d) => d.code)).toContain('spotlight-target');
  });

  it('still lights the targets it can resolve when only some are missing', () => {
    const scene = buildScene(
      animation({
        elements: [
          { type: 'rect', id: 'a', x: 100, y: 100, width: 100, height: 100 },
          {
            type: 'rect',
            id: 'late',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            appearances: [{ start: 8000, end: 9000 }],
          },
        ],
        effects: [spot({ elementIds: ['a', 'late'] })],
      }),
      500,
    );
    expect(scrimOf(scene.nodes)).toBeDefined();
    expect(maskOf(scene.defs)!.children[1]!.attrs).toMatchObject({ x: 100, y: 100 });
    expect(scene.diagnostics.map((d) => d.code)).toContain('spotlight-target');
  });

  it('frames a group through its subtree', () => {
    const scene = buildScene(
      animation({
        elements: [
          { type: 'group', id: 'g', x: 50, y: 50 },
          { type: 'rect', id: 'inner', parentId: 'g', x: 0, y: 0, width: 40, height: 40 },
        ],
        effects: [spot({ elementIds: ['g'] })],
      }),
      500,
    );
    expect(maskOf(scene.defs)!.children[1]!.attrs).toMatchObject({
      x: 50,
      y: 50,
      width: 40,
      height: 40,
    });
  });
});
