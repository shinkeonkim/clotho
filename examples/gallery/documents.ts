// The gallery: one document per thing the format can do.
//
// `examples/shared/document.json` shows what an animation looks like. It does not show
// what the format *offers* — it uses two element types out of ten and one transition
// mode out of eight, so reading it tells you nothing about the other forty-odd knobs.
// These documents cover the surface, and `tests/gallery-coverage.test.ts` fails the
// build if the schema grows something the gallery does not demonstrate.
//
// Written as TypeScript rather than JSON on purpose. Half of this file is "the same
// shape eight times, once per mode" — hand-copied JSON would be longer, and the copies
// would drift. `bun examples/gallery/build.ts` emits the JSON if you want to read it.

import type { z } from 'zod';
import type { AssetResolver } from '../../src/core/assets/resolver';
import type { animationDocumentSchema } from '../../src/core/schema/document';
import type { Ease, EntryMode, ExitMode } from '../../src/core/schema/primitives';
import { defineAnimation } from '../../src/core/authoring';

export interface GalleryEntry {
  readonly slug: string;
  /** Shown above the player. */
  readonly title: string;
  /** What to look for while it plays — the reason this entry exists. */
  readonly note: string;
  readonly doc: Doc;
  /**
   * Supplied only by entries containing `ref` assets. Rendering without it is a
   * supported state, not a broken one — the placeholder is what a host sees before
   * its resolver settles — so the gallery page shows both.
   */
  readonly assetResolver?: AssetResolver;
}

/**
 * A document as an *author* writes it, not as the runtime sees it.
 *
 * `AnimationDocument` is the schema's output type, so every defaulted field is required
 * in it — typing the gallery that way would force `rotation: 0` and `tracks: []` onto
 * every element and teach exactly the wrong lesson. `z.input` is the pre-defaults shape,
 * which is what a JSON file on disk actually contains.
 */
type Doc = z.input<typeof animationDocumentSchema>;

const INK = '#312e81';
const ACCENT = '#6366f1';
const WARM = '#f97316';
const GOOD = '#16a34a';

/** A full-length appearance — the common case, spelled once. */
const whole = (end: number) => [{ start: 0, end, entryDuration: 0, exitDuration: 0 }];

function doc(partial: Omit<Doc, 'clothoVersion'>): Doc {
  return {
    clothoVersion: 1,
    category: 'gallery',
    canvas: { width: 720, height: 320, background: 'transparent' },
    settings: { loop: true, autoplay: true, showCaption: false, showChapterList: false },
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// 1. Every element type

const ELEMENTS: Doc = doc({
  id: 'elements',
  title: 'Ten element types',
  description: 'Every shape the format can draw, on one stage',
  duration: 4000,
  assets: {
    check: {
      kind: 'inline',
      mime: 'image/svg+xml',
      data:
        'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+' +
        'PGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMjIiIGZpbGw9IiM2MzY2ZjEiLz48cGF0aCBkPSJNMTQg' +
        'MjVsNyA3IDEzLTE1IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iNSIgc3Ry' +
        'b2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+',
    },
    // A `ref` asset carries no source at all — the host resolves the key. The gallery
    // page supplies a resolver (see `galleryResolver`); render this document without one
    // and the element draws a placeholder rather than collapsing, which is the whole
    // reason the indirection exists.
    logo: { kind: 'ref', key: 'gallery/logo' },
  },
  elements: [
    {
      type: 'rect',
      id: 'r',
      x: 24,
      y: 40,
      width: 150,
      height: 78,
      fill: '#e0e7ff',
      stroke: ACCENT,
      cornerRadius: 14,
      label: 'rect',
      labelSize: 15,
      subtitle: 'cornerRadius · subtitle',
      subtitleSize: 11,
      appearances: whole(4000),
    },
    {
      type: 'circle',
      id: 'c',
      cx: 250,
      cy: 79,
      r: 40,
      fill: '#fce7f3',
      stroke: '#db2777',
      label: 'circle',
      appearances: whole(4000),
    },
    {
      type: 'line',
      id: 'l',
      x1: 310,
      y1: 45,
      x2: 430,
      y2: 45,
      stroke: '#64748b',
      strokeDasharray: '6 4',
      headStart: 'bar',
      headEnd: 'bar',
      appearances: whole(4000),
    },
    {
      type: 'arrow',
      id: 'a',
      x1: 310,
      y1: 105,
      x2: 430,
      y2: 105,
      stroke: GOOD,
      headEnd: 'triangle',
      label: 'arrow',
      labelOffsetY: -10,
      curvature: -22,
      appearances: whole(4000),
    },
    {
      type: 'text',
      id: 't',
      x: 470,
      y: 60,
      content: 'text — 한글도 measures correctly',
      fontSize: 15,
      fontWeight: 600,
      color: INK,
      appearances: whole(4000),
    },
    {
      type: 'image',
      id: 'img',
      x: 470,
      y: 78,
      width: 44,
      height: 44,
      assetId: 'check',
      alt: 'A check mark',
      appearances: whole(4000),
    },
    {
      type: 'image',
      id: 'img-ref',
      x: 526,
      y: 78,
      width: 44,
      height: 44,
      assetId: 'logo',
      alt: 'Host-resolved logo (unresolved here)',
      appearances: whole(4000),
    },
    {
      type: 'path',
      id: 'p',
      x: 24,
      y: 150,
      d: 'M 0 50 C 40 -20 90 90 130 20',
      stroke: WARM,
      strokeWidth: 3,
      appearances: whole(4000),
    },
    {
      type: 'polygon',
      id: 'poly',
      points: '210,215 250,150 290,215',
      fill: 'var(--cloth-surface-elevated, #fafafa)',
      stroke: 'var(--cloth-accent, #6366f1)',
      opacity: 0.9,
      appearances: whole(4000),
    },
    // A group and its two children. The children's coordinates are relative to the
    // group's origin, so moving `grp` moves both — see `groups` below for the proof.
    { type: 'group', id: 'grp', x: 330, y: 150, appearances: whole(4000) },
    {
      type: 'rect',
      id: 'grp-a',
      parentId: 'grp',
      x: 0,
      y: 0,
      width: 46,
      height: 46,
      fill: '#cffafe',
      stroke: '#0891b2',
      appearances: whole(4000),
    },
    {
      type: 'text',
      id: 'grp-b',
      parentId: 'grp',
      x: 0,
      y: 62,
      content: 'group',
      fontSize: 13,
      color: '#0891b2',
      appearances: whole(4000),
    },
    {
      type: 'code',
      id: 'code',
      x: 440,
      y: 150,
      width: 250,
      height: 110,
      content: 'function tick(t) {\n  return t / 1000;\n}',
      language: 'javascript',
      fontSize: 12,
      showLineNumbers: true,
      title: 'code element',
      appearances: whole(4000),
    },
  ],
});

// ---------------------------------------------------------------------------
// 2. Entry and exit transitions — all eight, side by side

const MODES: readonly (EntryMode & ExitMode)[] = [
  'instant',
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'zoom',
  'pop',
];

const TRANSITIONS: Doc = doc({
  id: 'transitions',
  title: 'Entry and exit modes',
  description: 'All eight transition modes entering together and leaving together',
  duration: 4000,
  canvas: { width: 720, height: 220, background: 'transparent' },
  elements: MODES.flatMap((mode, i) => {
    const x = 20 + i * 87;
    return [
      {
        type: 'rect' as const,
        id: `m-${i}`,
        x,
        y: 60,
        width: 72,
        height: 72,
        fill: '#e0e7ff',
        stroke: ACCENT,
        appearances: [
          // Every box shares one window, so the modes are compared rather than
          // sequenced: they all arrive at 400ms and all leave at 2600ms.
          {
            start: 400,
            end: 2600,
            entryMode: mode,
            entryDuration: 700,
            exitMode: mode,
            exitDuration: 700,
          },
        ],
      },
      {
        type: 'text' as const,
        id: `m-${i}-label`,
        x: x + 36,
        y: 155,
        content: mode,
        fontSize: 11,
        textAnchor: 'middle' as const,
        color: '#475569',
        appearances: whole(4000),
      },
    ];
  }),
});

// ---------------------------------------------------------------------------
// 3. Easing — the same journey, four curves

const EASES: readonly Ease[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

const EASING: Doc = doc({
  id: 'easing',
  title: 'Easing curves',
  description: 'Four dots crossing the same distance in the same time',
  duration: 3000,
  canvas: { width: 720, height: 240, background: 'transparent' },
  elements: EASES.flatMap((ease, i) => {
    const y = 50 + i * 48;
    return [
      {
        type: 'text' as const,
        id: `e-${i}-label`,
        x: 20,
        y: y + 5,
        content: ease,
        fontSize: 13,
        color: '#475569',
        appearances: whole(3000),
      },
      {
        type: 'line' as const,
        id: `e-${i}-rail`,
        x1: 110,
        y1: y,
        x2: 680,
        y2: y,
        stroke: '#e2e8f0',
        strokeWidth: 2,
        appearances: whole(3000),
      },
      {
        type: 'circle' as const,
        id: `e-${i}`,
        cx: 110,
        cy: y,
        r: 11,
        fill: ACCENT,
        stroke: INK,
        appearances: whole(3000),
        // `ease` belongs to the keyframe you are easing *into*, so it is the second
        // keyframe that carries it. Putting it on the first has no effect, which is a
        // common way to spend an afternoon.
        tracks: [
          {
            property: 'cx',
            keyframes: [
              { time: 200, value: 110 },
              { time: 2600, value: 680, ease },
            ],
          },
        ],
      },
    ];
  }),
});

// ---------------------------------------------------------------------------
// 4. Interpolation modes

const INTERPOLATION: Doc = doc({
  id: 'interpolation',
  title: 'Interpolation modes',
  description: 'auto, number, color and discrete over identical keyframes',
  duration: 4000,
  canvas: { width: 720, height: 260, background: 'transparent' },
  elements: [
    {
      type: 'text',
      id: 'i-h',
      x: 20,
      y: 30,
      content: 'track.interpolate decides how two keyframe values are blended',
      fontSize: 13,
      color: '#475569',
      appearances: whole(4000),
    },
    // `auto` reproduces the legacy heuristic: it recognizes the property name. `width`
    // is in its numeric set, so this slides.
    {
      type: 'rect',
      id: 'auto',
      x: 20,
      y: 60,
      width: 60,
      height: 44,
      fill: '#e0e7ff',
      stroke: ACCENT,
      label: 'auto',
      appearances: whole(4000),
      tracks: [
        {
          property: 'width',
          interpolate: 'auto',
          keyframes: [
            { time: 0, value: 60 },
            { time: 3600, value: 300, ease: 'easeInOut' },
          ],
        },
      ],
    },
    // `number` says so outright, which is what a property outside the heuristic's
    // hardcoded sets needs — under `auto` an unrecognized name would step instead.
    {
      type: 'circle',
      id: 'num',
      cx: 60,
      cy: 145,
      r: 20,
      fill: '#fce7f3',
      stroke: '#db2777',
      label: 'number',
      appearances: whole(4000),
      tracks: [
        {
          property: 'r',
          interpolate: 'number',
          keyframes: [
            { time: 0, value: 20 },
            { time: 3600, value: 46, ease: 'easeOut' },
          ],
        },
      ],
    },
    {
      type: 'rect',
      id: 'col',
      x: 340,
      y: 122,
      width: 150,
      height: 48,
      fill: '#e0e7ff',
      stroke: ACCENT,
      label: 'color',
      appearances: whole(4000),
      tracks: [
        {
          property: 'fill',
          interpolate: 'color',
          keyframes: [
            { time: 0, value: '#e0e7ff' },
            { time: 3600, value: '#fca5a5', ease: 'linear' },
          ],
        },
      ],
    },
    // `discrete` holds each value until the next keyframe's time. For text this is the
    // only sensible reading — halfway between "one" and "two" is not a word.
    {
      type: 'text',
      id: 'disc',
      x: 20,
      y: 225,
      content: 'discrete: one',
      fontSize: 20,
      fontWeight: 700,
      color: INK,
      appearances: whole(4000),
      tracks: [
        {
          property: 'content',
          interpolate: 'discrete',
          keyframes: [
            { time: 0, value: 'discrete: one' },
            { time: 1200, value: 'discrete: two' },
            { time: 2400, value: 'discrete: three' },
            { time: 3600, value: 'discrete: four' },
          ],
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// 5. Iteration — loops, without a loop construct
//
// The format has no `repeat` keyword; a loop is an unrolled sequence. Three ways to
// write one, all visible at once. Proposal P1 in docs/PROPOSALS.md is about removing
// the need for this page.

const CELLS = 8;
const STEP = 420; // ms per iteration
const CELL_W = 62;

const ITERATION: Doc = doc({
  id: 'iteration',
  title: 'Iteration patterns',
  description: 'A linear scan: cursor, per-cell state, and a counter',
  duration: 4200,
  canvas: { width: 720, height: 300, background: 'transparent' },
  settings: { loop: true, autoplay: true, showCaption: true, showChapterList: false },
  chapters: [
    { id: 'ch-scan', time: 0, label: 'scan', subtitle: 'visit every cell once' },
    { id: 'ch-done', time: 3400, label: 'done', subtitle: 'max found' },
  ],
  elements: [
    {
      type: 'text',
      id: 'it-h',
      x: 20,
      y: 32,
      content: 'for (i = 0; i < 8; i++)',
      fontSize: 14,
      fontWeight: 600,
      color: '#475569',
      appearances: whole(4200),
    },

    // (a) One element whose position steps once per iteration. Two keyframes per step
    //     — arrive, then hold — is what makes it read as discrete visits rather than
    //     one continuous slide.
    {
      type: 'rect',
      id: 'cursor',
      x: 26,
      y: 62,
      width: CELL_W,
      height: 66,
      fill: 'none',
      stroke: WARM,
      strokeWidth: 3,
      cornerRadius: 10,
      appearances: whole(4200),
      tracks: [
        {
          property: 'x',
          keyframes: Array.from({ length: CELLS }, (_, i) => [
            { time: i * STEP, value: 26 + i * (CELL_W + 8), ease: 'easeOut' as const },
            { time: i * STEP + STEP - 120, value: 26 + i * (CELL_W + 8) },
          ]).flat(),
        },
      ],
    },

    // (b) One appearance window per iteration, staggered. Each cell is its own element
    //     and lights up when the cursor reaches it. This is the unrolled loop body.
    ...Array.from({ length: CELLS }, (_, i) => ({
      type: 'rect' as const,
      id: `cell-${i}`,
      x: 30 + i * (CELL_W + 8),
      y: 66,
      width: CELL_W - 8,
      height: 58,
      fill: '#e0e7ff',
      stroke: ACCENT,
      label: String([4, 9, 2, 7, 1, 8, 3, 6][i]),
      appearances: whole(4200),
      tracks: [
        {
          property: 'fill',
          interpolate: 'color' as const,
          keyframes: [
            { time: 0, value: '#e0e7ff' },
            { time: i * STEP, value: '#e0e7ff' },
            { time: i * STEP + 160, value: '#fed7aa', ease: 'easeOut' as const },
            { time: i * STEP + STEP, value: '#dcfce7', ease: 'easeOut' as const },
          ],
        },
      ],
    })),

    // (c) A counter. Discrete because it is a readout, not a quantity being animated.
    {
      type: 'text',
      id: 'counter',
      x: 20,
      y: 175,
      content: 'i = 0',
      fontSize: 18,
      fontWeight: 700,
      color: INK,
      appearances: whole(4200),
      tracks: [
        {
          property: 'content',
          interpolate: 'discrete',
          keyframes: Array.from({ length: CELLS }, (_, i) => ({
            time: i * STEP,
            value: `i = ${i}`,
          })),
        },
      ],
    },

    // (d) An element that comes and goes repeatedly — several appearances on one
    //     element, rather than several elements. Cheaper when the thing is identical
    //     each time round.
    {
      type: 'circle',
      id: 'blink',
      cx: 640,
      cy: 172,
      r: 9,
      fill: GOOD,
      stroke: 'none',
      appearances: Array.from({ length: CELLS }, (_, i) => ({
        start: i * STEP,
        end: i * STEP + 200,
        entryMode: 'pop' as const,
        entryDuration: 100,
        exitMode: 'fade' as const,
        exitDuration: 100,
      })),
    },
    {
      type: 'text',
      id: 'blink-label',
      x: 470,
      y: 177,
      content: 'repeated appearances →',
      fontSize: 12,
      color: '#475569',
      appearances: whole(4200),
    },

    {
      type: 'rect',
      id: 'answer',
      x: 20,
      y: 215,
      width: 200,
      height: 52,
      fill: '#dcfce7',
      stroke: GOOD,
      label: 'max = 9',
      appearances: [
        { start: 3400, end: 4200, entryMode: 'zoom', entryDuration: 350, exitDuration: 0 },
      ],
    },
  ],
  // (e) Effects on a schedule are the fourth way to iterate: the elements stay put and
  //     the emphasis moves.
  effects: Array.from({ length: CELLS }, (_, i) => ({
    type: 'pulse' as const,
    id: `pulse-${i}`,
    elementId: `cell-${i}`,
    time: i * STEP + 60,
    scale: 1.14,
    duration: 260,
  })),
});

// ---------------------------------------------------------------------------
// 6. Effects

const EFFECTS: Doc = doc({
  id: 'effects',
  title: 'Effects',
  description: 'highlight, pulse and flow, fired repeatedly',
  duration: 3000,
  canvas: { width: 720, height: 200, background: 'transparent' },
  elements: [
    {
      type: 'rect',
      id: 'fx-hl',
      x: 40,
      y: 60,
      width: 160,
      height: 80,
      fill: '#e0e7ff',
      stroke: ACCENT,
      label: 'highlight',
      appearances: whole(3000),
    },
    {
      type: 'circle',
      id: 'fx-pulse',
      cx: 360,
      cy: 100,
      r: 44,
      fill: '#fce7f3',
      stroke: '#db2777',
      label: 'pulse',
      appearances: whole(3000),
    },
    {
      type: 'arrow',
      id: 'fx-flow',
      x1: 500,
      y1: 100,
      x2: 680,
      y2: 100,
      stroke: GOOD,
      headEnd: 'arrow',
      label: 'flow',
      labelOffsetY: -12,
      appearances: whole(3000),
    },
  ],
  effects: [
    { type: 'highlight', id: 'e1', elementId: 'fx-hl', time: 300, color: '#facc15', duration: 700 },
    {
      type: 'highlight',
      id: 'e2',
      elementId: 'fx-hl',
      time: 1800,
      color: '#22d3ee',
      duration: 700,
    },
    { type: 'pulse', id: 'e3', elementId: 'fx-pulse', time: 500, scale: 1.25, duration: 600 },
    { type: 'pulse', id: 'e4', elementId: 'fx-pulse', time: 2000, scale: 1.25, duration: 600 },
    {
      type: 'flow',
      id: 'e5',
      elementId: 'fx-flow',
      time: 200,
      color: '#facc15',
      particles: 5,
      radius: 5,
      duration: 1200,
    },
    {
      type: 'flow',
      id: 'e6',
      elementId: 'fx-flow',
      time: 1600,
      color: '#facc15',
      particles: 5,
      radius: 5,
      duration: 1200,
    },
  ],
});

// ---------------------------------------------------------------------------
// 7. Anchors and arrowheads

const ANCHORS = [
  'auto',
  'top',
  'right',
  'bottom',
  'left',
  'center',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;

const ANCHOR_LABEL_POSITION: Record<(typeof ANCHORS)[number], readonly [number, number]> = {
  auto: [70, 30],
  top: [360, 22],
  right: [650, 110],
  bottom: [360, 202],
  left: [70, 110],
  center: [650, 202],
  'top-left': [170, 34],
  'top-right': [550, 34],
  'bottom-left': [170, 186],
  'bottom-right': [550, 186],
};

const HEADS = [
  'none',
  'arrow',
  'triangle',
  'triangle-open',
  'circle',
  'circle-open',
  'diamond',
  'diamond-open',
  'bar',
] as const;

const CONNECTORS: Doc = doc({
  id: 'connectors',
  title: 'Anchors and arrowheads',
  description: 'Ten anchor positions and nine head shapes',
  duration: 3000,
  canvas: { width: 720, height: 400, background: 'transparent' },
  elements: [
    {
      type: 'circle',
      id: 'hub',
      cx: 360,
      cy: 110,
      r: 34,
      fill: 'var(--cloth-surface-subtle, #f4f4f5)',
      stroke: 'var(--cloth-accent, #6366f1)',
      label: 'hub',
      appearances: whole(3000),
      tracks: [
        {
          property: 'cx',
          keyframes: [
            { time: 0, value: 360 },
            { time: 750, value: 410, ease: 'easeInOut' },
            { time: 1500, value: 310, ease: 'easeInOut' },
            { time: 2250, value: 390, ease: 'easeInOut' },
            { time: 3000, value: 360, ease: 'easeInOut' },
          ],
        },
        {
          property: 'cy',
          keyframes: [
            { time: 0, value: 110 },
            { time: 750, value: 140, ease: 'easeInOut' },
            { time: 1500, value: 82, ease: 'easeInOut' },
            { time: 2250, value: 128, ease: 'easeInOut' },
            { time: 3000, value: 110, ease: 'easeInOut' },
          ],
        },
      ],
    },
    // Anchors are resolved against the target shape, so each spoke lands on a
    // different point of the same hub.
    ...ANCHORS.flatMap((anchor, i) => {
      const [x, y] = ANCHOR_LABEL_POSITION[anchor];
      return [
        {
          type: 'rect' as const,
          id: `an-${i}`,
          x: x - 34,
          y: y - 13,
          width: 68,
          height: 26,
          fill: 'var(--cloth-surface-elevated, #fafafa)',
          stroke: 'var(--cloth-muted, #71717a)',
          strokeWidth: 1,
          cornerRadius: 6,
          label: anchor,
          labelSize: 9,
          appearances: whole(3000),
        },
        {
          type: 'arrow' as const,
          id: `an-${i}-arr`,
          fromId: `an-${i}`,
          toId: 'hub',
          // Keep the spoke origin fixed while the moving hub demonstrates target
          // tracking. This makes start- and end-anchor behaviour easy to distinguish.
          fromAnchor: 'center' as const,
          toAnchor: anchor,
          stroke: 'var(--cloth-muted, #71717a)',
          strokeWidth: 1.5,
          headEnd: 'arrow' as const,
          appearances: whole(3000),
        },
      ];
    }),
    ...HEADS.flatMap((head, i) => {
      const y = 240 + Math.floor(i / 3) * 52;
      const x = 60 + (i % 3) * 230;
      return [
        {
          type: 'line' as const,
          id: `hd-${i}`,
          x1: x,
          y1: y,
          x2: x + 110,
          y2: y,
          stroke: 'var(--cloth-accent, #6366f1)',
          strokeWidth: 2,
          headEnd: head,
          appearances: whole(3000),
        },
        {
          type: 'text' as const,
          id: `hd-${i}-label`,
          x: x + 124,
          y: y + 4,
          content: head,
          fontSize: 11,
          color: 'var(--cloth-muted, #71717a)',
          appearances: whole(3000),
        },
      ];
    }),
  ],
});

// ---------------------------------------------------------------------------
// 8. Groups — nesting and inherited transforms

const GROUPS: Doc = doc({
  id: 'groups',
  title: 'Nested groups',
  description: 'A group inside a group; animating the outer one moves everything',
  duration: 4000,
  canvas: { width: 720, height: 300, background: 'transparent' },
  elements: [
    {
      type: 'text',
      id: 'g-h',
      x: 20,
      y: 30,
      content: 'outer group moves and rotates · inner group only rotates',
      fontSize: 13,
      color: '#475569',
      appearances: whole(4000),
    },

    {
      type: 'group',
      id: 'outer',
      x: 60,
      y: 80,
      appearances: whole(4000),
      tracks: [
        {
          property: 'x',
          keyframes: [
            { time: 0, value: 60 },
            { time: 2000, value: 400, ease: 'easeInOut' },
            { time: 4000, value: 60, ease: 'easeInOut' },
          ],
        },
        {
          property: 'rotation',
          keyframes: [
            { time: 0, value: 0 },
            { time: 4000, value: 20, ease: 'linear' },
          ],
        },
      ],
    },
    {
      type: 'rect',
      id: 'outer-frame',
      parentId: 'outer',
      x: 0,
      y: 0,
      width: 210,
      height: 150,
      fill: 'rgba(224,231,255,0.55)',
      stroke: ACCENT,
      cornerRadius: 12,
      label: 'outer',
      labelSize: 12,
      appearances: whole(4000),
    },

    {
      type: 'group',
      id: 'inner',
      parentId: 'outer',
      x: 40,
      y: 44,
      appearances: whole(4000),
      tracks: [
        {
          property: 'rotation',
          keyframes: [
            { time: 0, value: 0 },
            { time: 4000, value: 360, ease: 'linear' },
          ],
        },
      ],
    },
    {
      type: 'rect',
      id: 'inner-a',
      parentId: 'inner',
      x: 0,
      y: 0,
      width: 56,
      height: 56,
      fill: '#fecdd3',
      stroke: '#e11d48',
      appearances: whole(4000),
    },
    {
      type: 'rect',
      id: 'inner-b',
      parentId: 'inner',
      x: 66,
      y: 0,
      width: 56,
      height: 56,
      fill: '#cffafe',
      stroke: '#0891b2',
      appearances: whole(4000),
    },
    // A connector whose ends are in different coordinate spaces. Resolving it means
    // walking both elements' accumulated matrices — the case that makes anchors on
    // grouped elements hard.
    {
      type: 'arrow',
      id: 'cross',
      fromId: 'inner-b',
      toId: 'landmark',
      fromAnchor: 'right',
      toAnchor: 'left',
      stroke: WARM,
      headEnd: 'arrow',
      strokeWidth: 2,
      appearances: whole(4000),
    },
    {
      type: 'circle',
      id: 'landmark',
      cx: 640,
      cy: 230,
      r: 26,
      fill: '#ffedd5',
      stroke: WARM,
      label: 'free',
      labelSize: 11,
      appearances: whole(4000),
    },
  ],
});

// ---------------------------------------------------------------------------
// 9. Chapters and captions

const CHAPTERS: Doc = doc({
  id: 'chapters',
  title: 'Chapters and captions',
  description: 'Four labelled sections with the caption bar switched on',
  duration: 4800,
  canvas: { width: 720, height: 220, background: 'transparent' },
  settings: { loop: true, autoplay: true, showCaption: true, showChapterList: true },
  chapters: [
    { id: 'c1', time: 0, label: 'parse', subtitle: 'text becomes a tree' },
    { id: 'c2', time: 1200, label: 'check', subtitle: 'the tree is validated' },
    { id: 'c3', time: 2400, label: 'build', subtitle: 'a scene is produced' },
    { id: 'c4', time: 3600, label: 'draw', subtitle: 'an adapter emits it' },
  ],
  elements: ['parse', 'check', 'build', 'draw'].flatMap((step, i) => [
    {
      type: 'rect' as const,
      id: `st-${i}`,
      x: 30 + i * 172,
      y: 70,
      width: 140,
      height: 72,
      fill: '#e0e7ff',
      stroke: ACCENT,
      label: step,
      appearances: [
        {
          start: i * 1200,
          end: 4800,
          entryMode: 'slide-up' as const,
          entryDuration: 400,
          exitDuration: 0,
        },
      ],
    },
    ...(i < 3
      ? [
          {
            type: 'arrow' as const,
            id: `st-${i}-arr`,
            fromId: `st-${i}`,
            toId: `st-${i + 1}`,
            fromAnchor: 'right' as const,
            toAnchor: 'left' as const,
            stroke: '#94a3b8',
            headEnd: 'arrow' as const,
            appearances: [
              {
                start: (i + 1) * 1200 - 200,
                end: 4800,
                entryMode: 'fade' as const,
                entryDuration: 300,
                exitDuration: 0,
              },
            ],
          },
        ]
      : []),
  ]),
});

/** Stands in for a host asset service. Returns the same check mark under another name. */
const galleryResolver: AssetResolver = {
  resolve: (ref) =>
    ref.key === 'gallery/logo'
      ? 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9' +
        'IjAgMCA0OCA0OCI+PHJlY3QgeD0iNCIgeT0iNCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMTAiIGZpbGw9' +
        'IiNmOTczMTYiLz48L3N2Zz4='
      : null,
};

// A cohesive authoring scenario rather than a feature sampler: live service data is
// bound into a constraint-laid-out incident flow, the explanation links to the affected
// elements, a checkpoint asks the reader to choose the next action, and the compact
// variant keeps the same document readable in an article column.
const INCIDENT_WALKTHROUGH: Doc = defineAnimation({
  clothoVersion: 1,
  id: 'incident-walkthrough',
  title: 'Incident response walkthrough',
  description: 'Observe, connect the evidence, and choose the recovery action.',
  category: 'gallery',
  duration: 6000,
  canvas: { width: 720, height: 360, background: 'transparent' },
  data: {
    services: {
      api: { state: 'DEGRADED', color: '#f97316' },
      queue: { state: 'BACKLOG 42', color: '#dc2626' },
      worker: { state: 'HEALTHY', color: '#16a34a' },
    },
  },
  layouts: [
    {
      id: 'service-row',
      mode: 'row',
      elementIds: ['api-card', 'queue-card', 'worker-card'],
      x: 60,
      y: 118,
      gap: 42,
    },
  ],
  elements: [
    {
      type: 'text',
      id: 'heading',
      x: 360,
      y: 48,
      content: '{api} 지연이 {queue} 적체로 이어졌습니다.',
      translations: { en: '{api} latency caused a {queue} backlog.' },
      references: { api: 'api-card', queue: 'queue-card' },
      fontSize: 22,
      textAnchor: 'middle',
      appearances: whole(6000),
    },
    ...[
      ['api-card', 'API', '/services/api/state', '/services/api/color'],
      ['queue-card', 'QUEUE', '/services/queue/state', '/services/queue/color'],
      ['worker-card', 'WORKER', '/services/worker/state', '/services/worker/color'],
    ].map(([id, label, state, color]) => ({
      type: 'rect' as const,
      id: id!,
      x: 0,
      y: 0,
      width: 170,
      height: 92,
      fill: '#eef2ff',
      stroke: ACCENT,
      cornerRadius: 12,
      label: label!,
      subtitle: '',
      appearances: whole(6000),
      bindings: [
        { property: 'subtitle', pointer: state!, formatter: 'string' as const },
        { property: 'stroke', pointer: color!, formatter: 'color' as const },
      ],
    })),
    {
      type: 'arrow',
      id: 'api-to-queue',
      fromId: 'api-card',
      toId: 'queue-card',
      fromAnchor: 'right',
      toAnchor: 'left',
      stroke: WARM,
      headEnd: 'arrow',
      appearances: whole(6000),
    },
    {
      type: 'arrow',
      id: 'queue-to-worker',
      fromId: 'queue-card',
      toId: 'worker-card',
      fromAnchor: 'right',
      toAnchor: 'left',
      stroke: '#dc2626',
      headEnd: 'arrow',
      appearances: whole(6000),
    },
    {
      type: 'text',
      id: 'action',
      x: 360,
      y: 285,
      content: 'Checkpoint에서 복구 순서를 선택하세요.',
      translations: { en: 'Choose the recovery order at the checkpoint.' },
      fontSize: 17,
      textAnchor: 'middle',
      appearances: whole(6000),
    },
  ],
  chapters: [
    { id: 'observe', time: 0, label: '관찰', subtitle: '실시간 상태 확인' },
    { id: 'decide', time: 2800, label: '판단', subtitle: '복구 순서 선택' },
  ],
  checkpoints: [
    {
      id: 'recovery-order',
      time: 3000,
      prompt: '어떤 구성 요소를 먼저 복구할까요?',
      interaction: 'choice',
      options: [
        { value: 'queue', label: 'Queue 적체 해소' },
        { value: 'api', label: 'API 재시작' },
      ],
      required: true,
    },
  ],
  responsive: [
    {
      id: 'compact',
      minWidth: 0,
      maxWidth: 479,
      canvas: { width: 375, height: 560 },
      chapterListPosition: 'bottom',
      elementOverrides: {
        heading: { x: 188, fontSize: 18 },
        'api-card': { x: 103, y: 100 },
        'queue-card': { x: 103, y: 220 },
        'worker-card': { x: 103, y: 340 },
        action: { x: 188, y: 500, fontSize: 15 },
      },
    },
    { id: 'regular', minWidth: 480, elementOverrides: {} },
  ],
  settings: {
    loop: false,
    autoplay: true,
    showCaption: true,
    showChapterList: true,
    chapterListPosition: 'right',
  },
});

export const GALLERY: readonly GalleryEntry[] = [
  {
    slug: 'incident-walkthrough',
    title: 'Incident response walkthrough',
    note: 'A practical flow combining live data bindings, constraint layout, linked evidence, chapters, a required checkpoint, translations, and a compact responsive stage.',
    doc: INCIDENT_WALKTHROUGH,
  },
  {
    slug: 'elements',
    title: 'Ten element types',
    assetResolver: galleryResolver,
    note: 'All ten types, including the two v1 added: a real group, and images through the asset registry. The second image is a `ref` asset with no resolver, so it draws as a placeholder.',
    doc: ELEMENTS,
  },
  {
    slug: 'transitions',
    title: 'Entry and exit modes',
    note: 'One shared window, eight modes. Watch the arrival at 0.4s and the departure at 2.6s — `instant` is the control.',
    doc: TRANSITIONS,
  },
  {
    slug: 'easing',
    title: 'Easing curves',
    note: '`linear` is the straight edge to compare against. `ease` goes on the keyframe being eased *into*.',
    doc: EASING,
  },
  {
    slug: 'interpolation',
    title: 'Interpolation modes',
    note: 'Four tracks with the same shape and different `interpolate`. `discrete` is how a text readout should change.',
    doc: INTERPOLATION,
  },
  {
    slug: 'iteration',
    title: 'Iteration patterns',
    note: 'The format has no loop construct — five ways to write one anyway: a stepping cursor, an unrolled body, a discrete counter, repeated appearances, and scheduled effects.',
    doc: ITERATION,
  },
  {
    slug: 'effects',
    title: 'Effects',
    note: 'Effects decorate; they never touch the element timeline. Firing one twice is two effect entries.',
    doc: EFFECTS,
  },
  {
    slug: 'connectors',
    title: 'Anchors and arrowheads',
    note: 'Ten anchors track a moving hub, plus every arrowhead. `auto` picks the side facing the other end.',
    doc: CONNECTORS,
  },
  {
    slug: 'groups',
    title: 'Nested groups',
    note: 'Transforms compose down the tree, and the orange arrow crosses two coordinate spaces to reach a free element.',
    doc: GROUPS,
  },
  {
    slug: 'chapters',
    title: 'Chapters and captions',
    note: 'Chapters name moments; the caption bar and chapter list are both switched on in `settings`.',
    doc: CHAPTERS,
  },
];
