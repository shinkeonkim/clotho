// Scroll position as a clock.
//
// The mapping is pure and lives here rather than in the DOM adapter for the usual
// reason: it is a decision about the document — how long the reader should dwell on
// each chapter — and a decision like that should be testable without a viewport.
//
// The whole feature is possible because `Player.seek` is pure and the player takes
// its scheduler from outside. Driving time from scroll is swapping the clock, not
// rewriting the engine, and scrolling back up is simply a smaller number.

import type { AnimationDocument } from '../schema/document';
import { clamp } from '../timing/ease';

export interface ScrollTimeOptions {
  /**
   * Give each chapter its own stretch of scroll.
   *
   * A straight mapping spends scroll in proportion to elapsed milliseconds, so a
   * chapter that takes 200ms to happen flashes past in a few pixels no matter how
   * important it is. Snapping divides the scroll evenly between chapters instead, so
   * every named moment gets the same amount of the reader's attention.
   */
  readonly snapToChapters?: boolean;
}

/**
 * The time to show at `progress` (0..1) through the scroll range.
 *
 * Monotonic by construction: scrolling forward never moves time backwards, which is
 * what keeps the animation legible while the reader controls the speed.
 */
export function scrollTime(
  animation: AnimationDocument,
  progress: number,
  options: ScrollTimeOptions = {},
): number {
  const t = clamp(progress, 0, 1);
  if (!options.snapToChapters) return Math.round(t * animation.duration);

  // Segment boundaries: the start, every chapter, and the end. Duplicate and
  // out-of-range chapter times are dropped rather than producing zero-width
  // segments that would make a stretch of scroll do nothing.
  const marks = [
    0,
    ...animation.chapters
      .map((chapter) => chapter.time)
      .filter((time) => time > 0 && time < animation.duration)
      .sort((a, b) => a - b),
    animation.duration,
  ];
  const bounds = marks.filter((mark, index) => index === 0 || mark !== marks[index - 1]);
  const segments = bounds.length - 1;
  if (segments <= 0) return Math.round(t * animation.duration);

  const scaled = t * segments;
  const index = Math.min(Math.floor(scaled), segments - 1);
  const within = scaled - index;
  const from = bounds[index]!;
  const to = bounds[index + 1]!;
  return Math.round(from + (to - from) * within);
}

/**
 * The scroll range each chapter occupies, as `[from, to]` fractions.
 *
 * For a progress indicator, or for a caller that wants to place text beside the
 * point in the scroll where its chapter happens.
 */
export function chapterScrollRanges(
  animation: AnimationDocument,
  options: ScrollTimeOptions = {},
): { readonly id: string; readonly from: number; readonly to: number }[] {
  const chapters = [...animation.chapters].sort((a, b) => a.time - b.time);
  if (chapters.length === 0) return [];

  if (options.snapToChapters) {
    const segments = chapters.filter((c) => c.time > 0 && c.time < animation.duration).length + 1;
    return chapters.map((chapter, index) => ({
      id: chapter.id,
      from: index / segments,
      to: (index + 1) / segments,
    }));
  }

  return chapters.map((chapter, index) => ({
    id: chapter.id,
    from: chapter.time / animation.duration,
    to: (chapters[index + 1]?.time ?? animation.duration) / animation.duration,
  }));
}
