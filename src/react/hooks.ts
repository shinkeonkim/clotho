// React bindings for the core player and for the browser conditions that gate it.
//
// `usePlayer` is the whole binding: `useSyncExternalStore` over the controller's
// subscription. That is the payoff of extracting playback from the component —
// legacy's version was a rAF loop, a ref, and four effects tangled with the render.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AnimationDocument } from '../core/schema/document';
import {
  createPlayer,
  type Player,
  type PlayerOptions,
  type PlayerState,
} from '../core/player/create-player';
import { animationFrameScheduler } from '../dom/scheduler';

/**
 * Create a player for `doc` and subscribe to it.
 *
 * The player is recreated only when the document identity or duration changes.
 * Legacy re-ran its effect on the whole `def` object, which restarted playback
 * whenever a parent re-rendered with a fresh object.
 */
export function usePlayer(
  doc: AnimationDocument,
  options: Omit<PlayerOptions, 'scheduler'> = {},
): { player: Player; state: PlayerState } {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const player = useMemo(
    () =>
      createPlayer(doc, {
        scheduler: animationFrameScheduler,
        ...optionsRef.current,
        // Read through the ref so a new inline callback does not rebuild the player.
        onEnd: () => optionsRef.current.onEnd?.(),
      }),
    // Deliberately keyed on document identity rather than the object: legacy
    // depended on the whole `def`, so any parent re-render with a fresh object
    // restarted playback from zero.
    [doc.id, doc.duration],
  );

  useEffect(() => () => player.destroy(), [player]);

  const state = useSyncExternalStore(
    useCallback((onChange) => player.subscribe(onChange), [player]),
    () => player.getState(),
    () => player.getState(),
  );

  return { player, state };
}

/** True when the reader has asked for reduced motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return;
    const query = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** Resolve the host page's current color scheme before falling back to OS preference. */
export function useHostTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    const resolve = (): void => {
      const scheme = globalThis.getComputedStyle?.(document.documentElement).colorScheme;
      if (scheme?.split(/\s+/).includes('dark') && !scheme.split(/\s+/).includes('light')) {
        setTheme('dark');
      } else if (scheme?.split(/\s+/).includes('light')) {
        setTheme('light');
      } else {
        setTheme(media?.matches ? 'dark' : 'light');
      }
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    media?.addEventListener('change', resolve);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', resolve);
    };
  }, []);

  return theme;
}

/**
 * Whether `ref`'s element is on screen.
 *
 * Defaults to true so an animation is not stuck paused in an environment without
 * IntersectionObserver.
 */
export function useInView(ref: React.RefObject<Element | null>, threshold = 0.1): boolean {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold]);

  return inView;
}

/** Fullscreen state for `ref`'s element, with a toggle. */
export function useFullscreen(ref: React.RefObject<Element | null>): {
  isFullscreen: boolean;
  toggle: () => void;
} {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = (): void => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);

  const toggle = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    if (document.fullscreenElement === element) void document.exitFullscreen();
    // Fullscreen can be refused (permissions, an iframe without allowfullscreen);
    // swallowing the rejection keeps a denied request from surfacing as an unhandled
    // promise error.
    else void element.requestFullscreen?.().catch(() => {});
  }, [ref]);

  return { isFullscreen, toggle };
}
