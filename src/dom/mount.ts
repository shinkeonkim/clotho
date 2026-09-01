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
import { appendAnnotationText, bindAnnotations } from './annotations';
import { createInteractionSession } from '../core/interactions/session';

export interface MountOptions extends SceneOptions {
  readonly player?: Omit<PlayerOptions, 'scheduler'> & { scheduler?: PlayerOptions['scheduler'] };
  /** UI text, for localization. Defaults to English. */
  readonly strings?: Partial<Strings>;
  /** Force the built-in UI palette, or leave it to prefers-color-scheme. */
  readonly theme?: 'auto' | 'light' | 'dark';
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
  if (options.theme && options.theme !== 'auto') root.dataset.clothTheme = options.theme;

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
  const unbindAnnotations = bindAnnotations(root);

  const engine = document.createElement('div');
  engine.className = `${CLASS.engine}${doc.settings.showChapterList && doc.chapters.length > 0 ? ` ${CLASS.engineWithList}` : ''}`;
  engine.dataset.chapterListPosition = doc.settings.chapterListPosition;
  body.append(engine);

  const engineStage = document.createElement('div');
  engineStage.className = CLASS.stage;
  engine.append(engineStage);

  const stage = mountStage(engineStage, doc, options);
  const { player } = stage;
  const interaction = createInteractionSession(doc, player);
  const checkpointPanel = document.createElement('section');
  checkpointPanel.className = CLASS.checkpoint;
  checkpointPanel.hidden = true;
  checkpointPanel.setAttribute('aria-live', 'polite');
  body.append(checkpointPanel);

  const renderCheckpoint = (): void => {
    const { pending, answers } = interaction.getState();
    checkpointPanel.replaceChildren();
    checkpointPanel.hidden = !pending;
    if (!pending) return;
    const prompt = document.createElement('p');
    prompt.className = CLASS.checkpointPrompt;
    prompt.textContent = pending.prompt;
    checkpointPanel.append(prompt);
    const answer = answers[pending.id];
    if (pending.interaction === 'choice') {
      const choices = document.createElement('div');
      choices.className = CLASS.checkpointChoices;
      pending.options.forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option.label;
        button.dataset.value = option.value;
        button.addEventListener('click', () => interaction.answer(option.value));
        choices.append(button);
      });
      checkpointPanel.append(choices);
    } else if (pending.interaction === 'number-input') {
      const input = document.createElement('input');
      input.type = 'number';
      if (pending.min !== undefined) input.min = String(pending.min);
      if (pending.max !== undefined) input.max = String(pending.max);
      if (pending.step !== undefined) input.step = String(pending.step);
      input.addEventListener('change', () => interaction.answer(Number(input.value)));
      checkpointPanel.append(input);
    } else if (pending.interaction === 'select-element') {
      const hint = document.createElement('p');
      hint.textContent = strings.selectElement;
      checkpointPanel.append(hint);
    }
    if (answer?.correct !== undefined) {
      const result = document.createElement('p');
      result.className = CLASS.checkpointResult;
      result.dataset.correct = String(answer.correct);
      result.textContent = answer.correct ? strings.correctAnswer : strings.incorrectAnswer;
      checkpointPanel.append(result);
    }
    const continueButton = document.createElement('button');
    continueButton.type = 'button';
    continueButton.className = CLASS.button;
    continueButton.textContent = strings.continueCheckpoint;
    continueButton.disabled =
      pending.required && pending.interaction !== 'continue' && answer === undefined;
    continueButton.addEventListener('click', () => interaction.continue());
    checkpointPanel.append(continueButton);
  };
  const unsubscribeInteraction = interaction.subscribe(renderCheckpoint);
  renderCheckpoint();
  const selectCheckpointElement = (event: Event): void => {
    const pending = interaction.getState().pending;
    if (pending?.interaction !== 'select-element' || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-clotho-id]');
    const id = target?.dataset.clothoId;
    if (id && pending.elementIds.includes(id)) interaction.answer(id);
  };
  root.addEventListener('click', selectCheckpointElement);

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
  restartButton.addEventListener('click', () => {
    player.restart();
    userWantsPlayback = true;
    applyPlayback();
  });
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

  const step =
    doc.settings.showCaption && doc.chapters.length > 0 ? document.createElement('div') : null;
  if (step) {
    step.className = `${CLASS.caption} ${CLASS.step}`;
    step.setAttribute('aria-live', 'polite');
    engineStage.append(step);
  }

  const chapterItems: HTMLLIElement[] = [];
  if (doc.settings.showChapterList && doc.chapters.length > 0) {
    const aside = document.createElement('aside');
    aside.className = CLASS.stepList;
    aside.setAttribute('aria-label', strings.chapters);
    const list = document.createElement('ol');
    for (const [index, chapter] of [...doc.chapters].sort((a, b) => a.time - b.time).entries()) {
      const item = document.createElement('li');
      item.className = CLASS.stepListItem;
      item.innerHTML = `<span class="cloth-step-list-num">${index + 1}</span><div class="cloth-step-list-body"><span class="cloth-step-list-label"></span><span class="cloth-step-list-subtitle"></span></div>`;
      appendAnnotationText(
        item.querySelector<HTMLElement>('.cloth-step-list-label')!,
        chapter.label || chapter.id,
        chapter.references,
      );
      const subtitle = item.querySelector<HTMLElement>('.cloth-step-list-subtitle')!;
      appendAnnotationText(subtitle, chapter.subtitle, chapter.references);
      subtitle.hidden = !chapter.subtitle;
      list.append(item);
      chapterItems.push(item);
    }
    aside.append(list);
    engine.append(aside);
  }

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

    if (step) {
      const scene = buildScene(doc, state.time, options);
      const active = scene.chapter ?? { index: 0, chapter: scene.chapters[0]! };
      step.replaceChildren(
        document.createTextNode(strings.chapterLabel(active.index + 1, scene.chapters.length)),
      );
      if (active.chapter.label) {
        step.append(document.createTextNode(', '));
        const label = document.createElement('span');
        appendAnnotationText(label, active.chapter.label, active.chapter.references);
        step.append(label);
      }
    }
    const activeIndex = buildScene(doc, state.time, options).chapter?.index ?? 0;
    chapterItems.forEach((item, index) => {
      item.classList.toggle('is-current', index === activeIndex);
      if (index === activeIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
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
      root.removeEventListener('click', selectCheckpointElement);
      unsubscribeInteraction();
      interaction.destroy();
      unbindAnnotations();
      unsubscribe();
      for (const observer of observers) observer.disconnect();
      mediaQuery?.removeEventListener('change', onMotionChange);
      stage.destroy();
      root.remove();
    },
  };
}
