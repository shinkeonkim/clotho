// Keeping the address bar in step with the player.
//
// Two rules do most of the work here, and both are about not being annoying.
//
// The URL is written on *user actions* only — a pause, a seek, a chapter jump —
// never on the frame clock. Writing sixty times a second would be pointless even
// with `replaceState`, and with `pushState` it would fill the reader's history with
// an animation.
//
// And the link prefers a chapter over a timestamp, so it keeps meaning the same
// thing after the document is edited.

import type { AnimationDocument } from '../core/schema/document';
import type { Player } from '../core/player/create-player';
import {
  formatUrlState,
  parseUrlState,
  resolveUrlState,
  urlStateFor,
  type UrlState,
} from '../core/urlstate';

export interface UrlStateOptions {
  /** Where to read from and write to. Defaults to the address bar. */
  readonly location?: { search: string; pathname: string };
  readonly history?: { replaceState(data: unknown, title: string, url: string): void };
  /** Prefer `?c=<chapter>` over `?t=<ms>`. On by default. */
  readonly preferChapter?: boolean;
  /** Locale to record, when the host has one. */
  readonly locale?: string;
}

/**
 * Apply the URL's state to a player, and keep the URL current afterwards.
 *
 * Returns an unbind function; a caller that mounts and unmounts players — a
 * single-page app, a test — must be able to stop it writing.
 */
export function bindUrlState(
  player: Player,
  animation: AnimationDocument,
  options: UrlStateOptions = {},
): () => void {
  const location = options.location ?? globalThis.location;
  const history = options.history ?? globalThis.history;
  if (!location || !history) return () => {};

  const initial = resolveUrlState(animation, parseUrlState(location.search));
  if (initial.time > 0) {
    player.seek(initial.time);
    // A link to a specific moment is a request to look at it, not to watch the
    // animation run away from it.
    player.pause();
  }
  if (initial.speed !== undefined) player.setSpeed(initial.speed);

  let previous = player.getState();
  let lastWritten = location.search;

  const write = (state: UrlState): void => {
    const search = formatUrlState(state);
    if (search === lastWritten) return;
    lastWritten = search;
    // `replaceState`, never `pushState`: the reader pressing back should leave the
    // page, not step through the animation one seek at a time.
    history.replaceState(null, '', `${location.pathname}${search}`);
  };

  const unsubscribe = player.subscribe((state) => {
    const seeked = !state.playing && !previous.playing && state.time !== previous.time;
    const paused = previous.playing && !state.playing;
    const speedChanged = state.speed !== previous.speed;
    previous = state;

    // Only deliberate acts. While the clock runs, `time` changes every frame and
    // none of those changes is something the reader asked to record.
    if (!seeked && !paused && !speedChanged) return;

    write(
      urlStateFor(animation, state.time, {
        speed: state.speed,
        locale: options.locale,
        preferChapter: options.preferChapter,
      }),
    );
  });

  return unsubscribe;
}

/**
 * A shareable link to the moment a player is at.
 *
 * For a "copy link to here" control, which is the thing that makes the feature
 * visible to a reader who would never construct a query string.
 */
export function shareUrl(
  player: Player,
  animation: AnimationDocument,
  options: UrlStateOptions & { readonly base?: string } = {},
): string {
  const location = options.location ?? globalThis.location;
  const base =
    options.base ??
    (typeof globalThis.location === 'undefined'
      ? ''
      : `${globalThis.location.origin}${location?.pathname ?? ''}`);

  const state = urlStateFor(animation, player.getState().time, {
    speed: player.getState().speed,
    locale: options.locale,
    preferChapter: options.preferChapter,
  });
  return `${base}${formatUrlState(state)}`;
}
