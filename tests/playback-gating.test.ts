// Playback gating across the adapters.
//
// These exist because the React adapter shipped broken and only a browser caught it: the
// controls said "playing" while the clock stood still. Two mistakes, both invisible to
// every test written up to that point.
//
//   1. The gate was applied *during render* — `if (shouldRun !== state.playing)
//      player.pause()` in the component body. A render pass must not start or stop a
//      frame loop.
//   2. It compared against `state.playing` — the clock — instead of tracking what the
//      viewer asked for. That conflation breaks both ways: scrolling away reads as
//      pressing pause (so it never resumes), and pausing while off screen is undone the
//      moment it scrolls back.
//
// The DOM adapter is the one that can be driven headlessly, so the behavior is pinned
// here; `effectivePlayback` itself is unit-tested in core.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { animationDocumentSchema } from '../src/core/schema/document';
import { createManualScheduler } from '../src/core/player/scheduler';
import { effectivePlayback } from '../src/core/timing/playback';
import { mountPlayer } from '../src/dom/mount';

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'demo',
  title: 'Demo',
  duration: 5000,
  settings: { loop: true, autoplay: true, showCaption: false, showChapterList: false },
  elements: [
    {
      type: 'rect',
      id: 'r',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      appearances: [{ start: 0, end: 5000, entryDuration: 0, exitDuration: 0 }],
      tracks: [
        {
          property: 'x',
          keyframes: [
            { time: 0, value: 0, ease: 'linear' },
            { time: 5000, value: 500, ease: 'linear' },
          ],
        },
      ],
    },
  ],
});

let window: Window;

beforeEach(() => {
  window = new Window({ url: 'https://example.com' });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = window.document;
  g.IntersectionObserver = undefined;
  g.matchMedia = undefined;
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.IntersectionObserver;
  delete g.matchMedia;
});

function mount(scheduler = createManualScheduler()) {
  const container = window.document.createElement('div');
  const handle = mountPlayer(container as unknown as HTMLElement, doc, { player: { scheduler } });
  // happy-dom's Element and Event are structurally close to lib.dom's but not identical;
  // this test only needs them as opaque handles.
  type ButtonLike = {
    getAttribute(name: string): string | null;
    dispatchEvent(event: unknown): boolean;
  };
  const buttons = Array.from(container.querySelectorAll('button')) as unknown as ButtonLike[];
  const click = (el: ButtonLike) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
  const rectX = () => container.querySelector('rect')?.getAttribute('x');
  return { container, handle, scheduler, play: buttons[0]!, restart: buttons[1]!, click, rectX };
}

describe('playback actually advances', () => {
  // The exact symptom seen in the browser: the control reads "pause" (i.e. playing) and
  // the drawing never moves.
  it('moves the drawing while the control says it is playing', () => {
    const { handle, scheduler, play, rectX } = mount();
    expect(play.getAttribute('aria-label')).toBe('Pause');

    const before = rectX();
    scheduler.advance(0);
    scheduler.advance(50);
    const after = rectX();

    expect(handle.player.getState().time).toBeGreaterThan(0);
    expect(after).not.toBe(before);
    handle.destroy();
  });

  it('autoplays when the document asks for it', () => {
    const { handle } = mount();
    expect(handle.player.getState().playing).toBe(true);
    handle.destroy();
  });
});

describe('viewer intent versus the clock', () => {
  it('stops advancing after pause and resumes after play', () => {
    const { handle, scheduler, play, click, rectX } = mount();
    scheduler.advance(0);
    scheduler.advance(50);

    click(play);
    const paused = rectX();
    scheduler.advance(500);
    expect(rectX()).toBe(paused);
    expect(play.getAttribute('aria-label')).toBe('Play');

    click(play);
    scheduler.advance(0);
    scheduler.advance(50);
    expect(rectX()).not.toBe(paused);
    handle.destroy();
  });

  // Restart is a request to watch it again, so it resumes rather than leaving the
  // playhead parked at zero.
  it('resumes on restart', () => {
    const { handle, scheduler, play, restart, click } = mount();
    click(play); // pause
    expect(handle.player.getState().playing).toBe(false);

    click(restart);
    expect(handle.player.getState()).toMatchObject({ time: 0, playing: true });
    scheduler.advance(0);
    scheduler.advance(50);
    expect(handle.player.getState().time).toBeGreaterThan(0);
    handle.destroy();
  });
});

describe('effectivePlayback is the single rule', () => {
  it('requires all three conditions', () => {
    expect(effectivePlayback(true, true, false)).toBe(true);
    expect(effectivePlayback(false, true, false)).toBe(false); // viewer paused
    expect(effectivePlayback(true, false, false)).toBe(false); // off screen
    expect(effectivePlayback(true, true, true)).toBe(false); // reduced motion
  });

  // The pair that the old "compare against state.playing" version got wrong.
  it('distinguishes "viewer paused" from "temporarily off screen"', () => {
    const wants = true;
    expect(effectivePlayback(wants, false, false)).toBe(false); // hidden: stop the clock
    expect(effectivePlayback(wants, true, false)).toBe(true); // back in view: resume
    const doesNotWant = false;
    expect(effectivePlayback(doesNotWant, true, false)).toBe(false); // stays paused
  });
});
