import { describe, expect, it } from 'bun:test';
import { appear, defineAnimation, effects, repeatAppearances, stagger, track } from './index';

describe('authoring helpers', () => {
  it('returns a fully parsed, JSON-compatible document', () => {
    const doc = defineAnimation({
      clothoVersion: 1,
      id: 'helper-demo',
      duration: 1000,
      elements: [{ type: 'circle', id: 'dot', cx: 10, cy: 10, r: 5, appearances: [appear(0, 1000)] }],
      effects: [effects.pulse({ id: 'pulse-1', elementId: 'dot', time: 300 })],
    });
    expect(doc.effects[0]).toMatchObject({ type: 'pulse', duration: 500, scale: 1.12 });
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('expands repeat and stagger patterns to explicit JSON data', () => {
    expect(repeatAppearances({ count: 3, start: 100, duration: 200, gap: 50 }).map((a) => [a.start, a.end])).toEqual([
      [100, 300], [350, 550], [600, 800],
    ]);
    expect(stagger(['a', 'b'], 120, (id, time) => ({ id, time }), 50)).toEqual([
      { id: 'a', time: 50 }, { id: 'b', time: 170 },
    ]);
    expect(track('cx', [{ time: 0, value: 0 }, { time: 100, value: 10, ease: 'easeOut' }])).toMatchObject({ property: 'cx' });
  });
});
