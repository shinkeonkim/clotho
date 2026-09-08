// DOM adapter tests, against a real DOM (happy-dom).
//
// The two things worth proving here are the ones a string comparison cannot: that
// patching produces the same tree the serializer describes, and that it *reuses*
// elements between frames instead of rebuilding them. The second is the entire reason
// the patcher exists — a 12-second animation is 720 frames, and recreating the
// subtree each time would discard focus, selection, and CSS transitions along with
// the elements.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { animationDocumentSchema } from '../src/core/schema/document';
import { buildScene } from '../src/core/scene/build';
import { serializeSceneBody } from '../src/svg/serialize';
import { patchScene } from '../src/dom/patch';
import { mountPlayer, mountStage } from '../src/dom/mount';
import { mountScrollPlayer, rangeProgress } from '../src/dom/scroll';
import { mountPresenter } from '../src/dom/presenter';
import { createManualScheduler } from '../src/core/player/scheduler';
import { appendAnnotationText, bindAnnotations } from '../src/dom/annotations';

const ALWAYS = [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }];

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'demo',
  title: 'Demo',
  duration: 1000,
  elements: [
    {
      type: 'rect',
      id: 'box',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      label: 'A',
      appearances: ALWAYS,
      tracks: [
        {
          property: 'x',
          keyframes: [
            { time: 0, value: 0, ease: 'linear' },
            { time: 1000, value: 200, ease: 'linear' },
          ],
        },
      ],
    },
    { type: 'circle', id: 'dot', cx: 300, cy: 25, r: 10, appearances: ALWAYS },
    {
      type: 'arrow',
      id: 'ar',
      x1: 0,
      y1: 100,
      x2: 100,
      y2: 100,
      headEnd: 'arrow',
      appearances: ALWAYS,
    },
    {
      type: 'code',
      id: 'cd',
      x: 0,
      y: 150,
      width: 200,
      height: 60,
      content: 'const x = 1;\nreturn x;',
      showLineNumbers: true,
      appearances: ALWAYS,
    },
    {
      type: 'rect',
      id: 'later',
      x: 0,
      y: 250,
      width: 20,
      height: 20,
      appearances: [{ start: 600, end: 1000, entryDuration: 0, exitDuration: 0 }],
    },
  ],
});

let window: Window;

beforeEach(() => {
  window = new Window({ url: 'https://example.com' });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = window.document;
  g.Element = window.Element;
  g.Node = window.Node;
  g.SVGElement = window.SVGElement;
  g.IntersectionObserver = undefined;
  g.matchMedia = undefined;
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.Element;
  delete g.Node;
  delete g.SVGElement;
  delete g.IntersectionObserver;
  delete g.matchMedia;
});

describe('linked annotations', () => {
  it('highlights targets by pointer, keyboard focus, and persistent click', () => {
    const root = window.document.createElement('div');
    const target = window.document.createElement('div');
    target.dataset.clothoId = 'queue';
    const caption = window.document.createElement('p');
    appendAnnotationText(caption as unknown as HTMLElement, '{queue}에 삽입', { queue: 'queue' });
    root.append(target, caption);
    const reference = caption.querySelector('[data-clotho-ref]') as unknown as HTMLElement;
    const unbind = bindAnnotations(root as unknown as HTMLElement);

    reference.dispatchEvent(new window.Event('pointerover', { bubbles: true }) as unknown as Event);
    expect(target.classList.contains('is-annotation-target')).toBe(true);
    reference.dispatchEvent(new window.Event('pointerout', { bubbles: true }) as unknown as Event);
    expect(target.classList.contains('is-annotation-target')).toBe(false);

    reference.click();
    reference.dispatchEvent(new window.Event('pointerout', { bubbles: true }) as unknown as Event);
    expect(target.classList.contains('is-annotation-target')).toBe(true);
    reference.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event,
    );
    expect(target.classList.contains('is-annotation-target')).toBe(false);

    unbind();
    expect(reference.classList.contains('is-annotation-active')).toBe(false);
  });

  it('renders chapter text as text nodes and accessible references', () => {
    const caption = window.document.createElement('p');
    appendAnnotationText(caption as unknown as HTMLElement, '<{node}> 확인', {
      node: ['a', 'b'],
    });
    expect(caption.textContent).toBe('<node> 확인');
    expect(caption.innerHTML).toContain('&lt;');
    expect(caption.querySelector('[data-clotho-ref="a b"]')?.getAttribute('role')).toBe('link');
  });
});

function svgElement(): SVGSVGElement {
  return window.document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg',
  ) as unknown as SVGSVGElement;
}

/** Serialized DOM, with the patcher's bookkeeping attribute removed. */
function domMarkup(svg: SVGSVGElement): string {
  return (svg as unknown as { innerHTML: string }).innerHTML.replace(
    / data-cloth-key="[^"]*"/g,
    '',
  );
}

describe('patchScene', () => {
  it('builds the tree the serializer describes', () => {
    const svg = svgElement();
    patchScene(svg, buildScene(doc, 500));

    const dom = domMarkup(svg);
    // The patcher wraps the body in one <g>; comparing element names and counts is
    // the meaningful check.
    const tags = (markup: string) => [...(markup.match(/<([a-z]+)/g) ?? [])].sort();
    const expected = tags(serializeSceneBody(buildScene(doc, 500)));
    // Account for the body wrapper the patcher adds.
    expect(tags(dom)).toEqual([...expected, '<g'].sort());
  });

  it('carries stage metadata onto the svg element', () => {
    const svg = svgElement();
    patchScene(svg, buildScene(doc, 0));
    expect(svg.getAttribute('viewBox')).toBe('0 0 800 500');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Demo');
  });

  // The whole point of the patcher.
  it('reuses elements across frames instead of recreating them', () => {
    const svg = svgElement();
    patchScene(svg, buildScene(doc, 0));
    const rect = svg.querySelector('rect');
    expect(rect).not.toBeNull();

    patchScene(svg, buildScene(doc, 500));
    expect(svg.querySelector('rect')).toBe(rect);

    patchScene(svg, buildScene(doc, 900));
    expect(svg.querySelector('rect')).toBe(rect);
  });

  it('updates only the attributes that changed', () => {
    const svg = svgElement();
    patchScene(svg, buildScene(doc, 0));
    const rect = svg.querySelector('rect')!;
    expect(rect.getAttribute('x')).toBe('0');

    patchScene(svg, buildScene(doc, 500));
    expect(rect.getAttribute('x')).toBe('100');
    expect(rect.getAttribute('width')).toBe('100');
  });

  it('adds an element when it comes on stage and removes it when it leaves', () => {
    const svg = svgElement();
    patchScene(svg, buildScene(doc, 0));
    const count = () => svg.querySelectorAll('rect').length;
    const before = count();

    patchScene(svg, buildScene(doc, 800));
    expect(count()).toBe(before + 1);

    patchScene(svg, buildScene(doc, 0));
    expect(count()).toBe(before);
  });

  it('keeps paint order stable across frames', () => {
    const svg = svgElement();
    patchScene(svg, buildScene(doc, 0));
    const order = () =>
      Array.from(svg.querySelectorAll('[data-cloth-key]')).map((e) =>
        e.getAttribute('data-cloth-key'),
      );
    const first = order();
    patchScene(svg, buildScene(doc, 500));
    expect(order()).toEqual(first);
  });

  it('emits marker defs once and keeps them', () => {
    const svg = svgElement();
    patchScene(svg, buildScene(doc, 0));
    const marker = svg.querySelector('marker');
    expect(marker?.getAttribute('id')).toBe('cloth-h-arrow-6366f1');
    patchScene(svg, buildScene(doc, 500));
    expect(svg.querySelectorAll('marker')).toHaveLength(1);
    expect(svg.querySelector('marker')).toBe(marker);
  });

  it('renders nested tspans for code, reusing them between frames', () => {
    const svg = svgElement();
    patchScene(svg, buildScene(doc, 0));
    const tspans = svg.querySelectorAll('tspan');
    expect(tspans.length).toBeGreaterThan(2);
    const first = tspans[0];
    patchScene(svg, buildScene(doc, 500));
    expect(svg.querySelectorAll('tspan')[0]).toBe(first);
  });

  it('writes text content, escaped by the DOM rather than by hand', () => {
    const withSpecials = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'x',
      duration: 100,
      elements: [
        {
          type: 'text',
          id: 't',
          x: 0,
          y: 0,
          content: 'a & b < c',
          appearances: [{ start: 0, end: 100 }],
        },
      ],
    });
    const svg = svgElement();
    patchScene(svg, buildScene(withSpecials, 50));
    const text = svg.querySelector('text')!;
    expect(text.textContent).toBe('a & b < c');
    expect(domMarkup(svg)).toContain('a &amp; b &lt; c');
  });
});

describe('mountStage', () => {
  it('renders into a container and follows the player', () => {
    const container = window.document.createElement('div');
    const scheduler = createManualScheduler();
    const handle = mountStage(container as unknown as HTMLElement, doc, {
      player: { scheduler, autoplay: true },
    });

    const rect = () => container.querySelector('rect');
    expect(rect()?.getAttribute('x')).toBe('0');

    scheduler.advance(0);
    scheduler.advance(50);
    expect(handle.player.getState().time).toBe(50);
    expect(rect()?.getAttribute('x')).toBe('10');

    handle.destroy();
    expect(container.children).toHaveLength(0);
  });

  it('marks the frame for the themed mat when the canvas is transparent', () => {
    const container = window.document.createElement('div');
    const handle = mountStage(container as unknown as HTMLElement, doc);
    expect(container.querySelector('.cloth-stage-frame')?.getAttribute('data-mat')).toBe('true');
    handle.destroy();
  });
});

describe('interactive checkpoint UI', () => {
  it('pauses, records a choice, and resumes from the DOM player', () => {
    const interactive = animationDocumentSchema.parse({
      clothoVersion: 1,
      id: 'interactive',
      duration: 500,
      settings: { autoplay: false, loop: false },
      checkpoints: [
        {
          id: 'choice',
          time: 100,
          prompt: '다음 값은?',
          interaction: 'choice',
          options: [
            { value: '2', label: '2' },
            { value: '3', label: '3' },
          ],
          predicate: { type: 'equals', value: '2' },
        },
      ],
    });
    const scheduler = createManualScheduler();
    const container = window.document.createElement('div');
    const handle = mountPlayer(container as unknown as HTMLElement, interactive, {
      player: { scheduler },
    });
    (container.querySelector('.cloth-wrapper-btn') as unknown as HTMLButtonElement).click();
    scheduler.advance(0);
    scheduler.advance(64);
    scheduler.advance(128);

    const panel = container.querySelector('.cloth-checkpoint')!;
    expect(panel.getAttribute('hidden')).toBeNull();
    expect(panel.textContent).toContain('다음 값은?');
    const correctChoice = panel.querySelector('[data-value="2"]') as unknown as HTMLButtonElement;
    expect(correctChoice.getAttribute('aria-pressed')).toBe('false');
    correctChoice.click();
    expect(panel.textContent).toContain('Correct');
    expect(panel.querySelector('[data-value="2"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(panel.querySelector('[data-value="2"]')?.getAttribute('data-selected')).toBe('true');
    expect(panel.querySelector('.cloth-checkpoint-result')?.getAttribute('role')).toBe('status');
    const buttons = panel.querySelectorAll('button');
    (buttons[buttons.length - 1] as unknown as HTMLButtonElement).click();
    scheduler.advance(200);
    scheduler.advance(250);
    expect(handle.player.getState().time).toBeGreaterThan(100);
    handle.destroy();
  });
});

describe('mountPlayer', () => {
  it('renders controls with English labels by default', () => {
    const container = window.document.createElement('div');
    const handle = mountPlayer(container as unknown as HTMLElement, doc, {
      player: { scheduler: createManualScheduler(), autoplay: false },
    });
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Play', 'Restart']);
    handle.destroy();
  });

  it('accepts translated strings', () => {
    const container = window.document.createElement('div');
    const handle = mountPlayer(container as unknown as HTMLElement, doc, {
      player: { scheduler: createManualScheduler(), autoplay: false },
      strings: { play: '재생', restart: '다시 재생' },
    });
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['재생', '다시 재생']);
    handle.destroy();
  });

  it('does not render an empty chapter indicator when there are no chapters', () => {
    const container = window.document.createElement('div');
    const handle = mountPlayer(container as unknown as HTMLElement, doc);
    expect(container.querySelector('.cloth-wrapper-step')).toBeNull();
    handle.destroy();
  });

  it('keeps the legacy chapter indicator when chapters exist', () => {
    const chaptered = animationDocumentSchema.parse({
      ...doc,
      chapters: [
        { id: 'start', time: 0, label: 'Start' },
        { id: 'finish', time: 500, label: 'Finish' },
      ],
      settings: { ...doc.settings, showCaption: true },
    });
    const container = window.document.createElement('div');
    const handle = mountPlayer(container as unknown as HTMLElement, chaptered);
    expect(container.querySelector('.cloth-wrapper-step')?.textContent).toBe(
      'Chapter 1 / 2, Start',
    );
    handle.destroy();
  });

  it('renders a chapter list on the configured side', () => {
    const configured = animationDocumentSchema.parse({
      ...doc,
      chapters: [
        { id: 'start', time: 0, label: 'Start' },
        { id: 'finish', time: 500, label: 'Finish' },
      ],
      settings: {
        ...doc.settings,
        showCaption: false,
        showChapterList: true,
        chapterListPosition: 'left' as const,
      },
    });
    const container = window.document.createElement('div');
    const handle = mountPlayer(container as unknown as HTMLElement, configured);
    const engine = container.querySelector('.cloth-engine') as unknown as HTMLElement;
    expect(engine.dataset.chapterListPosition).toBe('left');
    expect(container.querySelectorAll('.cloth-step-list-item')).toHaveLength(2);
    expect(container.querySelector('.cloth-caption')).toBeNull();
    handle.destroy();
  });

  it('can force a scoped light or dark theme', () => {
    const container = window.document.createElement('div');
    const handle = mountPlayer(container as unknown as HTMLElement, doc, { theme: 'dark' });
    expect(handle.root.dataset.clothTheme).toBe('dark');
    handle.destroy();
  });

  it('toggles playback from the button', () => {
    const container = window.document.createElement('div');
    const scheduler = createManualScheduler();
    const handle = mountPlayer(container as unknown as HTMLElement, doc, {
      player: { scheduler, autoplay: false },
    });
    const playButton = container.querySelector('button')!;

    playButton.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(handle.player.getState().playing).toBe(true);
    expect(playButton.getAttribute('aria-label')).toBe('Pause');

    playButton.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(handle.player.getState().playing).toBe(false);
    handle.destroy();
  });

  it('cleans up on destroy', () => {
    const container = window.document.createElement('div');
    const handle = mountPlayer(container as unknown as HTMLElement, doc, {
      player: { scheduler: createManualScheduler() },
    });
    handle.destroy();
    expect(container.children).toHaveLength(0);
  });
});

/**
 * The camera is the first thing whose *drawing* depends on the reduced-motion
 * preference, not just whether the clock runs. mountStage therefore observes the
 * media query itself, and this checks the observation actually reaches buildScene.
 */
describe('mountStage and reduced motion', () => {
  const cameraDoc = animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'cam',
    duration: 1000,
    canvas: { width: 800, height: 500 },
    camera: {
      tracks: [
        {
          property: 'zoom',
          keyframes: [
            { time: 0, value: 1 },
            { time: 1000, value: 4, ease: 'linear' },
          ],
        },
      ],
    },
  });

  function stubMatchMedia(matches: boolean): void {
    const g = globalThis as unknown as Record<string, unknown>;
    g.matchMedia = () => ({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  }

  function viewBoxAt(time: number): string {
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const handle = mountStage(container as unknown as HTMLElement, cameraDoc, {
      player: { autoplay: false, scheduler: createManualScheduler() },
    });
    handle.player.seek(time);
    const viewBox = container.querySelector('svg')!.getAttribute('viewBox')!;
    handle.destroy();
    return viewBox;
  }

  it('glides the camera when motion is welcome', () => {
    stubMatchMedia(false);
    // Halfway through a linear 1x → 4x zoom.
    expect(viewBoxAt(500)).toBe(buildScene(cameraDoc, 500).viewBox);
    expect(viewBoxAt(500)).not.toBe('0 0 800 500');
  });

  it('holds the previous camera value when the reader asked for reduced motion', () => {
    stubMatchMedia(true);
    expect(viewBoxAt(500)).toBe('0 0 800 500');
    expect(viewBoxAt(1000)).toBe(buildScene(cameraDoc, 1000).viewBox);
  });

  it('lets an explicit option override what the media query says', () => {
    stubMatchMedia(true);
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const handle = mountStage(container as unknown as HTMLElement, cameraDoc, {
      reducedMotion: false,
      player: { autoplay: false, scheduler: createManualScheduler() },
    });
    handle.player.seek(500);
    expect(container.querySelector('svg')!.getAttribute('viewBox')).not.toBe('0 0 800 500');
    handle.destroy();
  });
});

/**
 * The patcher reuses `<defs>` children between frames by key. A key is stable but a
 * kind is not guaranteed to be, and reusing a `<marker>` element as a `<mask>` would
 * silently render nothing at all — the scrim would cover the whole stage.
 */
describe('patching defs of different kinds', () => {
  const spotlit = animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'sp-dom',
    duration: 1000,
    canvas: { width: 200, height: 100 },
    elements: [
      { type: 'rect', id: 'a', x: 10, y: 10, width: 40, height: 40, appearances: ALWAYS },
      {
        type: 'arrow',
        id: 'ar',
        x1: 0,
        y1: 90,
        x2: 190,
        y2: 90,
        headEnd: 'arrow',
        appearances: ALWAYS,
      },
    ],
    effects: [
      { type: 'spotlight', id: 'sp', elementIds: ['a'], time: 200, duration: 400, fadeIn: 0 },
    ],
  });

  it('creates, keeps and removes a mask as the effect comes and goes', () => {
    const svg = svgElement();
    const tags = (): string[] =>
      Array.from(svg.querySelector('defs')?.children ?? []).map((child) => child.tagName);

    patchScene(svg, buildScene(spotlit, 0));
    expect(tags()).toEqual(['marker']);

    patchScene(svg, buildScene(spotlit, 300));
    expect(tags().sort()).toEqual(['marker', 'mask']);
    expect(svg.querySelector('mask')?.children.length).toBeGreaterThan(1);

    patchScene(svg, buildScene(spotlit, 900));
    expect(tags()).toEqual(['marker']);
  });
});

/**
 * Scroll-driven playback.
 *
 * The interesting part is what it does *not* do: no clock, no play state, and under
 * reduced motion no scroll listener at all — a reader with a vestibular disorder
 * should not have the page move under them, and slowing it down does not help.
 */
describe('mountScrollPlayer', () => {
  const scrollDoc = animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'scrolled',
    duration: 10_000,
    canvas: { width: 200, height: 100 },
    chapters: [
      { id: 'a', time: 2000, label: 'A' },
      { id: 'b', time: 8000, label: 'B' },
    ],
    elements: [
      {
        type: 'rect',
        id: 'r',
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        appearances: [{ start: 0, end: 10_000, entryDuration: 0, exitDuration: 0 }],
        tracks: [
          {
            property: 'x',
            keyframes: [
              { time: 0, value: 0 },
              { time: 10_000, value: 180, ease: 'linear' },
            ],
          },
        ],
      },
    ],
  });

  function stubMotion(matches: boolean): void {
    (globalThis as unknown as Record<string, unknown>).matchMedia = () => ({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  }

  const xAt = (element: HTMLElement): number => {
    const shape = element.querySelector('rect');
    return Number(shape?.getAttribute('x') ?? -1);
  };

  it('draws the frame the scroll position asks for', () => {
    stubMotion(false);
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const handle = mountScrollPlayer(container as unknown as HTMLElement, scrollDoc);

    handle.render(0);
    expect(xAt(container as unknown as HTMLElement)).toBe(0);
    handle.render(0.5);
    expect(xAt(container as unknown as HTMLElement)).toBe(90);
    handle.render(1);
    expect(xAt(container as unknown as HTMLElement)).toBe(180);

    handle.destroy();
  });

  it('scrolling back up is a smaller number, not a smear', () => {
    stubMotion(false);
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const handle = mountScrollPlayer(container as unknown as HTMLElement, scrollDoc);

    handle.render(0.8);
    handle.render(0.2);
    const backwards = xAt(container as unknown as HTMLElement);
    handle.destroy();

    const fresh = window.document.createElement('div');
    window.document.body.append(fresh);
    const second = mountScrollPlayer(fresh as unknown as HTMLElement, scrollDoc);
    second.render(0.2);
    expect(xAt(fresh as unknown as HTMLElement)).toBe(backwards);
    second.destroy();
  });

  it('honours chapter snapping', () => {
    stubMotion(false);
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const handle = mountScrollPlayer(container as unknown as HTMLElement, scrollDoc, {
      snapToChapters: true,
    });
    // Three segments; a third of the way through is the first chapter at 2000ms.
    handle.render(1 / 3);
    expect(xAt(container as unknown as HTMLElement)).toBeCloseTo(36, 0);
    handle.destroy();
  });

  it('replaces the scroll link with one still per chapter under reduced motion', () => {
    stubMotion(true);
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const handle = mountScrollPlayer(container as unknown as HTMLElement, scrollDoc);

    // One still per chapter, and no live stage to scroll.
    expect(container.querySelectorAll('svg').length).toBe(2);
    handle.destroy();
  });

  it('leaves no listeners behind', () => {
    stubMotion(false);
    const added: string[] = [];
    const removed: string[] = [];
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    (window as unknown as Record<string, unknown>).addEventListener = (
      type: string,
      ...rest: unknown[]
    ) => {
      added.push(type);
      return (originalAdd as (...args: unknown[]) => unknown)(type, ...rest);
    };
    (window as unknown as Record<string, unknown>).removeEventListener = (
      type: string,
      ...rest: unknown[]
    ) => {
      removed.push(type);
      return (originalRemove as (...args: unknown[]) => unknown)(type, ...rest);
    };

    const container = window.document.createElement('div');
    window.document.body.append(container);
    mountScrollPlayer(container as unknown as HTMLElement, scrollDoc).destroy();

    expect(added.sort()).toEqual(removed.sort());
    (window as unknown as Record<string, unknown>).addEventListener = originalAdd;
    (window as unknown as Record<string, unknown>).removeEventListener = originalRemove;
  });
});

describe('rangeProgress', () => {
  const rect = (top: number, height: number) => ({ top, height }) as DOMRect;

  it('is zero at the top of a tall range and one at the bottom', () => {
    expect(rangeProgress(rect(0, 2000), 1000)).toBe(0);
    expect(rangeProgress(rect(-1000, 2000), 1000)).toBe(1);
  });

  it('clamps outside the range', () => {
    expect(rangeProgress(rect(500, 2000), 1000)).toBe(0);
    expect(rangeProgress(rect(-9000, 2000), 1000)).toBe(1);
  });

  it('still progresses for a range shorter than the viewport', () => {
    // Otherwise a short range would sit at zero forever and never animate.
    const early = rangeProgress(rect(900, 200), 1000);
    const late = rangeProgress(rect(-100, 200), 1000);
    expect(late).toBeGreaterThan(early);
  });
});

/**
 * Presenter mode.
 *
 * The behaviour that matters is that advancing *plays* the segment instead of
 * jumping to its end — the animation is part of the explanation, and a talk that
 * skips it shows the room a result with no account of how it happened.
 */
describe('mountPresenter', () => {
  const talk = animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'talk',
    title: 'Talk',
    duration: 9000,
    canvas: { width: 200, height: 100 },
    chapters: [
      { id: 'a', time: 0, label: 'One', notes: 'ask about complexity' },
      { id: 'b', time: 3000, label: 'Two' },
      { id: 'c', time: 6000, label: 'Three' },
    ],
    elements: [
      {
        type: 'rect',
        id: 'r',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        appearances: [{ start: 0, end: 9000, entryDuration: 0, exitDuration: 0 }],
      },
    ],
  });

  function presenter() {
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const scheduler = createManualScheduler();
    const handle = mountPresenter(container as unknown as HTMLElement, talk, {
      player: { scheduler },
    });
    return { handle, scheduler, container };
  }

  it('starts on the first segment, paused at its beginning', () => {
    const { handle } = presenter();
    expect(handle.segments).toHaveLength(3);
    expect(handle.player.getState().time).toBe(0);
    handle.destroy();
  });

  it('plays the segment rather than jumping to its end', () => {
    const { handle, scheduler } = presenter();
    handle.go(1);
    expect(handle.player.getState().time).toBe(3000);
    expect(handle.player.getState().playing).toBe(true);

    // Part-way through, still inside the segment and still running. Advanced in
    // real frame steps because the player clamps a large delta — a backgrounded tab
    // must not teleport the playhead.
    for (let i = 0; i < 20; i += 1) scheduler.advance(16);
    expect(handle.player.getState().time).toBeGreaterThan(3000);
    expect(handle.player.getState().time).toBeLessThan(6000);
    expect(handle.player.getState().playing).toBe(true);
    handle.destroy();
  });

  it('stops at the end of the segment instead of running into the next', () => {
    const { handle, scheduler } = presenter();
    handle.go(1);
    for (let i = 0; i < 400; i += 1) scheduler.advance(16);
    expect(handle.player.getState().playing).toBe(false);
    expect(handle.player.getState().time).toBe(6000);
    handle.destroy();
  });

  it('moves back a segment', () => {
    const { handle } = presenter();
    handle.go(2);
    handle.previous();
    expect(handle.player.getState().time).toBe(3000);
    handle.destroy();
  });

  it('clamps at both ends rather than falling off', () => {
    const { handle } = presenter();
    handle.previous();
    expect(handle.player.getState().time).toBe(0);
    handle.go(99);
    expect(handle.player.getState().time).toBe(6000);
    handle.destroy();
  });

  it('advances on the arrow key', () => {
    const { handle, container } = presenter();
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(handle.player.getState().time).toBe(3000);
    expect(container.textContent).toContain('2 / 3');
    handle.destroy();
  });

  /** Notes are for the speaker; they must not reach an audience by accident. */
  it('hides the speaker notes until asked', () => {
    const { handle, container } = presenter();
    const notes = container.querySelector('.cloth-presenter-notes') as unknown as HTMLElement;
    expect(notes.hidden).toBe(true);
    handle.toggleNotes();
    expect(notes.hidden).toBe(false);
    expect(notes.textContent).toContain('ask about complexity');
    expect(notes.textContent).toContain('다음 · Two');
    handle.destroy();
  });

  it('blacks out and back', () => {
    const { handle, container } = presenter();
    const sheet = container.querySelector('.cloth-presenter-blackout') as unknown as HTMLElement;
    expect(sheet.hidden).toBe(true);
    handle.toggleBlackout();
    expect(sheet.hidden).toBe(false);
    handle.destroy();
  });

  it('stops listening to the keyboard once destroyed', () => {
    const { handle } = presenter();
    handle.destroy();
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(handle.player.getState().time).toBe(0);
  });
});
