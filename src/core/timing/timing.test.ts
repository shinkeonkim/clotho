// Timing tests. Ported from oh-my-blog's clock.test.ts and playback.test.ts.

import { describe, expect, it } from 'bun:test';
import { advanceTime } from './clock';
import { effectivePlayback } from './playback';

describe('advanceTime', () => {
  it('advances within the duration', () => {
    expect(advanceTime({ currentTime: 0, elapsed: 16, duration: 1000, loop: false })).toEqual({
      time: 16,
      ended: false,
    });
  });

  it('stops at the duration when not looping', () => {
    expect(advanceTime({ currentTime: 990, elapsed: 20, duration: 1000, loop: false })).toEqual({
      time: 1000,
      ended: true,
    });
  });

  it('wraps when looping', () => {
    expect(advanceTime({ currentTime: 990, elapsed: 20, duration: 1000, loop: true })).toEqual({
      time: 10,
      ended: false,
    });
  });

  it('wraps repeatedly for an elapsed longer than the duration', () => {
    expect(advanceTime({ currentTime: 0, elapsed: 2500, duration: 1000, loop: true })).toEqual({
      time: 500,
      ended: false,
    });
  });

  it('reports a zero-length animation as ended instead of dividing by zero', () => {
    expect(advanceTime({ currentTime: 0, elapsed: 16, duration: 0, loop: true })).toEqual({
      time: 0,
      ended: true,
    });
  });

  it('lands exactly on the end without overshooting', () => {
    expect(advanceTime({ currentTime: 900, elapsed: 100, duration: 1000, loop: false })).toEqual({
      time: 1000,
      ended: true,
    });
    expect(advanceTime({ currentTime: 900, elapsed: 100, duration: 1000, loop: true })).toEqual({
      time: 0,
      ended: false,
    });
  });
});

describe('effectivePlayback', () => {
  it('runs only when the viewer wants it, it is on screen, and motion is allowed', () => {
    expect(effectivePlayback(true, true, false)).toBe(true);
  });

  it('stops when paused, off screen, or reduced motion is requested', () => {
    expect(effectivePlayback(false, true, false)).toBe(false);
    expect(effectivePlayback(true, false, false)).toBe(false);
    expect(effectivePlayback(true, true, true)).toBe(false);
  });
});
