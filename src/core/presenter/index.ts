// Chapters as slides.
//
// A document with chapters already has the structure of a deck: an order, a title
// and subtitle per step, and defined points where one ends and the next begins. What
// it lacks is a way to advance at the speed of a person talking — which is why using
// one in a talk currently means rebuilding it as slides.
//
// The segment arithmetic is pure and lives here; driving a keyboard is the adapter's
// job.

import type { AnimationDocument } from '../schema/document';

export interface ChapterSegment {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly subtitle: string;
  readonly notes: string;
  /** Where the segment starts, which is the chapter's own time. */
  readonly from: number;
  /** Where it ends: the next chapter, or the end of the document. */
  readonly to: number;
}

/**
 * The document as an ordered list of segments.
 *
 * A segment rather than an instant, because advancing should *play* the step rather
 * than jump to its end — the animation is part of the explanation, and skipping it
 * leaves the audience looking at a result with no account of how it happened.
 *
 * A document with no chapters is one segment: the whole thing.
 */
export function chapterSegments(animation: AnimationDocument): ChapterSegment[] {
  const chapters = [...animation.chapters].sort((a, b) => a.time - b.time);

  if (chapters.length === 0) {
    return [
      {
        index: 0,
        id: animation.id,
        label: animation.title || animation.id,
        subtitle: animation.description,
        notes: '',
        from: 0,
        to: animation.duration,
      },
    ];
  }

  return chapters.map((chapter, index) => ({
    index,
    id: chapter.id,
    label: chapter.label || chapter.id,
    subtitle: chapter.subtitle,
    notes: chapter.notes,
    from: Math.min(chapter.time, animation.duration),
    to: Math.min(chapters[index + 1]?.time ?? animation.duration, animation.duration),
  }));
}

/** The segment containing `time`, or the last one that has started. */
export function segmentAt(segments: readonly ChapterSegment[], time: number): ChapterSegment {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (time >= segments[i]!.from) return segments[i]!;
  }
  return segments[0]!;
}
