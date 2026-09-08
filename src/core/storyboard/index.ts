// Which frames stand for the animation.
//
// There are plenty of places an animation cannot play — a printed page, a paper's
// PDF, a slide, a code review comment, an email — and the two things this package
// could export were one still or a whole GIF. One still cannot show a process; a GIF
// cannot be pasted into most of those.
//
// Choosing the frames is a decision about the document, so it is pure and lives
// here. Rendering them is not, and lives in the node adapter.

import type { AnimationDocument } from '../schema/document';

export interface StoryboardFrame {
  readonly time: number;
  /** Chapter label when the frame came from one, for the caption under the cell. */
  readonly label?: string;
}

export type FrameSelection =
  | { readonly mode: 'chapters' }
  | { readonly mode: 'every'; readonly interval: number }
  | { readonly mode: 'times'; readonly times: readonly number[] }
  | { readonly mode: 'count'; readonly count: number };

export interface StoryboardOptions {
  readonly selection?: FrameSelection;
  /** Upper bound on frames, whatever the selection asked for. */
  readonly max?: number;
}

const DEFAULT_MAX = 24;

function dedupe(frames: readonly StoryboardFrame[]): StoryboardFrame[] {
  const seen = new Set<number>();
  const out: StoryboardFrame[] = [];
  for (const frame of frames) {
    if (seen.has(frame.time)) continue;
    seen.add(frame.time);
    out.push(frame);
  }
  return out;
}

/**
 * The instants a storyboard should show.
 *
 * Chapters by default, because a chapter is the author having already decided where
 * one step ends and the next begins — a better answer than any heuristic, when it is
 * available. Documents without chapters (a large share of the corpus) fall back to
 * an even spread.
 */
export function storyboardTimes(
  animation: AnimationDocument,
  options: StoryboardOptions = {},
): StoryboardFrame[] {
  const selection = options.selection ?? { mode: 'chapters' };
  const max = Math.max(1, options.max ?? DEFAULT_MAX);
  const clampTime = (time: number): number =>
    Math.max(0, Math.min(Math.round(time), animation.duration));

  let frames: StoryboardFrame[];

  switch (selection.mode) {
    case 'times':
      frames = selection.times.map((time) => ({ time: clampTime(time) }));
      break;

    case 'every': {
      const interval = Math.max(1, Math.round(selection.interval));
      frames = [];
      for (let time = 0; time <= animation.duration; time += interval) {
        frames.push({ time: clampTime(time) });
      }
      break;
    }

    case 'count': {
      const count = Math.max(1, Math.round(selection.count));
      // Spread across the interior rather than the ends: the first and last frames
      // of an animation are usually its emptiest.
      frames = Array.from({ length: count }, (_, i) => ({
        time: clampTime(((i + 0.5) / count) * animation.duration),
      }));
      break;
    }

    case 'chapters':
    default: {
      const chapters = [...animation.chapters].sort((a, b) => a.time - b.time);
      frames =
        chapters.length > 0
          ? chapters.map((chapter) => ({
              time: clampTime(chapter.time),
              label: chapter.label || chapter.id,
            }))
          : storyboardTimes(animation, { selection: { mode: 'count', count: 6 }, max });
      break;
    }
  }

  const unique = dedupe(frames).sort((a, b) => a.time - b.time);
  if (unique.length <= max) return unique;

  // Thinned evenly rather than truncated: the end of an animation is usually where
  // the point is, and cutting it off would be the worst possible trim.
  const step = unique.length / max;
  return Array.from({ length: max }, (_, i) => unique[Math.floor(i * step)]!);
}

export interface SheetLayout {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly width: number;
  readonly height: number;
}

/** Space for the caption strip under each cell. */
export const CAPTION_HEIGHT = 26;

/**
 * Grid geometry for a contact sheet.
 *
 * Columns default to something near-square, which is what makes a sheet readable at
 * a glance rather than a strip that has to be scrolled.
 */
export function sheetLayout(
  animation: AnimationDocument,
  frameCount: number,
  options: { readonly columns?: number; readonly cellWidth?: number; readonly gap?: number } = {},
): SheetLayout {
  const count = Math.max(1, frameCount);
  const columns = Math.max(1, options.columns ?? Math.min(count, Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / columns);
  const gap = options.gap ?? 12;

  const cellWidth = options.cellWidth ?? animation.canvas.width;
  const scale = cellWidth / animation.canvas.width;
  const cellHeight = Math.round(animation.canvas.height * scale) + CAPTION_HEIGHT;

  return {
    columns,
    rows,
    cellWidth,
    cellHeight,
    width: columns * cellWidth + (columns + 1) * gap,
    height: rows * cellHeight + (rows + 1) * gap,
  };
}
