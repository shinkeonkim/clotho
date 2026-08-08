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
import { createManualScheduler } from '../src/core/player/scheduler';

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
  g.SVGElement = window.SVGElement;
  g.IntersectionObserver = undefined;
  g.matchMedia = undefined;
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.Element;
  delete g.SVGElement;
  delete g.IntersectionObserver;
  delete g.matchMedia;
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
