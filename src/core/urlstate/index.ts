// Playback state as a URL.
//
// There is no way to point at a moment in an animation. "Watch the swap about three
// seconds in" makes the reader hunt for it, and sharing the page shares the whole
// thing from the start. The state that would fix this — time, chapter, speed, locale
// — already exists; it simply has no address.
//
// Parsing and formatting are pure and live here so the same rules apply to a link
// written by hand, a link produced by a share button, and a test.

import type { AnimationDocument } from '../schema/document';
import { clamp } from '../timing/ease';

export interface UrlState {
  readonly time?: number;
  /** Chapter id. Preferred over `time` — see `resolveUrlState`. */
  readonly chapter?: string;
  readonly speed?: number;
  readonly locale?: string;
}

/**
 * Parameter names, kept to one or two characters.
 *
 * These links get quoted inside prose, so their length is part of the feature.
 */
export const URL_PARAMS = {
  time: 't',
  chapter: 'c',
  speed: 'speed',
  locale: 'locale',
} as const;

const MIN_SPEED = 0.05;
const MAX_SPEED = 16;

function numberParam(params: URLSearchParams, key: string): number | undefined {
  if (!params.has(key)) return undefined;
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : undefined;
}

/** Read playback state out of a query string. Unknown and malformed values are dropped. */
export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const state: {
    time?: number;
    chapter?: string;
    speed?: number;
    locale?: string;
  } = {};

  const time = numberParam(params, URL_PARAMS.time);
  if (time !== undefined && time >= 0) state.time = Math.round(time);

  const chapter = params.get(URL_PARAMS.chapter);
  if (chapter) state.chapter = chapter;

  const speed = numberParam(params, URL_PARAMS.speed);
  if (speed !== undefined && speed > 0) state.speed = clamp(speed, MIN_SPEED, MAX_SPEED);

  const locale = params.get(URL_PARAMS.locale);
  if (locale) state.locale = locale;

  return state;
}

/**
 * A query string for the state, omitting anything that is already the default.
 *
 * Omission matters: a link that carries `?t=0&speed=1` says nothing while looking
 * like it says something, and these links are meant to be readable in prose.
 */
export function formatUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.chapter) params.set(URL_PARAMS.chapter, state.chapter);
  else if (state.time !== undefined && state.time > 0) {
    params.set(URL_PARAMS.time, String(Math.round(state.time)));
  }
  if (state.speed !== undefined && state.speed !== 1) {
    params.set(URL_PARAMS.speed, String(state.speed));
  }
  if (state.locale) params.set(URL_PARAMS.locale, state.locale);

  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export interface ResolvedUrlState {
  readonly time: number;
  readonly speed?: number;
  readonly locale?: string;
  /** True when the time came from a chapter rather than from `t`. */
  readonly fromChapter: boolean;
}

/**
 * Turn a URL state into a time this document can be seeked to.
 *
 * A chapter wins over an explicit time, and that is the recommendation: edit the
 * animation and every `t=3200` link now points somewhere slightly wrong, while a
 * chapter id still means the moment the author named. A chapter that no longer
 * exists falls back to the time rather than to zero — a link that lands near the
 * right place beats one that silently restarts.
 */
export function resolveUrlState(animation: AnimationDocument, state: UrlState): ResolvedUrlState {
  const chapter = state.chapter
    ? animation.chapters.find((candidate) => candidate.id === state.chapter)
    : undefined;

  const time = chapter
    ? chapter.time
    : state.time !== undefined
      ? clamp(state.time, 0, animation.duration)
      : 0;

  return {
    time: clamp(time, 0, animation.duration),
    speed: state.speed,
    locale: state.locale,
    fromChapter: chapter !== undefined,
  };
}

/**
 * The state to put in a link for the current moment.
 *
 * Prefers the chapter containing `time`, because that is the form that survives the
 * document being edited.
 */
export function urlStateFor(
  animation: AnimationDocument,
  time: number,
  options: {
    readonly speed?: number;
    readonly locale?: string;
    readonly preferChapter?: boolean;
  } = {},
): UrlState {
  const preferChapter = options.preferChapter ?? true;
  const containing = preferChapter
    ? [...animation.chapters]
        .sort((a, b) => b.time - a.time)
        .find((chapter) => chapter.time <= time)
    : undefined;

  return {
    ...(containing ? { chapter: containing.id } : { time: Math.round(time) }),
    ...(options.speed !== undefined && options.speed !== 1 ? { speed: options.speed } : {}),
    ...(options.locale ? { locale: options.locale } : {}),
  };
}
