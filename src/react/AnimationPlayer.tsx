// The React player: stage, controls, caption.
//
// Rebuilt on the scene graph and the core player rather than ported line by line, but
// the behavior legacy had is kept: pause when off screen, respect reduced motion,
// speed slider, restart, chapter caption. What changed is where the logic lives — the
// component now only observes the browser and renders.

import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
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
  readonly theme?: 'auto' | 'light' | 'dark';
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
  theme = 'auto',
}: AnimationStageProps): ReactElement {
  const scene = useMemo(() => buildScene(doc, time, options), [doc, time, options]);
  return createElement(
    'div',
    {
      className: CLASS.stageFrame,
      'data-mat': scene.showMat ? 'true' : 'false',
      'data-cloth-theme': theme === 'auto' ? undefined : theme,
    },
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
  /** Force light/dark UI tokens, or follow prefers-color-scheme. */
  readonly theme?: 'auto' | 'light' | 'dark';
}

export function AnimationPlayer({
  doc,
  options,
  strings: stringOverrides,
  hideControls = false,
  className,
  theme = 'auto',
}: AnimationPlayerProps): ReactElement {
  const strings: Strings = { ...defaultStrings, ...stringOverrides };
  const rootRef = useRef<HTMLDivElement>(null);

  const { player, state } = usePlayer(doc);
  const reducedMotion = useReducedMotion();
  const inView = useInView(rootRef);

  /**
   * What the viewer asked for, tracked separately from whether the clock is running.
   *
   * Conflating the two breaks in both directions: scrolling away would look like the
   * viewer pressing pause (so it never resumes), and pressing pause while off screen
   * would be undone the moment it scrolls back. The DOM and Vue adapters keep the same
   * split.
   */
  const [userWantsPlayback, setUserWantsPlayback] = useState(doc.settings.autoplay);

  // Applying the rule in an effect, not during render: play/pause mutate the player and
  // start a frame loop, which a render pass must not do.
  useEffect(() => {
    if (effectivePlayback(userWantsPlayback, inView, reducedMotion)) player.play();
    else player.pause();
  }, [player, userWantsPlayback, inView, reducedMotion]);

  const scene = useMemo(() => buildScene(doc, state.time, options), [doc, state.time, options]);

  const onSpeedChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => player.setSpeed(Number(event.target.value)),
    [player],
  );

  if (reducedMotion) {
    return createElement(
      'div',
      {
        ref: rootRef,
        className: `${CLASS.wrapper}${className ? ` ${className}` : ''}`,
        'data-cloth-theme': theme === 'auto' ? undefined : theme,
      },
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
    {
      ref: rootRef,
      className: `${CLASS.wrapper}${className ? ` ${className}` : ''}`,
      'data-cloth-theme': theme === 'auto' ? undefined : theme,
    },
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
                onClick: () => setUserWantsPlayback((wanted) => !wanted),
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
                onClick: () => {
                  player.restart();
                  setUserWantsPlayback(true);
                },
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
        {
          className: `${CLASS.engine}${doc.settings.showChapterList && scene.chapters.length > 0 ? ` ${CLASS.engineWithList}` : ''}`,
          'data-chapter-list-position': doc.settings.chapterListPosition,
        },
        createElement(
          'div',
          { className: CLASS.stage },
          createElement(
            'div',
            { className: CLASS.stageFrame, 'data-mat': scene.showMat ? 'true' : 'false' },
            createElement(SceneSvg, { scene, className: CLASS.stageSvg }),
          ),
          doc.settings.showCaption && scene.chapters.length > 0
            ? createElement(
                'div',
                { className: `${CLASS.caption} ${CLASS.step}`, 'aria-live': 'polite' },
                (() => {
                  const active = scene.chapter ?? { index: 0, chapter: scene.chapters[0]! };
                  return `${strings.chapterLabel(active.index + 1, scene.chapters.length)}${
                    active.chapter.label ? `, ${active.chapter.label}` : ''
                  }`;
                })(),
              )
            : null,
        ),
        doc.settings.showChapterList && scene.chapters.length > 0
          ? createElement(
              'aside',
              { className: CLASS.stepList, 'aria-label': strings.chapters },
              createElement(
                'ol',
                null,
                ...scene.chapters.map((chapter, index) =>
                  createElement(
                    'li',
                    {
                      key: chapter.id,
                      className: `${CLASS.stepListItem}${scene.chapter?.index === index ? ' is-current' : ''}`,
                      'aria-current': scene.chapter?.index === index ? 'step' : undefined,
                    },
                    createElement('span', { className: 'cloth-step-list-num' }, index + 1),
                    createElement(
                      'div',
                      { className: 'cloth-step-list-body' },
                      createElement('span', { className: 'cloth-step-list-label' }, chapter.label || chapter.id),
                      chapter.subtitle
                        ? createElement('span', { className: 'cloth-step-list-subtitle' }, chapter.subtitle)
                        : null,
                    ),
                  ),
                ),
              ),
            )
          : null,
      ),
    ),
  );
}

export default AnimationPlayer;
