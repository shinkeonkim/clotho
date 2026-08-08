// The React player: stage, controls, caption.
//
// Rebuilt on the scene graph and the core player rather than ported line by line, but
// the behavior legacy had is kept: pause when off screen, respect reduced motion,
// speed slider, restart, chapter caption. What changed is where the logic lives — the
// component now only observes the browser and renders.

import { createElement, useCallback, useMemo, useRef, type ReactElement } from 'react';
import type { AnimationDocument } from '../core/schema/document';
import { buildScene } from '../core/scene/build';
import type { SceneOptions } from '../core/scene/context';
import { effectivePlayback } from '../core/timing/playback';
import { CLASS, defaultStrings, type Strings } from '../dom/strings';
import { SceneSvg } from './scene';
import { useInView, usePlayer, useReducedMotion } from './hooks';

export interface AnimationStageProps {
  readonly doc: AnimationDocument;
  readonly time: number;
  readonly options?: SceneOptions;
  readonly className?: string;
}

/**
 * A single frame, with no clock of its own.
 *
 * Useful for a thumbnail, a static frame, or an editor that owns the time itself.
 */
export function AnimationStage({
  doc,
  time,
  options,
  className,
}: AnimationStageProps): ReactElement {
  const scene = useMemo(() => buildScene(doc, time, options), [doc, time, options]);
  return createElement(
    'div',
    { className: CLASS.stageFrame, 'data-mat': scene.showMat ? 'true' : 'false' },
    createElement(SceneSvg, { scene, className: className ?? CLASS.stageSvg }),
  );
}

export interface AnimationPlayerProps {
  readonly doc: AnimationDocument;
  readonly options?: SceneOptions;
  /** UI text overrides. Defaults to English. */
  readonly strings?: Partial<Strings>;
  /** Hide the built-in controls when the host provides its own. */
  readonly hideControls?: boolean;
  readonly className?: string;
}

export function AnimationPlayer({
  doc,
  options,
  strings: stringOverrides,
  hideControls = false,
  className,
}: AnimationPlayerProps): ReactElement {
  const strings: Strings = { ...defaultStrings, ...stringOverrides };
  const rootRef = useRef<HTMLDivElement>(null);

  const { player, state } = usePlayer(doc);
  const reducedMotion = useReducedMotion();
  const inView = useInView(rootRef);

  // The core decides the rule; the component only supplies the observations.
  const shouldRun = effectivePlayback(state.playing, inView, reducedMotion);
  if (shouldRun !== state.playing) {
    // Reconciling during render would be a side effect; the player publishes
    // asynchronously so this is safe to call from an event-free path.
    if (shouldRun) player.play();
    else player.pause();
  }

  const scene = useMemo(() => buildScene(doc, state.time, options), [doc, state.time, options]);

  const onSpeedChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => player.setSpeed(Number(event.target.value)),
    [player],
  );

  if (reducedMotion) {
    return createElement(
      'div',
      { ref: rootRef, className: `${CLASS.wrapper}${className ? ` ${className}` : ''}` },
      createElement(
        'div',
        { className: CLASS.reduced },
        createElement('p', null, createElement('strong', null, doc.title)),
        doc.description ? createElement('p', null, doc.description) : null,
        createElement('p', { className: 'cloth-wrapper-reduced-note' }, strings.reducedMotionNote),
      ),
    );
  }

  return createElement(
    'div',
    { ref: rootRef, className: `${CLASS.wrapper}${className ? ` ${className}` : ''}` },
    createElement(
      'div',
      { className: CLASS.header },
      createElement('div', { className: CLASS.title }, doc.title),
      hideControls
        ? null
        : createElement(
            'div',
            { className: CLASS.actions },
            createElement(
              'button',
              {
                type: 'button',
                className: CLASS.button,
                onClick: () => player.toggle(),
                title: state.playing ? strings.pause : strings.play,
                'aria-label': state.playing ? strings.pause : strings.play,
              },
              state.playing ? strings.pauseIcon : strings.playIcon,
            ),
            createElement(
              'button',
              {
                type: 'button',
                className: CLASS.button,
                onClick: () => player.restart(),
                title: strings.restart,
                'aria-label': strings.restart,
              },
              strings.restartIcon,
            ),
            createElement(
              'label',
              { className: CLASS.speed, title: strings.speed },
              createElement('input', {
                type: 'range',
                min: 0.25,
                max: 3,
                step: 0.25,
                value: state.speed,
                onChange: onSpeedChange,
                'aria-label': strings.speed,
              }),
              createElement('span', { className: CLASS.speedValue }, `${state.speed.toFixed(2)}x`),
            ),
          ),
    ),
    createElement(
      'div',
      { className: CLASS.body },
      createElement(
        'div',
        { className: CLASS.stageFrame, 'data-mat': scene.showMat ? 'true' : 'false' },
        createElement(SceneSvg, { scene, className: CLASS.stageSvg }),
      ),
      doc.settings.showCaption && scene.chapter
        ? createElement(
            'div',
            { className: CLASS.caption },
            createElement(
              'span',
              { className: CLASS.captionNum },
              strings.chapterLabel(scene.chapter.index + 1, scene.chapters.length),
            ),
            scene.chapter.chapter.label
              ? createElement(
                  'span',
                  { className: CLASS.captionLabel },
                  scene.chapter.chapter.label,
                )
              : null,
          )
        : null,
    ),
  );
}

export default AnimationPlayer;
