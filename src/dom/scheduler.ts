// The browser frame scheduler.
//
// Lives here rather than in the core because `requestAnimationFrame` is a host
// global and the core is checked for not touching one. The React and Vue adapters
// import this instead of each writing their own — it is the DOM adapter's job to
// know about the DOM.
//
// Falls back to `setTimeout` where rAF is missing (jsdom without a polyfill, older
// test environments) so a player still ticks rather than silently freezing.

import type { FrameCallback, Scheduler } from '../core/player/scheduler';

/** ~60fps, used only by the setTimeout fallback. */
const FALLBACK_FRAME_MS = 16;

function hasAnimationFrame(): boolean {
  return typeof globalThis.requestAnimationFrame === 'function';
}

/**
 * Frames from `requestAnimationFrame`, or `setTimeout` when it is unavailable.
 *
 * The fallback synthesizes a timestamp from `performance.now()` where present so the
 * player's delta arithmetic behaves the same either way.
 */
export function createAnimationFrameScheduler(): Scheduler {
  if (hasAnimationFrame()) {
    return {
      request(callback: FrameCallback) {
        return globalThis.requestAnimationFrame(callback);
      },
      cancel(handle: number) {
        globalThis.cancelAnimationFrame(handle);
      },
    };
  }

  const now = (): number =>
    typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : 0;

  return {
    request(callback: FrameCallback) {
      return setTimeout(() => callback(now()), FALLBACK_FRAME_MS) as unknown as number;
    },
    cancel(handle: number) {
      clearTimeout(handle);
    },
  };
}

/** Shared instance, since the scheduler is stateless. */
export const animationFrameScheduler: Scheduler = createAnimationFrameScheduler();
