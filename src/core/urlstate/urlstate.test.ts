// URL state tests.
//
// Two behaviours carry the feature: a link stays short (because it gets quoted in
// prose), and a chapter link keeps meaning the same thing after the document is
// edited.

import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../schema/document';
import type { AnimationDocument } from '../schema/document';
import { formatUrlState, parseUrlState, resolveUrlState, urlStateFor } from './index';

function animation(chapters: { id: string; time: number }[] = []): AnimationDocument {
  return animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'doc',
    duration: 10_000,
    chapters,
  });
}

const chaptered = animation([
  { id: 'setup', time: 0 },
  { id: 'swap', time: 3000 },
  { id: 'done', time: 8000 },
]);

describe('parseUrlState', () => {
  it('reads every parameter', () => {
    expect(parseUrlState('?t=3200&speed=1.5&locale=ko')).toEqual({
      time: 3200,
      speed: 1.5,
      locale: 'ko',
    });
  });

  it('works with or without the leading question mark', () => {
    expect(parseUrlState('t=100')).toEqual(parseUrlState('?t=100'));
  });

  it('is empty for a bare URL', () => {
    expect(parseUrlState('')).toEqual({});
  });

  it('drops values that are not numbers', () => {
    expect(parseUrlState('?t=soon&speed=fast')).toEqual({});
  });

  it('drops a negative time and a non-positive speed', () => {
    expect(parseUrlState('?t=-5&speed=0')).toEqual({});
  });

  it('clamps an absurd speed rather than honouring it', () => {
    expect(parseUrlState('?speed=999').speed).toBe(16);
  });

  it('ignores parameters it does not know', () => {
    expect(parseUrlState('?utm_source=x&t=50')).toEqual({ time: 50 });
  });
});

describe('formatUrlState', () => {
  it('omits everything that is already the default', () => {
    // A link carrying ?t=0&speed=1 says nothing while looking like it says something.
    expect(formatUrlState({ time: 0, speed: 1 })).toBe('');
    expect(formatUrlState({})).toBe('');
  });

  it('writes a chapter instead of a time when it has one', () => {
    expect(formatUrlState({ chapter: 'swap', time: 3200 })).toBe('?c=swap');
  });

  it('writes speed and locale when they are not the default', () => {
    expect(formatUrlState({ time: 100, speed: 2, locale: 'ko' })).toBe('?t=100&speed=2&locale=ko');
  });

  it('round-trips through the parser', () => {
    const state = { time: 3200, speed: 1.5, locale: 'ko' };
    expect(parseUrlState(formatUrlState(state))).toEqual(state);
  });
});

describe('resolveUrlState', () => {
  it('uses the chapter over the time, which is why chapters are recommended', () => {
    const resolved = resolveUrlState(chaptered, { chapter: 'swap', time: 9999 });
    expect(resolved.time).toBe(3000);
    expect(resolved.fromChapter).toBe(true);
  });

  /** An edited document should not turn a shared link into a restart. */
  it('falls back to the time when the chapter is gone', () => {
    const resolved = resolveUrlState(chaptered, { chapter: 'removed', time: 4200 });
    expect(resolved.time).toBe(4200);
    expect(resolved.fromChapter).toBe(false);
  });

  it('clamps a time past the end of the document', () => {
    expect(resolveUrlState(chaptered, { time: 99_000 }).time).toBe(10_000);
  });

  it('is zero with nothing to go on', () => {
    expect(resolveUrlState(chaptered, {}).time).toBe(0);
  });
});

describe('urlStateFor', () => {
  it('names the chapter the time falls inside', () => {
    expect(urlStateFor(chaptered, 3500)).toEqual({ chapter: 'swap' });
    expect(urlStateFor(chaptered, 9000)).toEqual({ chapter: 'done' });
  });

  it('uses a raw time when asked not to prefer chapters', () => {
    expect(urlStateFor(chaptered, 3500, { preferChapter: false })).toEqual({ time: 3500 });
  });

  it('uses a raw time when the document has no chapters', () => {
    expect(urlStateFor(animation(), 3500)).toEqual({ time: 3500 });
  });

  it('omits a speed of one, since it is what everybody already has', () => {
    expect(urlStateFor(chaptered, 100, { speed: 1 })).not.toHaveProperty('speed');
    expect(urlStateFor(chaptered, 100, { speed: 2 }).speed).toBe(2);
  });

  it('produces a link that resolves back to the same chapter', () => {
    const link = formatUrlState(urlStateFor(chaptered, 3500));
    expect(resolveUrlState(chaptered, parseUrlState(link)).time).toBe(3000);
  });
});
