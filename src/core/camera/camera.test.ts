// Camera tests. All new behavior — before this the viewBox was a constant.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import { buildScene } from '../scene/build';
import type { SceneNode } from '../scene/nodes';
import { cameraTrackValueAt, computeCamera } from './index';

const ALWAYS = [{ start: 0, end: 10_000, entryDuration: 0, exitDuration: 0 }];

function doc(over: Record<string, unknown> = {}): AnimationDocument {
  const { elements, ...rest } = over as { elements?: Record<string, unknown>[] };
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'a',
    duration: 10_000,
    canvas: { width: 800, height: 500 },
    elements: (elements ?? []).map((el) => ({ appearances: ALWAYS, ...el })),
    ...rest,
  });
}

function zoomTrack(from: number, to: number, over = 1000) {
  return {
    property: 'zoom',
    keyframes: [
      { time: 0, value: from },
      { time: over, value: to, ease: 'linear' },
    ],
  };
}

describe('cameraTrackValueAt', () => {
  const track = {
    property: 'zoom' as const,
    keyframes: [
      { time: 0, value: 1 },
      { time: 1000, value: 3, ease: 'linear' as const },
      { time: 2000, value: 5, ease: 'linear' as const },
    ],
  };

  it('clamps to the outer keyframes', () => {
    expect(cameraTrackValueAt(track, -500)).toBe(1);
    expect(cameraTrackValueAt(track, 9999)).toBe(5);
  });

  it('blends linearly within a segment', () => {
    expect(cameraTrackValueAt(track, 500)).toBeCloseTo(2, 6);
    expect(cameraTrackValueAt(track, 1500)).toBeCloseTo(4, 6);
  });

  it('applies the keyframe easing', () => {
    const eased = {
      property: 'zoom' as const,
      keyframes: [
        { time: 0, value: 0 },
        { time: 1000, value: 10, ease: 'easeIn' as const },
      ],
    };
    // easeIn is quadratic: half the time is a quarter of the distance.
    expect(cameraTrackValueAt(eased, 500)).toBeCloseTo(2.5, 6);
  });

  it('lets the later value win when two keyframes share a time', () => {
    const dup = {
      property: 'zoom' as const,
      keyframes: [
        { time: 0, value: 1 },
        { time: 1000, value: 2 },
        { time: 1000, value: 7 },
      ],
    };
    expect(cameraTrackValueAt(dup, 1000)).toBe(7);
  });

  it('holds the previous value under a cut instead of blending', () => {
    expect(cameraTrackValueAt(track, 500, true)).toBe(1);
    expect(cameraTrackValueAt(track, 1000, true)).toBe(3);
  });
});

describe('computeCamera', () => {
  it('returns null for a animation without a camera', () => {
    expect(computeCamera(doc(), 0)).toBeNull();
  });

  it('returns null for a camera that declares nothing', () => {
    expect(computeCamera(doc({ camera: { tracks: [], focus: [] } }), 0)).toBeNull();
  });

  it('centers on the canvas at zoom 1', () => {
    const view = computeCamera(doc({ camera: { tracks: [zoomTrack(1, 1)] } }), 0)!;
    expect(view).toMatchObject({ x: 0, y: 0, width: 800, height: 500, zoom: 1 });
  });

  it('shrinks the visible rectangle as zoom rises', () => {
    const view = computeCamera(doc({ camera: { tracks: [zoomTrack(1, 2)] } }), 1000)!;
    expect(view.zoom).toBe(2);
    expect(view.width).toBe(400);
    expect(view.height).toBe(250);
    // Still centered on the canvas, since no x/y track moved it.
    expect(view.x).toBe(200);
    expect(view.y).toBe(125);
  });

  it('pans with x and y tracks', () => {
    const view = computeCamera(
      doc({
        camera: {
          tracks: [
            zoomTrack(2, 2),
            { property: 'x', keyframes: [{ time: 0, value: 100 }] },
            { property: 'y', keyframes: [{ time: 0, value: 400 }] },
          ],
        },
      }),
      0,
    )!;
    expect(view.centerX).toBe(100);
    expect(view.centerY).toBe(400);
    expect(view.x).toBe(100 - 200);
    expect(view.y).toBe(400 - 125);
  });

  it('never resolves to a zoom of zero', () => {
    const view = computeCamera(doc({ camera: { tracks: [zoomTrack(0.0001, 0.0001)] } }), 0)!;
    expect(view.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(view.width)).toBe(true);
  });

  it('cuts instead of gliding under reduced motion', () => {
    const animation = doc({ camera: { tracks: [zoomTrack(1, 4)] } });
    expect(computeCamera(animation, 500)!.zoom).toBeCloseTo(2.5, 6);
    expect(computeCamera(animation, 500, { reducedMotion: true })!.zoom).toBe(1);
    expect(computeCamera(animation, 1000, { reducedMotion: true })!.zoom).toBe(4);
  });
});

describe('camera focus', () => {
  const framed = (over: Record<string, unknown> = {}) =>
    doc({
      elements: [
        { type: 'rect', id: 'a', x: 100, y: 100, width: 100, height: 100 },
        { type: 'rect', id: 'b', x: 300, y: 200, width: 100, height: 100 },
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
      camera: {
        focus: [{ time: 1000, duration: 0, elementIds: ['a'], padding: 0, ...over }],
      },
    });

  it('frames a single element, centered on it', () => {
    const view = computeCamera(framed(), 1000)!;
    expect(view.centerX).toBe(150);
    expect(view.centerY).toBe(150);
    // 800/100 and 500/100 → the tighter axis wins.
    expect(view.zoom).toBe(4);
  });

  it('honours padding', () => {
    const view = computeCamera(framed({ padding: 25 }), 1000)!;
    expect(view.centerX).toBe(150);
    // The target box is now 150 wide and tall; 500/150 is the tighter fit.
    expect(view.zoom).toBeCloseTo(500 / 150, 6);
  });

  it('clamps to maxZoom so a small target does not fill the stage', () => {
    const view = computeCamera(framed({ maxZoom: 1.5 }), 1000)!;
    expect(view.zoom).toBe(1.5);
  });

  it('unions several targets', () => {
    const view = computeCamera(framed({ elementIds: ['a', 'b'] }), 1000)!;
    // Union spans (100,100)-(400,300): 300 x 200, centered at (250, 200).
    expect(view.centerX).toBe(250);
    expect(view.centerY).toBe(200);
    expect(view.zoom).toBeCloseTo(Math.min(800 / 300, 500 / 200), 6);
  });

  it('does nothing before its time', () => {
    const view = computeCamera(framed(), 999)!;
    expect(view.zoom).toBe(1);
    expect(view.centerX).toBe(400);
  });

  it('blends in from the previous camera state over its duration', () => {
    const animation = framed({ duration: 1000, ease: 'linear' });
    const start = computeCamera(animation, 1000)!;
    const middle = computeCamera(animation, 1500)!;
    const end = computeCamera(animation, 2000)!;
    expect(start.zoom).toBe(1);
    expect(middle.zoom).toBeCloseTo(2.5, 6);
    expect(end.zoom).toBe(4);
    expect(middle.centerX).toBeCloseTo((400 + 150) / 2, 6);
  });

  it('jumps straight to the target under reduced motion', () => {
    const animation = framed({ duration: 1000, ease: 'linear' });
    expect(computeCamera(animation, 1500, { reducedMotion: true })!.zoom).toBe(4);
    expect(computeCamera(animation, 999, { reducedMotion: true })!.zoom).toBe(1);
  });

  it('follows a target that moves', () => {
    const animation = doc({
      elements: [
        {
          type: 'rect',
          id: 'a',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          tracks: [
            {
              property: 'x',
              keyframes: [
                { time: 0, value: 0 },
                { time: 2000, value: 200, ease: 'linear' },
              ],
            },
          ],
        },
      ],
      camera: { focus: [{ time: 0, duration: 0, elementIds: ['a'], padding: 0 }] },
    });
    expect(computeCamera(animation, 0)!.centerX).toBe(50);
    expect(computeCamera(animation, 2000)!.centerX).toBe(250);
  });

  it('holds the previous state and reports an issue when the target is off stage', () => {
    const view = computeCamera(framed({ elementIds: ['late'] }), 1000)!;
    expect(view.zoom).toBe(1);
    expect(view.centerX).toBe(400);
    expect(view.issues).toHaveLength(1);
    expect(view.issues[0]!.code).toBe('focus-unresolved');
    expect(view.issues[0]!.elementIds).toEqual(['late']);
  });

  it('takes the latest focus that has started, whatever the authored order', () => {
    const animation = doc({
      elements: [
        { type: 'rect', id: 'a', x: 100, y: 100, width: 100, height: 100 },
        { type: 'rect', id: 'b', x: 300, y: 200, width: 200, height: 200 },
      ],
      camera: {
        focus: [
          { time: 3000, duration: 0, elementIds: ['b'], padding: 0 },
          { time: 1000, duration: 0, elementIds: ['a'], padding: 0 },
        ],
      },
    });
    expect(computeCamera(animation, 2000)!.centerX).toBe(150);
    expect(computeCamera(animation, 3000)!.centerX).toBe(400);
  });

  it('starts a focus transition from the state the previous focus had reached', () => {
    const animation = doc({
      elements: [
        { type: 'rect', id: 'a', x: 0, y: 0, width: 100, height: 100 },
        { type: 'rect', id: 'b', x: 400, y: 0, width: 100, height: 100 },
      ],
      camera: {
        focus: [
          { time: 0, duration: 0, elementIds: ['a'], padding: 0 },
          { time: 1000, duration: 1000, elementIds: ['b'], padding: 0, ease: 'linear' },
        ],
      },
    });
    expect(computeCamera(animation, 1000)!.centerX).toBe(50);
    expect(computeCamera(animation, 1500)!.centerX).toBeCloseTo((50 + 450) / 2, 6);
    expect(computeCamera(animation, 2000)!.centerX).toBe(450);
  });
});

/** Elements are wrapped in a `<g>` carrying the element id; the shape is inside. */
function shapeOf(scene: { nodes: readonly SceneNode[] }): SceneNode {
  const root = scene.nodes[0]!;
  return root.kind === 'g' ? root.children[0]! : root;
}

describe('buildScene with a camera', () => {
  it('leaves the viewBox exactly as before when there is no camera', () => {
    expect(buildScene(doc(), 0).viewBox).toBe('0 0 800 500');
    expect(buildScene(doc(), 0).camera).toBeNull();
  });

  it('emits the camera rectangle as the viewBox', () => {
    const scene = buildScene(doc({ camera: { tracks: [zoomTrack(2, 2)] } }), 0);
    expect(scene.viewBox).toBe('200 125 400 250');
    expect(scene.camera).toMatchObject({ zoom: 2 });
  });

  it('trims float noise in the viewBox so adapters agree byte for byte', () => {
    const scene = buildScene(doc({ camera: { tracks: [zoomTrack(3, 3)] } }), 0);
    for (const part of scene.viewBox.split(' ')) {
      expect(part).not.toContain('e');
      expect((part.split('.')[1] ?? '').length).toBeLessThanOrEqual(6);
    }
  });

  it('reports an unresolved focus as a scene diagnostic', () => {
    const scene = buildScene(
      doc({
        elements: [
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
        camera: { focus: [{ time: 0, elementIds: ['late'] }] },
      }),
      0,
    );
    expect(scene.diagnostics.map((d) => d.code)).toContain('camera-focus');
  });

  it('scales stroke widths with the zoom by default', () => {
    const animation = doc({
      elements: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, strokeWidth: 4 }],
      camera: { tracks: [zoomTrack(2, 2)] },
    });
    const shape = shapeOf(buildScene(animation, 0));
    expect(shape.attrs['stroke-width']).toBe(4);
  });

  it('divides stroke widths by the zoom when strokeScaling is fixed', () => {
    const animation = doc({
      elements: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, strokeWidth: 4 }],
      camera: { tracks: [zoomTrack(2, 2)], strokeScaling: 'fixed' },
    });
    const shape = shapeOf(buildScene(animation, 0));
    expect(shape.attrs['stroke-width']).toBe(2);
  });
});
