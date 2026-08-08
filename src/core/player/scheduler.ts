// Where frames come from.
//
// The player needs a heartbeat, but `requestAnimationFrame` is a host global and the
// core may not touch one (docs/ARCHITECTURE.md §1) — a check enforces it. So the core
// defines the interface and ships the two implementations that need no host at all:
// a manual one for tests and a no-op for server rendering. The browser
// implementation lives in the DOM adapter (`clotho/dom`), which the React and Vue
// adapters reuse rather than each writing their own.
//
// The payoff shows up immediately in testing: a manual scheduler makes playback
// deterministic, so "does this loop correctly after three wraps" is a unit test
// rather than something you watch and hope.

export type FrameCallback = (timestampMs: number) => void;

export interface Scheduler {
  /** Ask for one frame. Returns a handle for cancellation. */
  request(callback: FrameCallback): number;
  cancel(handle: number): void;
}

/**
 * A scheduler that never fires.
 *
 * The default, which makes `createPlayer` inert unless something supplies a real
 * clock. That is the right default for server rendering: a player that silently
 * tried to animate during SSR would either throw or leak a timer.
 */
export const noopScheduler: Scheduler = {
  request: () => 0,
  cancel: () => {},
};

export interface ManualScheduler extends Scheduler {
  /** Run every pending callback with `timestampMs`. */
  tick(timestampMs: number): void;
  /** Advance by `deltaMs` from the last tick and fire. */
  advance(deltaMs: number): void;
  /** Timestamp of the most recent tick. */
  readonly now: number;
  readonly pending: number;
}

/**
 * A scheduler driven by hand, for tests.
 *
 * Callbacks are drained before firing, matching rAF: a callback that requests
 * another frame is served on the *next* tick, not this one, so `advance` cannot
 * recurse forever.
 */
export function createManualScheduler(startMs = 0): ManualScheduler {
  let handle = 0;
  let now = startMs;
  let callbacks = new Map<number, FrameCallback>();

  return {
    request(callback) {
      handle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    tick(timestampMs) {
      now = timestampMs;
      const due = callbacks;
      callbacks = new Map();
      for (const callback of due.values()) callback(timestampMs);
    },
    advance(deltaMs) {
      this.tick(now + deltaMs);
    },
    get now() {
      return now;
    },
    get pending() {
      return callbacks.size;
    },
  };
}
