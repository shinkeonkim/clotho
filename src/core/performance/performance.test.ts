import { describe, expect, test } from 'bun:test';
import { animationDocumentSchema } from '../schema';
import {
  compileSceneDependencyPlan,
  cullDocumentToViewport,
  createPreparedSceneBuilder,
} from './index';

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'large',
  duration: 2000,
  elements: [
    {
      id: 'inside',
      type: 'rect',
      appearances: [{ start: 0, end: 2000 }],
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      tracks: [
        {
          property: 'x',
          keyframes: [
            { time: 0, value: 10 },
            { time: 1000, value: 30 },
          ],
        },
      ],
    },
    {
      id: 'outside',
      type: 'rect',
      x: 900,
      y: 900,
      width: 20,
      height: 20,
      appearances: [{ start: 0, end: 2000 }],
    },
    {
      id: 'edge',
      type: 'arrow',
      fromId: 'inside',
      toId: 'outside',
      appearances: [{ start: 0, end: 2000 }],
    },
  ],
});

describe('large scene performance helpers', () => {
  test('track, keyframe, dependency와 변경 범위를 한 번에 index한다', () => {
    const plan = compileSceneDependencyPlan(doc);
    expect(plan).toMatchObject({ elementCount: 3, trackCount: 1, keyframeCount: 2 });
    expect(plan.changedBetween(500, 1200)).toEqual(new Set(['inside', 'edge']));
  });
  test('viewport 밖 shape를 제거하되 연결선 dependency는 보존한다', () => {
    expect(
      cullDocumentToViewport(doc, 0, { x: 0, y: 0, width: 200, height: 200 }).elements.map(
        ({ id }) => id,
      ),
    ).toEqual(['inside', 'edge']);
  });
  test('수천 element index를 실용적인 시간 안에 만든다', () => {
    const large = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'benchmark',
      elements: Array.from({ length: 3000 }, (_, index) => ({
        id: `box-${index}`,
        type: 'rect',
        x: index,
        y: index,
        width: 10,
        height: 10,
      })),
    });
    const started = Date.now();
    compileSceneDependencyPlan(large);
    expect(Date.now() - started).toBeLessThan(500);
  });
  test('같은 frame 결과를 재사용하고 제한된 cache를 유지한다', () => {
    const prepared = createPreparedSceneBuilder(doc, 2);
    expect(prepared.build(0)).toBe(prepared.build(0));
    prepared.build(500);
    prepared.build(1000);
    expect(prepared.stats).toEqual({ hits: 1, misses: 3, cachedFrames: 2 });
  });
});
