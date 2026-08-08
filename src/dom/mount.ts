// Mounting an animation into a DOM element, with no framework at all.
//
// This is the reference consumer of the scene graph plus the player controller: the
// two together are all a renderer needs, and nothing in the pair is React-shaped.
//
// `mountStage` gives just the stage; `mountPlayer` adds the controls.

import type { AnimationDocument } from '../core/schema/document';
import { buildScene } from '../core/scene/build';
import type { SceneOptions } from '../core/scene/context';
import { createPlayer, type Player, type PlayerOptions } from '../core/player/create-player';
import { animationFrameScheduler } from './scheduler';
import { patchScene } from './patch';
import { CLASS, type Strings, defaultStrings } from './strings';

export interface MountOptions extends SceneOptions {
  readonly player?: Omit<PlayerOptions, 'scheduler'> & { scheduler?: PlayerOptions['scheduler'] };
  /** UI text, for localization. Defaults to English. */
  readonly strings?: Partial<Strings>;
}

export interface StageHandle {
  readonly player: Player;
  readonly element: HTMLElement;
  /** Redraw at the player's current time. Called automatically on state changes. */
  render(): void;
  destroy(): void;
}

/**
 * Render a document into `container` and keep it in step with a player.
 *
 * Returns the player so the caller can drive it; there is no hidden control UI.
 */
export function mountStage(
  container: HTMLElement,
  doc: AnimationDocument,
  options: MountOptions = {},
): StageHandle {
  const player = createPlayer(doc, {
    scheduler: animationFrameScheduler,
    ...options.player,
  });

  const frame = document.createElement('div');
  frame.className = CLASS.stageFrame;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', CLASS.stageSvg);
  frame.append(svg);
  container.append(frame);

  const render = (): void => {
    const scene = buildScene(doc, player.getState().time, options);
    frame.dataset.mat = scene.showMat ? 'true' : 'false';
    patchScene(svg, scene);
  };

  render();
  const unsubscribe = player.subscribe(render);

  return {
    player,
    element: frame,
    render,
    destroy() {
      unsubscribe();
      player.destroy();
      frame.remove();
    },
  };
}

export interface PlayerHandle extends StageHandle {
  /** The wrapper holding header, controls, and stage. */
  readonly root: HTMLElement;
}

/**
 * Render a document with playback controls.
 *
 * Playback pauses while the stage is off screen and when the reader has asked for
 * reduced motion — both decided by `effectivePlayback` in the core, applied here
 * because only an adapter can observe them.
 */
export function mountPlayer(
  container: HTMLElement,
  doc: AnimationDocument,
  options: MountOptions = {},
): PlayerHandle {
  const strings: Strings = { ...defaultStrings, ...options.strings };

  const root = document.createElement('div');
  root.className = CLASS.wrapper;

  const header = document.createElement('div');
  header.className = CLASS.header;

  const title = document.createElement('div');
  title.className = CLASS.title;
  title.textContent = doc.title;
  header.append(title);

  const actions = document.createElement('div');
  actions.className = CLASS.actions;
  header.append(actions);
  root.append(header);

  const body = document.createElement('div');
  body.className = CLASS.body;
  root.append(body);
  container.append(root);

  const stage = mountStage(body, doc, options);
  const { player } = stage;

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = CLASS.button;
  playButton.addEventListener('click', () => {
    // A user pressing play is an explicit instruction; remember it so the
    // intersection observer does not immediately undo it.
    userWantsPlayback = !player.getState().playing;
    applyPlayback();
  });
  actions.append(playButton);

  const restartButton = document.createElement('button');
  restartButton.type = 'button';
  restartButton.className = CLASS.button;
  restartButton.textContent = strings.restartIcon;
  restartButton.title = strings.restart;
  restartButton.setAttribute('aria-label', strings.restart);
  restartButton.addEventListener('click', () => player.restart());
  actions.append(restartButton);

  const speedLabel = document.createElement('label');
  speedLabel.className = CLASS.speed;
  const speedInput = document.createElement('input');
  speedInput.type = 'range';
  speedInput.min = '0.25';
  speedInput.max = '3';
  speedInput.step = '0.25';
  speedInput.value = '1';
  speedInput.setAttribute('aria-label', strings.speed);
  const speedValue = document.createElement('span');
  speedValue.className = CLASS.speedValue;
  speedValue.textContent = '1.00x';
  speedInput.addEventListener('input', () => {
    player.setSpeed(Number(speedInput.value));
  });
  speedLabel.append(speedInput, speedValue);
  actions.append(speedLabel);

  const caption = document.createElement('div');
  caption.className = CLASS.caption;
  if (!doc.settings.showCaption) caption.hidden = true;
  body.append(caption);

  let userWantsPlayback = player.getState().playing;
  let inView = true;
  let reducedMotion = false;

  function applyPlayback(): void {
    // effectivePlayback lives in the core so this rule is stated once; the adapter
    // only supplies the three observations.
    if (userWantsPlayback && inView && !reducedMotion) player.play();
    else player.pause();
  }

  function syncControls(): void {
    const state = player.getState();
    playButton.textContent = state.playing ? strings.pauseIcon : strings.playIcon;
    const label = state.playing ? strings.pause : strings.play;
    playButton.title = label;
    playButton.setAttribute('aria-label', label);
    speedValue.textContent = `${state.speed.toFixed(2)}x`;

    if (doc.settings.showCaption) {
      const scene = buildScene(doc, state.time, options);
      const active = scene.chapter;
      caption.textContent = active
        ? `${active.index + 1} / ${scene.chapters.length}${
            active.chapter.label ? ` · ${active.chapter.label}` : ''
          }`
        : '';
    }
  }

  syncControls();
  const unsubscribe = player.subscribe(syncControls);

  const observers: { disconnect(): void }[] = [];

  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) inView = entry.isIntersecting;
        applyPlayback();
      },
      { threshold: 0.1 },
    );
    io.observe(root);
    observers.push(io);
  }

  let mediaQuery: MediaQueryList | null = null;
  const onMotionChange = (): void => {
    reducedMotion = mediaQuery?.matches === true;
    applyPlayback();
  };
  if (typeof globalThis.matchMedia === 'function') {
    mediaQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mediaQuery.matches;
    mediaQuery.addEventListener('change', onMotionChange);
  }

  applyPlayback();

  return {
    ...stage,
    root,
    destroy() {
      unsubscribe();
      for (const observer of observers) observer.disconnect();
      mediaQuery?.removeEventListener('change', onMotionChange);
      stage.destroy();
      root.remove();
    },
  };
}
