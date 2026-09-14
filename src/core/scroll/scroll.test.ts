// Scroll-to-time mapping tests.
//
// Pure arithmetic, which is why it lives in the core: whether a chapter gets enough
// of the reader's scroll is a decision about the document, and deciding it inside a
// viewport would make it untestable.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import { chapterScrollRanges, scrollTime } from './index';

function animation(chapters: { id: string; time: number }[] = []): AnimationDocument {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'doc',
    duration: 10_000,
    chapters,
  });
}

describe('scrollTime — linear', () => {
  it('maps the ends onto the ends', () => {
    expect(scrollTime(animation(), 0)).toBe(0);
    expect(scrollTime(animation(), 1)).toBe(10_000);
  });

  it('is proportional in between', () => {
    expect(scrollTime(animation(), 0.25)).toBe(2500);
    expect(scrollTime(animation(), 0.5)).toBe(5000);
  });

  it('clamps out-of-range progress rather than running past the document', () => {
    expect(scrollTime(animation(), -3)).toBe(0);
    expect(scrollTime(animation(), 42)).toBe(10_000);
  });
});

describe('scrollTime — snapped to chapters', () => {
  const chaptered = animation([
    { id: 'a', time: 1000 },
    { id: 'b', time: 9000 },
  ]);
  const snap = { snapToChapters: true };

  it('still maps the ends onto the ends', () => {
    expect(scrollTime(chaptered, 0, snap)).toBe(0);
    expect(scrollTime(chaptered, 1, snap)).toBe(10_000);
  });

  it('gives each chapter an equal share of the scroll', () => {
    // Three segments: 0–1000, 1000–9000, 9000–10000. Each takes a third.
    expect(scrollTime(chaptered, 1 / 3, snap)).toBe(1000);
    expect(scrollTime(chaptered, 2 / 3, snap)).toBe(9000);
  });

  /** The point of the mode: a short but important chapter is not a few pixels. */
  it('spends real scroll on a chapter that takes almost no time', () => {
    const brief = animation([
      { id: 'quick', time: 100 },
      { id: 'later', time: 200 },
    ]);
    const linearSpan = (200 - 100) / 10_000; // what the chapter would get proportionally
    const snappedStart = 1 / 3;
    const snappedEnd = 2 / 3;
    expect(snappedEnd - snappedStart).toBeGreaterThan(linearSpan * 10);
    expect(scrollTime(brief, snappedStart, snap)).toBe(100);
    expect(scrollTime(brief, snappedEnd, snap)).toBe(200);
  });

  it('never moves time backwards as scroll moves forwards', () => {
    let previous = -1;
    for (let i = 0; i <= 100; i += 1) {
      const time = scrollTime(chaptered, i / 100, snap);
      expect(time).toBeGreaterThanOrEqual(previous);
      previous = time;
    }
  });

  it('falls back to linear with no chapters', () => {
    expect(scrollTime(animation(), 0.5, snap)).toBe(5000);
  });

  it('ignores a chapter at zero and one past the end, which would be empty segments', () => {
    const edges = animation([
      { id: 'start', time: 0 },
      { id: 'mid', time: 5000 },
    ]);
    expect(scrollTime(edges, 0.5, snap)).toBe(5000);
  });

  it('collapses duplicate chapter times instead of stalling on them', () => {
    const duplicated = animation([
      { id: 'a', time: 4000 },
      { id: 'b', time: 4000 },
    ]);
    expect(scrollTime(duplicated, 0.5, snap)).toBe(4000);
    expect(scrollTime(duplicated, 1, snap)).toBe(10_000);
  });
});

describe('chapterScrollRanges', () => {
  it('is empty without chapters', () => {
    expect(chapterScrollRanges(animation())).toEqual([]);
  });

  it('places a chapter where its time falls, linearly', () => {
    const ranges = chapterScrollRanges(animation([{ id: 'a', time: 2500 }]));
    expect(ranges[0]).toEqual({ id: 'a', from: 0.25, to: 1 });
  });

  it('gives every chapter an equal share when snapped', () => {
    const ranges = chapterScrollRanges(
      animation([
        { id: 'a', time: 1000 },
        { id: 'b', time: 9000 },
      ]),
      { snapToChapters: true },
    );
    expect(ranges[0]!.to - ranges[0]!.from).toBeCloseTo(ranges[1]!.to - ranges[1]!.from, 6);
  });
});
