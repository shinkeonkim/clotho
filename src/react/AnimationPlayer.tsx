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
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { AnimationDocument } from '../core/schema/document';
import { splitAnnotations } from '../core/annotations';
import { buildScene } from '../core/scene/build';
import type { SceneOptions } from '../core/scene/context';
import { effectivePlayback } from '../core/timing/playback';
import { CLASS, defaultStrings, type Strings } from '../dom/strings';
import { bindAnnotations } from '../dom/annotations';
import { createInteractionSession } from '../core/interactions/session';
import { SceneSvg } from './scene';
import { useFullscreen, useHostTheme, useInView, usePlayer, useReducedMotion } from './hooks';

function annotationText(
  value: string,
  references: Readonly<Record<string, string | readonly string[]>>,
): Array<string | ReactElement> {
  return splitAnnotations(value, references).map((part, index) =>
    part.kind === 'text' || part.targetIds?.length === 0
      ? part.value
      : createElement(
          'span',
          {
            key: `${part.token}-${index}`,
            'data-clotho-ref': part.targetIds?.join(' '),
            'data-clotho-token': part.token,
            tabIndex: 0,
            role: 'link',
            'aria-label': `${part.value}: ${part.targetIds?.join(', ')}`,
          },
          part.value,
        ),
  );
}

function chapterCaption(
  chapterLabel: string,
  label: string,
  references: Readonly<Record<string, string | readonly string[]>>,
): Array<string | ReactElement> {
  return label ? [chapterLabel, ', ', ...annotationText(label, references)] : [chapterLabel];
}

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
  const fullscreenRef = useRef<HTMLDivElement>(null);

  const { player, state } = usePlayer(doc);
  const interaction = useMemo(() => createInteractionSession(doc, player), [doc, player]);
  useEffect(() => () => interaction.destroy(), [interaction]);
  const interactionState = useSyncExternalStore(
    useCallback((listener) => interaction.subscribe(listener), [interaction]),
    interaction.getState,
    interaction.getState,
  );
  const reducedMotion = useReducedMotion();
  const inView = useInView(rootRef);
  const hostTheme = useHostTheme();
  const resolvedTheme = theme === 'auto' ? hostTheme : theme;
  const [viewerOpen, setViewerOpen] = useState(false);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(fullscreenRef);

  /**
   * What the viewer asked for, tracked separately from whether the clock is running.
   *
   * Conflating the two breaks in both directions: scrolling away would look like the
   * viewer pressing pause (so it never resumes), and pressing pause while off screen
   * would be undone the moment it scrolls back. The DOM and Vue adapters keep the same
   * split.
   */
  const [userWantsPlayback, setUserWantsPlayback] = useState(doc.settings.autoplay);
  const [motionOverride, setMotionOverride] = useState(false);
  const togglePlayback = useCallback(() => {
    setMotionOverride(true);
    setUserWantsPlayback((wanted) => !wanted);
  }, []);
  const restartPlayback = useCallback(() => {
    setMotionOverride(true);
    player.restart();
    setUserWantsPlayback(true);
  }, [player]);

  // Applying the rule in an effect, not during render: play/pause mutate the player and
  // start a frame loop, which a render pass must not do.
  useEffect(() => {
    if (effectivePlayback(userWantsPlayback, inView, reducedMotion && !motionOverride))
      player.play();
    else player.pause();
  }, [player, userWantsPlayback, inView, reducedMotion, motionOverride]);

  const scene = useMemo(() => buildScene(doc, state.time, options), [doc, state.time, options]);

  const onSpeedChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => player.setSpeed(Number(event.target.value)),
    [player],
  );
  useEffect(() => {
    const root = rootRef.current;
    return root ? bindAnnotations(root) : undefined;
  }, []);
  useEffect(() => {
    const root = rootRef.current;
    const pending = interactionState.pending;
    if (!root || pending?.interaction !== 'select-element') return;
    const select = (event: Event): void => {
      if (!(event.target instanceof Element)) return;
      const id = event.target.closest<HTMLElement>('[data-clotho-id]')?.dataset.clothoId;
      if (id && pending.elementIds.includes(id)) interaction.answer(id);
    };
    root.addEventListener('click', select);
    return () => root.removeEventListener('click', select);
  }, [interaction, interactionState.pending]);

  useEffect(() => {
    if (!viewerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.fullscreenElement) setViewerOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [viewerOpen]);

  return createElement(
    'div',
    {
      ref: rootRef,
      className: `${CLASS.wrapper}${className ? ` ${className}` : ''}`,
      'data-cloth-theme': resolvedTheme,
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
                onClick: togglePlayback,
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
                onClick: restartPlayback,
                title: strings.restart,
                'aria-label': strings.restart,
              },
              strings.restartIcon,
            ),
            createElement(
              'button',
              {
                type: 'button',
                className: CLASS.button,
                onClick: () => setViewerOpen(true),
                title: strings.enlarge,
                'aria-label': strings.enlarge,
              },
              strings.enlargeIcon,
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
                  return chapterCaption(
                    strings.chapterLabel(active.index + 1, scene.chapters.length),
                    active.chapter.label,
                    active.chapter.references,
                  );
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
                      createElement(
                        'span',
                        { className: 'cloth-step-list-label' },
                        ...annotationText(chapter.label || chapter.id, chapter.references),
                      ),
                      chapter.subtitle
                        ? createElement(
                            'span',
                            { className: 'cloth-step-list-subtitle' },
                            ...annotationText(chapter.subtitle, chapter.references),
                          )
                        : null,
                    ),
                  ),
                ),
              ),
            )
          : null,
      ),
      interactionState.pending
        ? (() => {
            const checkpoint = interactionState.pending;
            const answer = interactionState.answers[checkpoint.id];
            return createElement(
              'section',
              { className: CLASS.checkpoint, 'aria-live': 'polite' },
              createElement('p', { className: CLASS.checkpointPrompt }, checkpoint.prompt),
              checkpoint.interaction === 'choice'
                ? createElement(
                    'div',
                    { className: CLASS.checkpointChoices },
                    ...checkpoint.options.map((option) =>
                      createElement(
                        'button',
                        {
                          type: 'button',
                          key: option.value,
                          'aria-pressed': answer?.value === option.value,
                          'data-selected': String(answer?.value === option.value),
                          onClick: () => interaction.answer(option.value),
                        },
                        option.label,
                      ),
                    ),
                  )
                : checkpoint.interaction === 'number-input'
                  ? createElement('input', {
                      type: 'number',
                      min: checkpoint.min,
                      max: checkpoint.max,
                      step: checkpoint.step,
                      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                        interaction.answer(Number(event.target.value)),
                    })
                  : checkpoint.interaction === 'select-element'
                    ? createElement('p', null, strings.selectElement)
                    : null,
              answer?.correct !== undefined
                ? createElement(
                    'p',
                    {
                      className: CLASS.checkpointResult,
                      role: 'status',
                      'data-correct': String(answer.correct),
                    },
                    answer.correct ? strings.correctAnswer : strings.incorrectAnswer,
                  )
                : null,
              createElement(
                'button',
                {
                  type: 'button',
                  className: CLASS.button,
                  disabled:
                    checkpoint.required &&
                    checkpoint.interaction !== 'continue' &&
                    answer === undefined,
                  onClick: () => interaction.continue(),
                },
                strings.continueCheckpoint,
              ),
            );
          })()
        : null,
    ),
    hideControls
      ? null
      : createElement('input', {
          className: CLASS.timeline,
          type: 'range',
          min: 0,
          max: doc.duration,
          step: 1,
          value: state.time,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            player.seek(Number(event.target.value)),
          'aria-label': strings.timeline,
        }),
    viewerOpen && typeof document !== 'undefined'
      ? createPortal(
          createElement(
            'div',
            {
              className: CLASS.modalBackdrop,
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': doc.title,
              'data-cloth-theme': resolvedTheme,
              onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
                if (event.target === event.currentTarget) setViewerOpen(false);
              },
            },
            createElement(
              'div',
              { ref: fullscreenRef, className: CLASS.modalContent },
              createElement(
                'div',
                { className: CLASS.modalHeader },
                createElement('h3', { className: CLASS.modalTitle }, doc.title),
                createElement(
                  'div',
                  { className: CLASS.modalControls },
                  createElement(
                    'button',
                    {
                      type: 'button',
                      className: CLASS.button,
                      onClick: togglePlayback,
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
                      onClick: restartPlayback,
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
                    createElement(
                      'span',
                      { className: CLASS.speedValue },
                      `${state.speed.toFixed(2)}x`,
                    ),
                  ),
                  createElement(
                    'button',
                    {
                      type: 'button',
                      className: CLASS.button,
                      onClick: toggleFullscreen,
                      title: isFullscreen ? strings.exitFullscreen : strings.fullscreen,
                      'aria-label': isFullscreen ? strings.exitFullscreen : strings.fullscreen,
                    },
                    strings.enlargeIcon,
                  ),
                  createElement(
                    'button',
                    {
                      type: 'button',
                      className: CLASS.modalClose,
                      onClick: () => setViewerOpen(false),
                      title: strings.close,
                      'aria-label': strings.close,
                    },
                    strings.closeIcon,
                  ),
                ),
              ),
              createElement(
                'div',
                { className: CLASS.modalStage, 'data-zoom': 'fit' },
                createElement(
                  'div',
                  { className: 'cloth-modal-fit' },
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
                        {
                          className: CLASS.stageFrame,
                          'data-mat': scene.showMat ? 'true' : 'false',
                        },
                        createElement(SceneSvg, { scene, className: CLASS.stageSvg }),
                      ),
                      doc.settings.showCaption && scene.chapters.length > 0
                        ? createElement(
                            'div',
                            { className: `${CLASS.caption} ${CLASS.step}`, 'aria-live': 'polite' },
                            (() => {
                              const active = scene.chapter ?? {
                                index: 0,
                                chapter: scene.chapters[0]!,
                              };
                              return chapterCaption(
                                strings.chapterLabel(active.index + 1, scene.chapters.length),
                                active.chapter.label,
                                active.chapter.references,
                              );
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
                                  'aria-current':
                                    scene.chapter?.index === index ? 'step' : undefined,
                                },
                                createElement(
                                  'span',
                                  { className: 'cloth-step-list-num' },
                                  index + 1,
                                ),
                                createElement(
                                  'div',
                                  { className: 'cloth-step-list-body' },
                                  createElement(
                                    'span',
                                    { className: 'cloth-step-list-label' },
                                    ...annotationText(
                                      chapter.label || chapter.id,
                                      chapter.references,
                                    ),
                                  ),
                                  chapter.subtitle
                                    ? createElement(
                                        'span',
                                        { className: 'cloth-step-list-subtitle' },
                                        ...annotationText(chapter.subtitle, chapter.references),
                                      )
                                    : null,
                                ),
                              ),
                            ),
                          ),
                        )
                      : null,
                  ),
                ),
              ),
              createElement('input', {
                className: CLASS.timeline,
                type: 'range',
                min: 0,
                max: doc.duration,
                step: 1,
                value: state.time,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                  player.seek(Number(event.target.value)),
                'aria-label': strings.timeline,
              }),
            ),
          ),
          document.body,
        )
      : null,
  );
}

export default AnimationPlayer;
