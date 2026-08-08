// Do the four adapters agree?
//
// This is the test the whole Q4 design rests on. The claim is that renderer logic
// lives in the scene graph and each adapter is a thin mapping — if that holds, the
// same scene must produce the same SVG through all four paths. If it stops holding,
// the adapters have started to drift and the scene graph is no longer the single
// source of truth.
//
// React and Vue are rendered through their server renderers, so this needs no DOM;
// the DOM adapter is exercised separately against happy-dom.

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderToString as renderVueToString } from '@vue/server-renderer';
import { createSSRApp, h } from 'vue';
import { animationDocumentSchema } from '../src/core/schema/document';
import { buildScene } from '../src/core/scene/build';
import type { Scene } from '../src/core/scene/nodes';
import { serializeScene } from '../src/svg/serialize';
import { SceneSvg } from '../src/react/scene';
import { renderSceneSvg } from '../src/vue/scene';

const ALWAYS = [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }];

/** A document exercising every element type and both effect kinds that alter shapes. */
const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'every-shape',
  title: 'Every shape & <kind>',
  duration: 1000,
  canvas: { width: 500, height: 400, background: '#ffffff' },
  assets: { logo: { kind: 'inline', mime: 'image/png', data: 'AQID' } },
  elements: [
    {
      type: 'rect',
      id: 'box',
      x: 10,
      y: 10,
      width: 120,
      height: 60,
      label: '가나 & <b>',
      subtitle: 'one\ntwo',
      rotation: 15,
      appearances: ALWAYS,
    },
    { type: 'circle', id: 'dot', cx: 300, cy: 40, r: 25, label: 'C', appearances: ALWAYS },
    {
      type: 'arrow',
      id: 'ar',
      fromId: 'box',
      toId: 'dot',
      fromAnchor: 'right',
      toAnchor: 'left',
      headEnd: 'arrow',
      headStart: 'circle',
      label: 'go',
      curvature: 20,
      appearances: ALWAYS,
    },
    {
      type: 'line',
      id: 'ln',
      x1: 10,
      y1: 200,
      x2: 200,
      y2: 200,
      strokeDasharray: '4 4',
      appearances: ALWAYS,
    },
    { type: 'text', id: 'tx', x: 250, y: 200, content: 'text & <esc>', appearances: ALWAYS },
    { type: 'path', id: 'pt', d: 'M 0 0 L 10 10', x: 5, y: 5, appearances: ALWAYS },
    {
      type: 'polygon',
      id: 'pg',
      points: '10,300 60,300 35,340',
      rotation: 30,
      appearances: ALWAYS,
    },
    {
      type: 'image',
      id: 'im',
      x: 300,
      y: 280,
      width: 60,
      height: 40,
      assetId: 'logo',
      alt: '로고',
      appearances: ALWAYS,
    },
    { type: 'group', id: 'grp', x: 400, y: 300, rotation: 10, appearances: ALWAYS },
    {
      type: 'rect',
      id: 'kid',
      parentId: 'grp',
      x: 0,
      y: 0,
      width: 30,
      height: 20,
      appearances: ALWAYS,
    },
    {
      type: 'code',
      id: 'cd',
      x: 150,
      y: 100,
      width: 200,
      height: 70,
      content: 'const 한글 = 1; // 주석\nreturn "x";',
      showLineNumbers: true,
      title: 'demo.js',
      appearances: ALWAYS,
    },
    {
      type: 'rect',
      id: 'fading',
      x: 400,
      y: 10,
      width: 40,
      height: 40,
      appearances: [{ start: 0, end: 1000, entryMode: 'slide-left', entryDuration: 400 }],
    },
  ],
  effects: [
    { type: 'pulse', id: 'p1', elementId: 'dot', time: 0, duration: 1000, scale: 1.3 },
    { type: 'highlight', id: 'h1', elementId: 'box', time: 0, duration: 1000, color: '#ff0000' },
    { type: 'flow', id: 'f1', elementId: 'ar', time: 0, duration: 1000, particles: 3 },
  ],
});

/**
 * Normalize markup for comparison.
 *
 * Each framework has harmless spelling differences: React emits `class`, Vue may
 * order style declarations differently, and both may or may not self-close an empty
 * element. What must match is the element tree and every attribute value.
 */
function normalize(markup: string): string {
  return markup
    .replace(/<!--[^]*?-->/g, '') // Vue SSR anchors
    .replace(/\s*\/>/g, '/>')
    .replace(/>\s+</g, '><')
    .replace(/;"/g, '"') // trailing semicolon in a style attribute
    .trim();
}

/** Element names and their attribute maps, in document order. */
function extractTree(markup: string): { tag: string; attrs: Record<string, string> }[] {
  const out: { tag: string; attrs: Record<string, string> }[] = [];
  for (const match of markup.matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const attr of (match[2] ?? '').matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attrs[attr[1]!] = attr[2]!;
    }
    out.push({ tag: match[1]!, attrs });
  }
  return out;
}

/** Decode the entities the frameworks disagree about escaping. */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Text content in document order, entity-decoded.
 *
 * React escapes `"` in text content and the string serializer does not — both are
 * valid XML meaning the same thing, so the comparison is on decoded text.
 */
function extractText(markup: string): string[] {
  return [...markup.matchAll(/>([^<>]+)</g)]
    .map((m) => decodeEntities(m[1]!).trim())
    .filter((text) => text.length > 0 && !text.startsWith('<!--'));
}

/** Attributes both frameworks spell their own way, excluded from strict comparison. */
const FRAMEWORK_SPECIFIC = new Set(['class', 'style']);

function comparableTree(markup: string): { tag: string; attrs: Record<string, string> }[] {
  return extractTree(markup).map(({ tag, attrs }) => {
    const filtered: Record<string, string> = {};
    for (const [name, value] of Object.entries(attrs)) {
      if (!FRAMEWORK_SPECIFIC.has(name)) filtered[name] = value;
    }
    return { tag, attrs: filtered };
  });
}

async function renderVue(scene: Scene): Promise<string> {
  const app = createSSRApp({ render: () => h('div', renderSceneSvg(scene, 'cloth-stage-svg')) });
  const html = await renderVueToString(app);
  return html.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
}

describe('adapter equivalence', () => {
  const scene = buildScene(doc, 500);

  const svgMarkup = serializeScene(scene, { className: 'cloth-stage-svg' });
  const reactMarkup = renderToStaticMarkup(SceneSvg({ scene, className: 'cloth-stage-svg' }));

  it('the fixture actually exercises every element type', () => {
    const types = new Set(doc.elements.map((el) => el.type));
    expect(types.size).toBe(10);
  });

  it('react and the svg serializer produce the same element tree', () => {
    expect(comparableTree(normalize(reactMarkup))).toEqual(comparableTree(normalize(svgMarkup)));
  });

  it('vue and the svg serializer produce the same element tree', async () => {
    const vueMarkup = await renderVue(scene);
    expect(comparableTree(normalize(vueMarkup))).toEqual(comparableTree(normalize(svgMarkup)));
  });

  it('all three produce the same text content', async () => {
    const vueMarkup = await renderVue(scene);
    const expected = extractText(normalize(svgMarkup));
    expect(extractText(normalize(reactMarkup))).toEqual(expected);
    expect(extractText(normalize(vueMarkup))).toEqual(expected);
    // Guard against the comparison passing because everything is empty.
    expect(expected).toContain('가나 & <b>');
  });

  it('react receives camelCased props where SVG uses hyphens', () => {
    // The mapping must be invisible in the output: stroke-width in, stroke-width out.
    expect(reactMarkup).toContain('stroke-width=');
    expect(reactMarkup).not.toContain('strokeWidth=');
    expect(reactMarkup).toContain('preserveAspectRatio=');
    expect(reactMarkup).toContain('xml:space=');
  });

  it('every adapter escapes text the same way', async () => {
    const vueMarkup = await renderVue(scene);
    for (const markup of [svgMarkup, reactMarkup, vueMarkup]) {
      expect(markup).not.toContain('<b>');
      expect(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(markup)).toBe(false);
    }
  });

  it('every adapter emits the same marker definitions', async () => {
    const vueMarkup = await renderVue(scene);
    const markerIds = (markup: string) =>
      [...markup.matchAll(/<marker[^>]*id="([^"]+)"/g)].map((m) => m[1]).sort();
    const expected = markerIds(svgMarkup);
    // Ids carry the connector's color: markers bake it in rather than inheriting via
    // currentColor, which does not reach into a <marker> from the referencing element.
    expect(expected).toEqual(['cloth-h-arrow-6366f1', 'cloth-h-circle-6366f1']);
    expect(markerIds(reactMarkup)).toEqual(expected);
    expect(markerIds(vueMarkup)).toEqual(expected);
  });

  it('agrees across the timeline, not just at one instant', async () => {
    for (const time of [0, 200, 999]) {
      const frame = buildScene(doc, time);
      const expected = comparableTree(normalize(serializeScene(frame)));
      expect(comparableTree(normalize(renderToStaticMarkup(SceneSvg({ scene: frame }))))).toEqual(
        expected,
      );
      expect(comparableTree(normalize(await renderVue(frame)))).toEqual(expected);
    }
  });
});
