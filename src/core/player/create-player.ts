// The playback controller.
//
// Extracted from the legacy engine, where the rAF loop, the current time, the speed,
// and the play/pause state all lived inside a React component. With four adapters
// that arrangement would mean four implementations of looping, four of speed, and
// four sets of the bugs that come with them.
//
// Here it is a plain object with a subscription. React binds it with
// `useSyncExternalStore`, Vue with a `shallowRef`, vanilla by subscribing directly —
// each binding is a few lines and none of them owns any playback logic.
//
// The editor gets the same object for timeline scrubbing.

import type { AnimationDocument } from '../schema/document';
import { advanceTime } from '../timing/clock';
import { clamp } from '../timing/ease';
import { currentChapter } from '../runtime/chapters';
import { noopScheduler, type Scheduler } from './scheduler';

export interface PlayerState {
  readonly time: number;
  readonly playing: boolean;
  /** True once a non-looping animation has reached its end. */
  readonly ended: boolean;
  readonly speed: number;
  /** Index into the time-sorted chapter list, or -1 before the first chapter. */
  readonly chapterIndex: number;
}

export interface PlayerOptions {
  readonly scheduler?: Scheduler;
  readonly initialTime?: number;
  /** Defaults to the document's `settings.autoplay`. */
  readonly autoplay?: boolean;
  /** Defaults to the document's `settings.loop`. */
  readonly loop?: boolean;
  readonly speed?: number;
  /** Called when a non-looping animation finishes. */
  readonly onEnd?: () => void;
}

export interface Player {
  getState(): PlayerState;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: (state: PlayerState) => void): () => void;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Jump to a time, clamped to the document duration. Does not change play state. */
  seek(timeMs: number): void;
  /** Jump to the start and clear the ended flag. */
  restart(): void;
  setSpeed(multiplier: number): void;
  setLoop(loop: boolean): void;
  /** Stop the clock and drop every listener. */
  destroy(): void;
  readonly duration: number;
}

const MIN_SPEED = 0.05;
const MAX_SPEED = 16;

/**
 * Longest frame delta the clock will honour, in milliseconds.
 *
 * A backgrounded tab, a blocked main thread, or a debugger pause produces a gap of
 * seconds. Feeding that through unmodified makes the animation jump — and for a
 * looping animation, `next % duration` after a 30-second gap lands somewhere
 * arbitrary. Clamping to roughly four frames keeps a stall from teleporting the
 * playhead.
 */
const MAX_FRAME_DELTA_MS = 64;

export function createPlayer(doc: AnimationDocument, options: PlayerOptions = {}): Player {
  const scheduler = options.scheduler ?? noopScheduler;
  const duration = doc.duration;

  let time = clamp(options.initialTime ?? 0, 0, duration);
  let playing = (options.autoplay ?? doc.settings.autoplay) && duration > 0;
  let loop = options.loop ?? doc.settings.loop;
  let speed = clampSpeed(options.speed ?? 1);
  let ended = false;
  let destroyed = false;

  let frameHandle: number | null = null;
  let lastTimestamp: number | null = null;
  const listeners = new Set<(state: PlayerState) => void>();

  function chapterIndexAt(t: number): number {
    return currentChapter(doc, t)?.index ?? -1;
  }

  let state: PlayerState = {
    time,
    playing,
    ended,
    speed,
    chapterIndex: chapterIndexAt(time),
  };

  function publish(): void {
    const next: PlayerState = { time, playing, ended, speed, chapterIndex: chapterIndexAt(time) };
    // Skip identical states so subscribers using reference equality do not re-render
    // on a paused frame.
    if (
      next.time === state.time &&
      next.playing === state.playing &&
      next.ended === state.ended &&
      next.speed === state.speed &&
      next.chapterIndex === state.chapterIndex
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) listener(state);
  }

  function stopClock(): void {
    if (frameHandle !== null) {
      scheduler.cancel(frameHandle);
      frameHandle = null;
    }
    lastTimestamp = null;
  }

  function onFrame(timestamp: number): void {
    frameHandle = null;
    if (destroyed || !playing) return;

    if (lastTimestamp === null) {
      // First frame after starting: establish the baseline without advancing, so a
      // large timestamp does not count as elapsed time.
      lastTimestamp = timestamp;
      requestFrame();
      return;
    }

    const rawDelta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    const delta = Math.min(Math.max(rawDelta, 0), MAX_FRAME_DELTA_MS);

    const result = advanceTime({
      currentTime: time,
      elapsed: delta * speed,
      duration,
      loop,
    });
    time = result.time;

    if (result.ended) {
      playing = false;
      ended = true;
      stopClock();
      publish();
      options.onEnd?.();
      return;
    }

    publish();
    requestFrame();
  }

  function requestFrame(): void {
    if (destroyed || !playing || frameHandle !== null) return;
    frameHandle = scheduler.request(onFrame);
  }

  function startClock(): void {
    if (destroyed || !playing) return;
    lastTimestamp = null;
    requestFrame();
  }

  if (playing) startClock();

  return {
    duration,

    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    play() {
      if (destroyed || playing || duration <= 0) return;
      // Playing again after the end restarts, which is what a play button should do
      // rather than sitting inert on the final frame.
      if (ended) {
        time = 0;
        ended = false;
      }
      playing = true;
      publish();
      startClock();
    },

    pause() {
      if (destroyed || !playing) return;
      playing = false;
      stopClock();
      publish();
    },

    toggle() {
      if (playing) this.pause();
      else this.play();
    },

    seek(timeMs) {
      if (destroyed) return;
      time = clamp(timeMs, 0, duration);
      // Seeking away from the end means the viewer is looking around, not finished.
      if (time < duration) ended = false;
      // Drop the baseline so the resumed clock does not count the paused interval.
      lastTimestamp = null;
      publish();
    },

    restart() {
      if (destroyed) return;
      time = 0;
      ended = false;
      lastTimestamp = null;
      publish();
    },

    setSpeed(multiplier) {
      if (destroyed) return;
      speed = clampSpeed(multiplier);
      publish();
    },

    setLoop(next) {
      if (destroyed) return;
      loop = next;
    },

    destroy() {
      destroyed = true;
      playing = false;
      stopClock();
      listeners.clear();
    },
  };
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return clamp(value, MIN_SPEED, MAX_SPEED);
}
