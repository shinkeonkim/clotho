import { describe, expect, test } from 'bun:test';
import { animationDocumentSchema } from '../core/schema';
import { animationSampleTimes, diffRgba, expectAnimation, snapshotAnimationMatrix } from './index';

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'assertions',
  duration: 1000,
  elements: [
    {
      type: 'rect',
      id: 'a',
      x: 20,
      y: 30,
      width: 100,
      height: 50,
      label: 'Queue',
      appearances: [{ start: 0, end: 1000 }],
    },
    {
      type: 'rect',
      id: 'b',
      x: 200,
      y: 30,
      width: 100,
      height: 50,
      appearances: [{ start: 0, end: 1000 }],
    },
    { type: 'arrow', id: 'edge', fromId: 'a', toId: 'b', appearances: [{ start: 0, end: 1000 }] },
  ],
  chapters: [{ id: 'middle', time: 500 }],
  locales: ['ko', 'en'],
});

describe('animation assertions and visual regression', () => {
  test('scene semantics and bounds use element ids in failures', () => {
    expectAnimation(doc)
      .at(300)
      .visible('a')
      .textIncludes('Queue', 'a')
      .connected('a', 'b')
      .position('a', { x: 20 })
      .insideCanvas('a');
    expect(() => expectAnimation(doc).at(300).hidden('a')).toThrow(/element=a/);
  });
  test('chapter and keyframe times expand across locale and theme', () => {
    expect(animationSampleTimes(doc)).toEqual([0, 500, 1000]);
    expect(snapshotAnimationMatrix(doc)).toHaveLength(12);
  });
  test('pixel diff reports changed pixels and a visible diff buffer', () => {
    const result = diffRgba(
      new Uint8Array([0, 0, 0, 255, 20, 20, 20, 255]),
      new Uint8Array([0, 0, 0, 255, 30, 20, 20, 255]),
    );
    expect(result.changed).toBe(1);
    expect(result.ratio).toBe(0.5);
    expect([...result.diff.slice(4)]).toEqual([255, 0, 255, 255]);
  });
});
