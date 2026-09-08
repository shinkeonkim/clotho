// URL binding tests.
//
// The binding runs against a fake location and history so the rules can be checked
// without a browser — and the rule that matters most is negative: the URL is not
// touched while the animation plays.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../src/core/schema/document';
import { createPlayer } from '../src/core/player/create-player';
import { createManualScheduler } from '../src/core/player/scheduler';
import { bindUrlState, shareUrl } from '../src/dom/urlstate';

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'doc',
  duration: 10_000,
  chapters: [
    { id: 'setup', time: 0 },
    { id: 'swap', time: 3000 },
  ],
});

function harness(search = '') {
  const location = { search, pathname: '/animations/knapsack' };
  const written: string[] = [];
  const history = {
    replaceState(_data: unknown, _title: string, url: string) {
      written.push(url);
    },
  };
  const scheduler = createManualScheduler();
  const player = createPlayer(doc, { scheduler, autoplay: false });
  return { location, history, written, player, scheduler };
}

describe('reading the URL', () => {
  it('seeks to the time in the link', () => {
    const { player, location, history } = harness('?t=4200');
    bindUrlState(player, doc, { location, history });
    expect(player.getState().time).toBe(4200);
  });

  it('seeks to the chapter in the link', () => {
    const { player, location, history } = harness('?c=swap');
    bindUrlState(player, doc, { location, history });
    expect(player.getState().time).toBe(3000);
  });

  /** A link to a moment is a request to look at it, not to watch it run away. */
  it('pauses on arrival at a deep link', () => {
    const { player, location, history } = harness('?t=4200');
    player.play();
    bindUrlState(player, doc, { location, history });
    expect(player.getState().playing).toBe(false);
  });

  it('applies a speed from the link', () => {
    const { player, location, history } = harness('?speed=2');
    bindUrlState(player, doc, { location, history });
    expect(player.getState().speed).toBe(2);
  });

  it('leaves a bare URL alone', () => {
    const { player, location, history, written } = harness();
    bindUrlState(player, doc, { location, history });
    expect(player.getState().time).toBe(0);
    expect(written).toEqual([]);
  });
});

describe('writing the URL', () => {
  it('records a seek', () => {
    const { player, location, history, written } = harness();
    bindUrlState(player, doc, { location, history });
    player.seek(3500);
    expect(written).toEqual(['/animations/knapsack?c=swap']);
  });

  it('records a pause', () => {
    const { player, location, history, written } = harness();
    bindUrlState(player, doc, { location, history });
    player.play();
    player.seek(3500);
    player.pause();
    expect(written.at(-1)).toBe('/animations/knapsack?c=swap');
  });

  it('records a speed change', () => {
    const { player, location, history, written } = harness();
    bindUrlState(player, doc, { location, history });
    player.setSpeed(2);
    expect(written.at(-1)).toContain('speed=2');
  });

  /**
   * The rule that keeps this from being unbearable: while the clock runs, `time`
   * changes every frame and none of those is something the reader asked to record.
   */
  it('writes nothing while the animation plays', () => {
    const { player, location, history, written, scheduler } = harness();
    bindUrlState(player, doc, { location, history });
    player.play();
    for (let frame = 1; frame <= 20; frame += 1) scheduler.advance(16);
    expect(written).toEqual([]);
  });

  it('does not rewrite the same URL twice', () => {
    const { player, location, history, written } = harness();
    bindUrlState(player, doc, { location, history });
    player.seek(3500);
    player.seek(3600);
    // Both land in the same chapter, so the link does not change.
    expect(written).toHaveLength(1);
  });

  it('stops writing once unbound', () => {
    const { player, location, history, written } = harness();
    const unbind = bindUrlState(player, doc, { location, history });
    unbind();
    player.seek(3500);
    expect(written).toEqual([]);
  });
});

describe('shareUrl', () => {
  it('builds a link to the current moment', () => {
    const { player, location, history } = harness();
    bindUrlState(player, doc, { location, history });
    player.seek(3500);
    expect(shareUrl(player, doc, { location, history, base: 'https://x.test/a' })).toBe(
      'https://x.test/a?c=swap',
    );
  });

  it('falls back to a timestamp before the first chapter has a name', () => {
    const plain = animationDocumentSchema.parse({ clothoVersion: 1, id: 'p', duration: 1000 });
    const scheduler = createManualScheduler();
    const player = createPlayer(plain, { scheduler, autoplay: false });
    player.seek(400);
    expect(shareUrl(player, plain, { base: 'https://x.test/a' })).toBe('https://x.test/a?t=400');
  });
});
