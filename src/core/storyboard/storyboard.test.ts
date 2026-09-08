// Frame selection and sheet geometry.
//
// Which frames stand for an animation is a decision about the document, so it is
// pure and testable without a rasterizer.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import { CAPTION_HEIGHT, sheetLayout, storyboardTimes } from './index';

function animation(
  chapters: { id: string; time: number; label?: string }[] = [],
): AnimationDocument {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'doc',
    duration: 10_000,
    canvas: { width: 400, height: 200 },
    chapters,
  });
}

const chaptered = animation([
  { id: 'a', time: 0, label: 'Setup' },
  { id: 'b', time: 4000, label: 'Swap' },
  { id: 'c', time: 9000, label: 'Done' },
]);

describe('storyboardTimes — chapters', () => {
  it('uses the chapters, because the author already decided where the steps are', () => {
    expect(storyboardTimes(chaptered)).toEqual([
      { time: 0, label: 'Setup' },
      { time: 4000, label: 'Swap' },
      { time: 9000, label: 'Done' },
    ]);
  });

  it('falls back to an even spread when there are none', () => {
    const frames = storyboardTimes(animation());
    expect(frames).toHaveLength(6);
    expect(frames.every((frame) => frame.label === undefined)).toBe(true);
    // Spread across the interior: the very first and last frames are the emptiest.
    expect(frames[0]!.time).toBeGreaterThan(0);
    expect(frames.at(-1)!.time).toBeLessThan(10_000);
  });

  it('labels an unlabelled chapter with its id', () => {
    expect(storyboardTimes(animation([{ id: 'only', time: 500 }]))[0]!.label).toBe('only');
  });

  it('sorts chapters that were authored out of order', () => {
    const jumbled = animation([
      { id: 'late', time: 8000 },
      { id: 'early', time: 1000 },
    ]);
    expect(storyboardTimes(jumbled).map((frame) => frame.time)).toEqual([1000, 8000]);
  });
});

describe('storyboardTimes — other selections', () => {
  it('walks a fixed interval', () => {
    const frames = storyboardTimes(animation(), { selection: { mode: 'every', interval: 2500 } });
    expect(frames.map((frame) => frame.time)).toEqual([0, 2500, 5000, 7500, 10_000]);
  });

  it('takes an explicit list', () => {
    const frames = storyboardTimes(animation(), {
      selection: { mode: 'times', times: [100, 900, 400] },
    });
    expect(frames.map((frame) => frame.time)).toEqual([100, 400, 900]);
  });

  it('clamps times outside the document', () => {
    const frames = storyboardTimes(animation(), {
      selection: { mode: 'times', times: [-500, 99_000] },
    });
    expect(frames.map((frame) => frame.time)).toEqual([0, 10_000]);
  });

  it('drops duplicates rather than rendering the same frame twice', () => {
    const frames = storyboardTimes(animation(), {
      selection: { mode: 'times', times: [500, 500, 500] },
    });
    expect(frames).toHaveLength(1);
  });

  it('spreads a requested count', () => {
    const frames = storyboardTimes(animation(), { selection: { mode: 'count', count: 4 } });
    expect(frames).toHaveLength(4);
    const gaps = frames.slice(1).map((frame, i) => frame.time - frames[i]!.time);
    expect(new Set(gaps).size).toBe(1);
  });
});

describe('storyboardTimes — limits', () => {
  it('thins evenly rather than truncating', () => {
    const many = animation(Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, time: i * 250 })));
    const frames = storyboardTimes(many, { max: 6 });
    expect(frames).toHaveLength(6);
    // The end of an animation is usually where the point is, so cutting it off
    // would be the worst possible trim.
    expect(frames.at(-1)!.time).toBeGreaterThan(7000);
  });

  it('always returns at least one frame', () => {
    expect(storyboardTimes(animation(), { max: 0 })).toHaveLength(1);
  });
});

describe('sheetLayout', () => {
  it('chooses a near-square grid', () => {
    expect(sheetLayout(animation(), 9).columns).toBe(3);
    expect(sheetLayout(animation(), 4).columns).toBe(2);
  });

  it('honours an explicit column count', () => {
    const layout = sheetLayout(animation(), 6, { columns: 2 });
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(3);
  });

  it('leaves a partial last row rather than dropping frames', () => {
    expect(sheetLayout(animation(), 5, { columns: 3 }).rows).toBe(2);
  });

  it('scales the cell height with the cell width, plus the caption', () => {
    const layout = sheetLayout(animation(), 1, { cellWidth: 200 });
    // Canvas is 400×200, so a 200-wide cell is 100 tall before the caption.
    expect(layout.cellHeight).toBe(100 + CAPTION_HEIGHT);
  });

  it('sizes the sheet to fit the grid and its gaps', () => {
    const layout = sheetLayout(animation(), 4, { columns: 2, cellWidth: 100, gap: 10 });
    expect(layout.width).toBe(2 * 100 + 3 * 10);
    expect(layout.height).toBe(2 * layout.cellHeight + 3 * 10);
  });

  it('survives being asked for a sheet of nothing', () => {
    expect(sheetLayout(animation(), 0).rows).toBe(1);
  });
});
