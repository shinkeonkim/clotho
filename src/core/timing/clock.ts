// Time advance for the playback loop. Ported from oh-my-blog's clock.ts, the more
// evolved of the two reference engines (shinkeonkim's version did this inline in a
// setState callback, which made looping hard to test and easy to get wrong).

export interface ClockTick {
  readonly currentTime: number;
  readonly elapsed: number;
  readonly duration: number;
  readonly loop: boolean;
}

export interface ClockResult {
  readonly time: number;
  /** True when a non-looping animation has reached its end. */
  readonly ended: boolean;
}

/**
 * Advance `currentTime` by `elapsed`, wrapping or stopping at `duration`.
 *
 * A zero-length animation reports `ended` immediately rather than dividing by
 * zero or spinning.
 */
export function advanceTime({ currentTime, elapsed, duration, loop }: ClockTick): ClockResult {
  if (duration <= 0) return { time: 0, ended: true };

  const next = currentTime + elapsed;
  if (next < duration) return { time: next, ended: false };
  if (loop) return { time: next % duration, ended: false };
  return { time: duration, ended: true };
}
