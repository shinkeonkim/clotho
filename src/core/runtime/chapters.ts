// Chapter (caption / step) tracking. Ported from the legacy engine's
// schema/runtime.ts.

import type { AnimationDocument, Chapter } from '../schema/document';

export interface ActiveChapter {
  /** Index into the time-sorted chapter list, not into `doc.chapters`. */
  readonly index: number;
  readonly chapter: Chapter;
}

/**
 * The latest chapter whose time is at or before `time`, or null before the first.
 *
 * Chapters are sorted here rather than assumed sorted: documents are hand-written
 * and edited, and legacy already tolerated out-of-order chapters.
 */
export function currentChapter(doc: AnimationDocument, time: number): ActiveChapter | null {
  if (doc.chapters.length === 0) return null;

  const sorted = [...doc.chapters].sort((a, b) => a.time - b.time);
  let active: ActiveChapter | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const chapter = sorted[i]!;
    if (chapter.time > time) break;
    active = { index: i, chapter };
  }
  return active;
}

/** Chapters ordered by time. Useful for rendering a step list. */
export function sortedChapters(doc: AnimationDocument): Chapter[] {
  return [...doc.chapters].sort((a, b) => a.time - b.time);
}
