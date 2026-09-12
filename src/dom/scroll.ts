// Scroll-driven playback.
//
// A long article's animation mostly goes unwatched: the reader does not press play,
// and if they do, the picture moves at a speed that has nothing to do with how fast
// they read. Autoplay has the opposite failure — the animation is over before the
// paragraph above it is.
//
// So hand the clock to the reader. This costs almost nothing to build because the
// player already takes its scheduler from outside and `seek` is pure: scrolling back
// up is a smaller number, not an undo. An engine that accumulated state would smear
// as soon as anyone scrolled the wrong way.

import type { AnimationDocument } from '../core/schema/document';
import { scrollTime, type ScrollTimeOptions } from '../core/scroll';
import { buildScene } from '../core/scene/build';
import { renderDocumentToSvg } from '../svg/render';
import { CLASS } from './strings';
import { patchScene } from './patch';
import type { MountOptions } from './mount';

export interface ScrollPlayerOptions extends MountOptions, ScrollTimeOptions {
  /**
   * Element whose scroll position drives time. Defaults to the container's parent,
   * which is the shape a `position: sticky` stage takes.
   */
  readonly range?: HTMLElement;
  /** Make the stage stick while its range scrolls past. */
  readonly pin?: boolean;
  /**
   * What to do for a reader who asked for reduced motion.
   *
   * `frames` replaces the scroll link with one still per chapter. Scroll hijacking
   * is particularly bad for readers with vestibular disorders, and slowing it down
   * does not help — the page still moves under them.
   *
   * Named for the fallback rather than the preference because `SceneOptions` already
   * has a `reducedMotion`, which is the observation itself.
   */
  readonly reducedMotionFallback?: 'frames' | 'ignore';
}

export interface ScrollPlayerHandle {
  readonly element: HTMLElement;
  /** Draw at a progress from 0 to 1, for a caller driving it another way. */
  render(progress: number): void;
  destroy(): void;
}

/** Where the range element sits relative to the viewport, as 0..1. */
export function rangeProgress(rect: DOMRect, viewportHeight: number): number {
  const total = rect.height - viewportHeight;
  if (total <= 0) {
    // A range shorter than the viewport cannot be scrolled through, so it is driven
    // by where it sits instead: fully progressed once its bottom reaches the top.
    const span = rect.height + viewportHeight;
    return span <= 0 ? 0 : Math.min(1, Math.max(0, (viewportHeight - rect.top) / span));
  }
  return Math.min(1, Math.max(0, -rect.top / total));
}

/**
 * Mount a stage whose time follows the scroll position.
 *
 * There is no clock: nothing plays, and every frame is drawn in response to a
 * scroll event coalesced through `requestAnimationFrame`.
 */
export function mountScrollPlayer(
  container: HTMLElement,
  doc: AnimationDocument,
  options: ScrollPlayerOptions = {},
): ScrollPlayerHandle {
  const frame = document.createElement('div');
  frame.className = CLASS.stageFrame;
  if (options.pin) frame.dataset.clothPinned = 'true';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', CLASS.stageSvg);
  frame.append(svg);
  container.append(frame);

  const render = (progress: number): void => {
    const time = scrollTime(doc, progress, { snapToChapters: options.snapToChapters });
    patchScene(svg, buildScene(doc, time, options));
  };

  const reduced =
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced && options.reducedMotionFallback !== 'ignore') {
    // One still per chapter, in reading order. The reader gets the whole story
    // without the page moving under them, and without a control they must find.
    frame.remove();
    const list = document.createElement('div');
    list.className = CLASS.embed;
    const times =
      doc.chapters.length > 0
        ? [...doc.chapters].sort((a, b) => a.time - b.time).map((chapter) => chapter.time)
        : [0, Math.round(doc.duration / 2), doc.duration];
    for (const time of times) {
      const still = document.createElement('div');
      still.className = CLASS.stageFrame;
      still.innerHTML = renderDocumentToSvg(doc, time, { ...options, standalone: true });
      list.append(still);
    }
    container.append(list);
    return {
      element: list,
      render: () => {},
      destroy: () => list.remove(),
    };
  }

  const range = options.range ?? container.parentElement ?? container;
  let queued = false;

  // Not every host has requestAnimationFrame — a test DOM, a worker, an embedded
  // view — and a scroll player that throws on mount there is worse than one that
  // coalesces a little less precisely.
  const nextFrame: (callback: () => void) => void =
    typeof globalThis.requestAnimationFrame === 'function'
      ? (callback) => void globalThis.requestAnimationFrame(callback)
      : (callback) => void setTimeout(callback, 16);

  const draw = (): void => render(rangeProgress(range.getBoundingClientRect(), window.innerHeight));

  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    // Coalesced: a scroll fires far more often than the screen refreshes, and every
    // extra call would rebuild a scene nobody sees.
    nextFrame(() => {
      queued = false;
      draw();
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  // Drawn synchronously once so the stage is never blank waiting for a first scroll.
  draw();

  return {
    element: frame,
    render,
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      frame.remove();
    },
  };
}
