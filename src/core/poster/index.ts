// Which instant represents a document.
//
// Three separate features need a still that stands for the whole animation: the
// poster frame behind a markdown embed, the OG image behind a shared link, and the
// first cell of a storyboard. They should not each guess differently, or the same
// document would be represented by three different pictures.

import type { AnimationDocument } from '../schema/document';

/**
 * Fraction of the duration to use when a document offers no better clue.
 *
 * Not the midpoint: animations usually finish assembling themselves before halfway
 * and then hold, so slightly before the middle catches the moment the picture is
 * complete rather than the moment it starts coming apart again.
 */
const FALLBACK_FRACTION = 0.4;

/**
 * The instant that best represents a document.
 *
 * The first chapter wins when there is one, because a chapter is the author saying
 * "this is a moment worth naming" — and the first is where the explanation has
 * assembled enough to be recognizable. Failing that, a fraction of the duration.
 */
export function posterTime(animation: AnimationDocument): number {
  const chapters = [...animation.chapters].sort((a, b) => a.time - b.time);
  // A chapter at zero is the start of the animation rather than a considered
  // moment, so it is passed over in favour of the next one if there is one.
  const named = chapters.find((chapter) => chapter.time > 0) ?? chapters[0];
  if (named) return Math.min(named.time, animation.duration);
  return Math.round(animation.duration * FALLBACK_FRACTION);
}
