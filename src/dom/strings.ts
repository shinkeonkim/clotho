// UI strings and class names shared by the adapters.
//
// Legacy hardcoded Korean labels ("일시정지", "확대 보기", "다시 재생"). That is fine for
// one blog and wrong for a published package, so the defaults are English and every
// string is overridable (TASKS 4.7). Nothing here is inferred from the document —
// an animation's language and its player's language are different things.
//
// Class names carry the `cloth-` prefix (N3). Legacy used `anim-`, which is generic
// enough to collide with a host stylesheet.

export interface Strings {
  readonly play: string;
  readonly pause: string;
  readonly restart: string;
  readonly speed: string;
  readonly enlarge: string;
  readonly close: string;
  readonly zoomIn: string;
  readonly zoomOut: string;
  readonly resetZoom: string;
  readonly fullscreen: string;
  readonly exitFullscreen: string;
  readonly reducedMotionNote: string;
  readonly rotateHint: string;
  readonly chapterLabel: (index: number, total: number) => string;

  // Glyphs are separate from labels so a host can swap in icon components without
  // touching the accessible names.
  readonly playIcon: string;
  readonly pauseIcon: string;
  readonly restartIcon: string;
  readonly enlargeIcon: string;
  readonly closeIcon: string;
}

export const defaultStrings: Strings = {
  play: 'Play',
  pause: 'Pause',
  restart: 'Restart',
  speed: 'Playback speed',
  enlarge: 'Enlarge',
  close: 'Close',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Reset zoom',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit full screen',
  reducedMotionNote: 'Autoplay is paused because you asked for reduced motion.',
  rotateHint: 'Rotate your device for a wider view.',
  chapterLabel: (index, total) => `Chapter ${index} / ${total}`,

  playIcon: '▶',
  pauseIcon: '⏸',
  restartIcon: '↻',
  enlargeIcon: '⛶',
  closeIcon: '✕',
};

/** Korean strings, matching what the two original consumers displayed. */
export const koreanStrings: Strings = {
  ...defaultStrings,
  play: '재생',
  pause: '일시정지',
  restart: '다시 재생',
  speed: '재생 속도',
  enlarge: '확대 보기',
  close: '닫기',
  zoomIn: '확대',
  zoomOut: '축소',
  resetZoom: '원래 크기',
  fullscreen: '전체 화면',
  exitFullscreen: '전체 화면 종료',
  reducedMotionNote: '모션 줄이기 설정으로 자동 재생을 멈췄습니다.',
  rotateHint: '기기를 회전하면 더 넓게 볼 수 있습니다.',
  chapterLabel: (index, total) => `Chapter ${index} / ${total}`,
};

/** Class names the adapters emit. Style them via `@kokoa/clotho/styles.css`. */
export const CLASS = {
  wrapper: 'cloth-wrapper',
  header: 'cloth-wrapper-header',
  title: 'cloth-wrapper-title',
  actions: 'cloth-wrapper-actions',
  button: 'cloth-wrapper-btn',
  speed: 'cloth-wrapper-speed',
  speedValue: 'cloth-wrapper-speed-value',
  body: 'cloth-wrapper-body',
  step: 'cloth-wrapper-step',
  reduced: 'cloth-wrapper-reduced',
  engine: 'cloth-engine',
  engineWithList: 'cloth-engine-with-list',
  stage: 'cloth-engine-stage',
  stageFrame: 'cloth-stage-frame',
  stageSvg: 'cloth-stage-svg',
  caption: 'cloth-caption',
  captionNum: 'cloth-caption-num',
  captionLabel: 'cloth-caption-label',
  captionSubtitle: 'cloth-caption-subtitle',
  stepList: 'cloth-step-list',
  stepListItem: 'cloth-step-list-item',
  modalBackdrop: 'cloth-modal-backdrop',
  modalContent: 'cloth-modal-content',
  modalClose: 'cloth-modal-close',
  modalTitle: 'cloth-modal-title',
  modalControls: 'cloth-modal-controls',
  modalStage: 'cloth-modal-stage',
  zoom: 'cloth-zoom',
  zoomValue: 'cloth-zoom-value',
  error: 'cloth-error',
  placeholder: 'cloth-placeholder',
} as const;
