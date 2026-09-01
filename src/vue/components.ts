// Vue components: a static stage and a player with controls.
//
// Defined with `defineComponent` + a render function rather than SFCs, so the package
// ships without needing a Vue compiler in its build.

import {
  computed,
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  type PropType,
  type VNode,
} from 'vue';
import type { AnimationDocument } from '../core/schema/document';
import { buildScene } from '../core/scene/build';
import type { SceneOptions } from '../core/scene/context';
import { effectivePlayback } from '../core/timing/playback';
import { createInteractionSession } from '../core/interactions/session';
import { CLASS, defaultStrings, type Strings } from '../dom/strings';
import { renderSceneSvg } from './scene';
import { usePlayer } from './usePlayer';

/** A single frame with no clock, for thumbnails and editor-driven time. */
export const AnimationStage = defineComponent({
  name: 'ClothAnimationStage',
  props: {
    doc: { type: Object as PropType<AnimationDocument>, required: true },
    time: { type: Number, required: true },
    options: { type: Object as PropType<SceneOptions>, default: () => ({}) },
    className: { type: String, default: undefined },
    theme: { type: String as PropType<'auto' | 'light' | 'dark'>, default: 'auto' },
  },
  setup(props) {
    const scene = computed(() => buildScene(props.doc, props.time, props.options));
    return () =>
      h(
        'div',
        {
          class: CLASS.stageFrame,
          'data-mat': scene.value.showMat ? 'true' : 'false',
          'data-cloth-theme': props.theme === 'auto' ? undefined : props.theme,
        },
        renderSceneSvg(scene.value, props.className ?? CLASS.stageSvg),
      );
  },
});

export const AnimationPlayer = defineComponent({
  name: 'ClothAnimationPlayer',
  props: {
    doc: { type: Object as PropType<AnimationDocument>, required: true },
    options: { type: Object as PropType<SceneOptions>, default: () => ({}) },
    strings: { type: Object as PropType<Partial<Strings>>, default: () => ({}) },
    hideControls: { type: Boolean, default: false },
    className: { type: String, default: undefined },
    theme: { type: String as PropType<'auto' | 'light' | 'dark'>, default: 'auto' },
  },
  setup(props) {
    const strings = computed<Strings>(() => ({ ...defaultStrings, ...props.strings }));
    const { player, state } = usePlayer(props.doc);
    const interaction = createInteractionSession(props.doc, player);
    const interactionState = shallowRef(interaction.getState());
    const unsubscribeInteraction = interaction.subscribe((next) => {
      interactionState.value = next;
    });

    const root = ref<HTMLElement | null>(null);
    const inView = ref(true);
    const reducedMotion = ref(false);

    const apply = (): void => {
      if (effectivePlayback(userWantsPlayback.value, inView.value, reducedMotion.value)) {
        player.play();
      } else {
        player.pause();
      }
    };

    // Tracked separately from `state.playing`: the observers must not undo an explicit
    // pause, and an explicit play must not survive going off screen. Reactive so the
    // control's label follows the intent rather than the clock.
    const userWantsPlayback = ref(props.doc.settings.autoplay);

    let observer: IntersectionObserver | null = null;
    let media: MediaQueryList | null = null;
    const onMotionChange = (): void => {
      reducedMotion.value = media?.matches === true;
      apply();
    };

    onMounted(() => {
      if (root.value && typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) inView.value = entry.isIntersecting;
            apply();
          },
          { threshold: 0.1 },
        );
        observer.observe(root.value);
      }
      if (typeof globalThis.matchMedia === 'function') {
        media = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
        reducedMotion.value = media.matches;
        media.addEventListener('change', onMotionChange);
      }
      apply();
    });

    onUnmounted(() => {
      observer?.disconnect();
      media?.removeEventListener('change', onMotionChange);
      unsubscribeInteraction();
      interaction.destroy();
    });

    const scene = computed(() => buildScene(props.doc, state.value.time, props.options));

    const wrapperClass = computed(() =>
      props.className ? `${CLASS.wrapper} ${props.className}` : CLASS.wrapper,
    );

    return () => {
      if (reducedMotion.value) {
        return h(
          'div',
          {
            ref: root,
            class: wrapperClass.value,
            'data-cloth-theme': props.theme === 'auto' ? undefined : props.theme,
          },
          [
            h('div', { class: CLASS.reduced }, [
              h('p', [h('strong', props.doc.title)]),
              props.doc.description ? h('p', props.doc.description) : null,
              h('p', { class: 'cloth-wrapper-reduced-note' }, strings.value.reducedMotionNote),
            ]),
          ],
        );
      }

      const controls: VNode[] = props.hideControls
        ? []
        : [
            h(
              'button',
              {
                type: 'button',
                class: CLASS.button,
                title: state.value.playing ? strings.value.pause : strings.value.play,
                'aria-label': state.value.playing ? strings.value.pause : strings.value.play,
                onClick: () => {
                  userWantsPlayback.value = !userWantsPlayback.value;
                  apply();
                },
              },
              state.value.playing ? strings.value.pauseIcon : strings.value.playIcon,
            ),
            h(
              'button',
              {
                type: 'button',
                class: CLASS.button,
                title: strings.value.restart,
                'aria-label': strings.value.restart,
                onClick: () => {
                  player.restart();
                  userWantsPlayback.value = true;
                  apply();
                },
              },
              strings.value.restartIcon,
            ),
            h('label', { class: CLASS.speed, title: strings.value.speed }, [
              h('input', {
                type: 'range',
                min: 0.25,
                max: 3,
                step: 0.25,
                value: state.value.speed,
                'aria-label': strings.value.speed,
                onInput: (event: Event) =>
                  player.setSpeed(Number((event.target as HTMLInputElement).value)),
              }),
              h('span', { class: CLASS.speedValue }, `${state.value.speed.toFixed(2)}x`),
            ]),
          ];

      const chapter =
        scene.value.chapter ??
        (scene.value.chapters.length > 0 ? { index: 0, chapter: scene.value.chapters[0]! } : null);
      const caption =
        props.doc.settings.showCaption && chapter
          ? h(
              'div',
              { class: `${CLASS.caption} ${CLASS.step}`, 'aria-live': 'polite' },
              `${strings.value.chapterLabel(chapter.index + 1, scene.value.chapters.length)}${
                chapter.chapter.label ? `, ${chapter.chapter.label}` : ''
              }`,
            )
          : null;
      const checkpoint = interactionState.value.pending;
      const answer = checkpoint ? interactionState.value.answers[checkpoint.id] : undefined;
      const checkpointPanel = checkpoint
        ? h('section', { class: CLASS.checkpoint, 'aria-live': 'polite' }, [
            h('p', { class: CLASS.checkpointPrompt }, checkpoint.prompt),
            checkpoint.interaction === 'choice'
              ? h(
                  'div',
                  { class: CLASS.checkpointChoices },
                  checkpoint.options.map((option) => {
                    const selected = answer?.value === option.value;
                    return h(
                      'button',
                      {
                        type: 'button',
                        key: option.value,
                        'aria-pressed': selected,
                        'data-selected': String(selected),
                        onClick: () => interaction.answer(option.value),
                      },
                      option.label,
                    );
                  }),
                )
              : checkpoint.interaction === 'number-input'
                ? h('input', {
                    type: 'number',
                    min: checkpoint.min,
                    max: checkpoint.max,
                    step: checkpoint.step,
                    onChange: (event: Event) =>
                      interaction.answer(Number((event.target as HTMLInputElement).value)),
                  })
                : checkpoint.interaction === 'select-element'
                  ? h('p', strings.value.selectElement)
                  : null,
            answer?.correct !== undefined
              ? h(
                  'p',
                  {
                    class: CLASS.checkpointResult,
                    role: 'status',
                    'data-correct': String(answer.correct),
                  },
                  answer.correct ? strings.value.correctAnswer : strings.value.incorrectAnswer,
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                class: CLASS.button,
                disabled:
                  checkpoint.required &&
                  checkpoint.interaction !== 'continue' &&
                  answer === undefined,
                onClick: () => interaction.continue(),
              },
              strings.value.continueCheckpoint,
            ),
          ])
        : null;

      const selectCheckpointElement = (event: MouseEvent): void => {
        const pending = interactionState.value.pending;
        if (pending?.interaction !== 'select-element' || !(event.target instanceof Element)) return;
        const id = event.target.closest<HTMLElement>('[data-clotho-id]')?.dataset.clothoId;
        if (id && pending.elementIds.includes(id)) interaction.answer(id);
      };

      return h(
        'div',
        {
          ref: root,
          class: wrapperClass.value,
          'data-cloth-theme': props.theme === 'auto' ? undefined : props.theme,
          onClick: selectCheckpointElement,
        },
        [
          h('div', { class: CLASS.header }, [
            h('div', { class: CLASS.title }, props.doc.title),
            controls.length > 0 ? h('div', { class: CLASS.actions }, controls) : null,
          ]),
          h('div', { class: CLASS.body }, [
            h(
              'div',
              {
                class: `${CLASS.engine}${props.doc.settings.showChapterList && scene.value.chapters.length > 0 ? ` ${CLASS.engineWithList}` : ''}`,
                'data-chapter-list-position': props.doc.settings.chapterListPosition,
              },
              [
                h('div', { class: CLASS.stage }, [
                  h(
                    'div',
                    { class: CLASS.stageFrame, 'data-mat': scene.value.showMat ? 'true' : 'false' },
                    renderSceneSvg(scene.value, CLASS.stageSvg),
                  ),
                  caption,
                ]),
                props.doc.settings.showChapterList && scene.value.chapters.length > 0
                  ? h('aside', { class: CLASS.stepList, 'aria-label': strings.value.chapters }, [
                      h(
                        'ol',
                        null,
                        scene.value.chapters.map((item, index) =>
                          h(
                            'li',
                            {
                              key: item.id,
                              class: `${CLASS.stepListItem}${chapter?.index === index ? ' is-current' : ''}`,
                              'aria-current': chapter?.index === index ? 'step' : undefined,
                            },
                            [
                              h('span', { class: 'cloth-step-list-num' }, index + 1),
                              h('div', { class: 'cloth-step-list-body' }, [
                                h(
                                  'span',
                                  { class: 'cloth-step-list-label' },
                                  item.label || item.id,
                                ),
                                item.subtitle
                                  ? h('span', { class: 'cloth-step-list-subtitle' }, item.subtitle)
                                  : null,
                              ]),
                            ],
                          ),
                        ),
                      ),
                    ])
                  : null,
              ],
            ),
            checkpointPanel,
          ]),
        ],
      );
    };
  },
});
