// Player tests.
//
// All driven by a manual scheduler, which is the point of injecting one: looping,
// speed, and end handling are asserted deterministically instead of watched.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import { createManualScheduler, noopScheduler } from './scheduler';
import { createPlayer, type PlayerState } from './create-player';

function doc(over: Record<string, unknown> = {}) {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'demo',
    duration: 1000,
    settings: { loop: false, autoplay: false, showCaption: false, showChapterList: false },
    ...over,
  });
}

function setup(over: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  const scheduler = createManualScheduler();
  const player = createPlayer(doc(over), { scheduler, ...options });
  return { scheduler, player };
}

describe('initial state', () => {
  it('starts paused at zero when autoplay is off', () => {
    const { player } = setup();
    expect(player.getState()).toMatchObject({ time: 0, playing: false, ended: false, speed: 1 });
    expect(player.duration).toBe(1000);
  });

  it('honors the document autoplay setting', () => {
    const { player } = setup({
      settings: { loop: false, autoplay: true, showCaption: false, showChapterList: false },
    });
    expect(player.getState().playing).toBe(true);
  });

  it('lets an explicit option override the document', () => {
    const { player } = setup(
      { settings: { loop: false, autoplay: true, showCaption: false, showChapterList: false } },
      { autoplay: false },
    );
    expect(player.getState().playing).toBe(false);
  });

  it('clamps an out-of-range initial time', () => {
    expect(setup({}, { initialTime: -50 }).player.getState().time).toBe(0);
    expect(setup({}, { initialTime: 9999 }).player.getState().time).toBe(1000);
  });

  it('refuses to play a zero-length animation', () => {
    const { player } = setup({ duration: 0 }, { autoplay: true });
    expect(player.getState().playing).toBe(false);
    player.play();
    expect(player.getState().playing).toBe(false);
  });
});

describe('advancing', () => {
  it('advances by the elapsed frame time', () => {
    const { scheduler, player } = setup();
    player.play();
    scheduler.advance(0); // baseline frame
    scheduler.advance(16);
    expect(player.getState().time).toBe(16);
    scheduler.advance(16);
    expect(player.getState().time).toBe(32);
  });

  // The first frame carries an arbitrary timestamp; counting it as elapsed would
  // jump the playhead by however long the page had been open.
  it('does not count the first frame timestamp as elapsed time', () => {
    const scheduler = createManualScheduler(100_000);
    const player = createPlayer(doc(), { scheduler, autoplay: true });
    scheduler.tick(100_000);
    expect(player.getState().time).toBe(0);
    scheduler.tick(100_016);
    expect(player.getState().time).toBe(16);
  });

  it('scales elapsed time by the speed multiplier', () => {
    const { scheduler, player } = setup();
    player.setSpeed(2);
    player.play();
    scheduler.advance(0);
    scheduler.advance(10);
    expect(player.getState().time).toBe(20);
  });

  it('clamps speed to a sane range and ignores nonsense', () => {
    const { player } = setup();
    player.setSpeed(0);
    expect(player.getState().speed).toBe(1);
    player.setSpeed(-3);
    expect(player.getState().speed).toBe(1);
    player.setSpeed(NaN);
    expect(player.getState().speed).toBe(1);
    player.setSpeed(1000);
    expect(player.getState().speed).toBe(16);
  });

  // A backgrounded tab or a debugger pause produces a multi-second gap; feeding it
  // straight in would teleport the playhead.
  it('clamps a long stall so the playhead does not jump', () => {
    const { scheduler, player } = setup();
    player.play();
    scheduler.advance(0);
    scheduler.advance(30_000);
    expect(player.getState().time).toBeLessThanOrEqual(64);
  });

  it('ignores a backwards timestamp', () => {
    const scheduler = createManualScheduler(1000);
    const player = createPlayer(doc(), { scheduler, autoplay: true });
    scheduler.tick(1000);
    scheduler.tick(500);
    expect(player.getState().time).toBe(0);
  });
});

describe('end and looping', () => {
  it('stops at the end and reports ended', () => {
    const { scheduler, player } = setup({ duration: 50 });
    player.play();
    scheduler.advance(0);
    scheduler.advance(60);
    expect(player.getState()).toMatchObject({ time: 50, playing: false, ended: true });
  });

  it('calls onEnd once', () => {
    let calls = 0;
    const scheduler = createManualScheduler();
    const player = createPlayer(doc({ duration: 50 }), {
      scheduler,
      autoplay: true,
      onEnd: () => (calls += 1),
    });
    scheduler.advance(0);
    scheduler.advance(60);
    scheduler.advance(60);
    expect(calls).toBe(1);
    expect(player.getState().time).toBe(50);
  });

  it('stops asking for frames once ended', () => {
    const { scheduler, player } = setup({ duration: 50 });
    player.play();
    scheduler.advance(0);
    scheduler.advance(60);
    expect(scheduler.pending).toBe(0);
  });

  it('wraps instead of ending when looping', () => {
    const { scheduler, player } = setup({ duration: 50 }, { loop: true });
    player.play();
    scheduler.advance(0);
    scheduler.advance(60);
    expect(player.getState()).toMatchObject({ time: 10, playing: true, ended: false });
  });

  it('keeps looping across several wraps', () => {
    const { scheduler, player } = setup({ duration: 20 }, { loop: true });
    player.play();
    scheduler.advance(0);
    for (let i = 0; i < 10; i += 1) scheduler.advance(15);
    expect(player.getState().playing).toBe(true);
    expect(player.getState().time).toBeGreaterThanOrEqual(0);
    expect(player.getState().time).toBeLessThan(20);
  });

  it('can switch looping on after construction', () => {
    const { scheduler, player } = setup({ duration: 50 });
    player.setLoop(true);
    player.play();
    scheduler.advance(0);
    scheduler.advance(60);
    expect(player.getState().ended).toBe(false);
  });

  // A play button on a finished animation should start it over, not sit inert.
  it('restarts when played after ending', () => {
    const { scheduler, player } = setup({ duration: 50 });
    player.play();
    scheduler.advance(0);
    scheduler.advance(60);
    player.play();
    expect(player.getState()).toMatchObject({ time: 0, playing: true, ended: false });
  });
});

describe('controls', () => {
  it('pauses and resumes', () => {
    const { scheduler, player } = setup();
    player.play();
    scheduler.advance(0);
    scheduler.advance(16);
    player.pause();
    expect(player.getState().playing).toBe(false);
    scheduler.advance(100);
    expect(player.getState().time).toBe(16);
    player.play();
    scheduler.advance(0);
    scheduler.advance(10);
    expect(player.getState().time).toBe(26);
  });

  // Without dropping the baseline, the paused interval would be counted as elapsed.
  it('does not count paused time when resuming', () => {
    const scheduler = createManualScheduler();
    const player = createPlayer(doc(), { scheduler });
    player.play();
    scheduler.tick(0);
    scheduler.tick(10);
    player.pause();
    player.play();
    scheduler.tick(5000);
    scheduler.tick(5010);
    expect(player.getState().time).toBe(20);
  });

  it('toggles', () => {
    const { player } = setup();
    player.toggle();
    expect(player.getState().playing).toBe(true);
    player.toggle();
    expect(player.getState().playing).toBe(false);
  });

  it('seeks without changing play state', () => {
    const { player } = setup();
    player.seek(400);
    expect(player.getState()).toMatchObject({ time: 400, playing: false });
    player.play();
    player.seek(600);
    expect(player.getState()).toMatchObject({ time: 600, playing: true });
  });

  it('clamps a seek to the duration', () => {
    const { player } = setup();
    player.seek(-100);
    expect(player.getState().time).toBe(0);
    player.seek(99_999);
    expect(player.getState().time).toBe(1000);
  });

  it('clears ended when seeking back from the end', () => {
    const { scheduler, player } = setup({ duration: 50 });
    player.play();
    scheduler.advance(0);
    scheduler.advance(60);
    expect(player.getState().ended).toBe(true);
    player.seek(10);
    expect(player.getState().ended).toBe(false);
  });

  it('restarts to zero', () => {
    const { player } = setup();
    player.seek(700);
    player.restart();
    expect(player.getState()).toMatchObject({ time: 0, ended: false });
  });
});

describe('chapters', () => {
  const chaptered = {
    chapters: [
      { id: 'c1', time: 0 },
      { id: 'c2', time: 500 },
    ],
  };

  it('reports the active chapter index', () => {
    const { player } = setup(chaptered);
    expect(player.getState().chapterIndex).toBe(0);
    player.seek(600);
    expect(player.getState().chapterIndex).toBe(1);
  });

  it('reports -1 before the first chapter', () => {
    const { player } = setup({ chapters: [{ id: 'c', time: 500 }] });
    expect(player.getState().chapterIndex).toBe(-1);
  });
});

describe('subscription', () => {
  it('notifies on change and stops after unsubscribing', () => {
    const { player } = setup();
    const seen: PlayerState[] = [];
    const off = player.subscribe((s) => seen.push(s));
    player.seek(100);
    expect(seen).toHaveLength(1);
    off();
    player.seek(200);
    expect(seen).toHaveLength(1);
  });

  // Reference-equal states would make React re-render on every idle frame.
  it('does not notify when nothing changed', () => {
    const { player } = setup();
    let calls = 0;
    player.subscribe(() => (calls += 1));
    player.seek(100);
    player.seek(100);
    expect(calls).toBe(1);
  });

  it('returns a stable state object between changes', () => {
    const { player } = setup();
    const first = player.getState();
    expect(player.getState()).toBe(first);
    player.seek(10);
    expect(player.getState()).not.toBe(first);
  });

  it('notifies every subscriber', () => {
    const { player } = setup();
    let a = 0;
    let b = 0;
    player.subscribe(() => (a += 1));
    player.subscribe(() => (b += 1));
    player.seek(50);
    expect([a, b]).toEqual([1, 1]);
  });
});

describe('destroy', () => {
  it('stops the clock and drops listeners', () => {
    const { scheduler, player } = setup();
    let calls = 0;
    player.subscribe(() => (calls += 1));
    player.play();
    scheduler.advance(0);
    const before = calls; // play() itself published a state change
    player.destroy();
    expect(scheduler.pending).toBe(0);
    scheduler.advance(100);
    expect(calls).toBe(before);
  });

  it('ignores commands after destruction', () => {
    const { player } = setup();
    player.destroy();
    player.play();
    player.seek(500);
    expect(player.getState()).toMatchObject({ time: 0, playing: false });
  });
});

describe('scheduler defaults', () => {
  // The right default for server rendering: no clock, so nothing throws and no
  // timer leaks.
  it('never advances without a scheduler', () => {
    const player = createPlayer(doc(), { autoplay: true });
    expect(player.getState().playing).toBe(true);
    expect(player.getState().time).toBe(0);
    player.destroy();
  });

  it('exposes a no-op scheduler for explicit use', () => {
    expect(noopScheduler.request(() => {})).toBe(0);
    expect(() => noopScheduler.cancel(0)).not.toThrow();
  });
});

describe('manual scheduler', () => {
  it('serves a re-requested frame on the next tick, like rAF', () => {
    const scheduler = createManualScheduler();
    let runs = 0;
    const loop = (): void => {
      runs += 1;
      if (runs < 3) scheduler.request(loop);
    };
    scheduler.request(loop);
    scheduler.tick(1);
    expect(runs).toBe(1);
    scheduler.tick(2);
    expect(runs).toBe(2);
  });

  it('cancels a pending frame', () => {
    const scheduler = createManualScheduler();
    let ran = false;
    const handle = scheduler.request(() => (ran = true));
    scheduler.cancel(handle);
    scheduler.tick(1);
    expect(ran).toBe(false);
  });

  it('tracks its own clock', () => {
    const scheduler = createManualScheduler(500);
    expect(scheduler.now).toBe(500);
    scheduler.advance(100);
    expect(scheduler.now).toBe(600);
  });
});
