import { describe, expect, it } from 'bun:test';
import { animationDocumentSchema } from '../core/schema/document';
import { Resvg } from '@resvg/resvg-js';
import { renderDocumentGifFrame, renderDocumentToGif } from './gif';

const doc = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'gif-test',
  duration: 100,
  canvas: { width: 80, height: 40 },
  elements: [
    {
      type: 'circle',
      id: 'dot',
      cx: 20,
      cy: 20,
      r: 8,
      fill: '#6366f1',
      appearances: [{ start: 0, end: 100 }],
      tracks: [
        {
          property: 'cx',
          keyframes: [
            { time: 0, value: 20 },
            { time: 100, value: 60 },
          ],
        },
      ],
    },
  ],
});

describe('GIF export', () => {
  it('composes the complete player, caption and chapter list by default', () => {
    const chaptered = animationDocumentSchema.parse({
      ...doc,
      title: 'Complete player',
      chapters: [{ id: 'start', time: 0, label: 'Start', subtitle: 'Ready' }],
      settings: { showCaption: true, showChapterList: true, chapterListPosition: 'right' },
    });
    const frame = renderDocumentGifFrame(chaptered, 0);
    expect(frame).toContain('Complete player');
    expect(frame).toContain('Chapter 1 / 1, Start');
    expect(frame).toContain('Ready');
    expect(frame).toContain('1.00x');
    expect(frame).not.toContain('var(--cloth-');
  });

  it('can export only the raw stage when requested', () => {
    const frame = renderDocumentGifFrame(doc, 0, { layout: 'stage' });
    expect(frame).not.toContain('1.00x');
    expect(frame).toContain('<circle');
  });

  it('renders an animated GIF byte stream', () => {
    const bytes = renderDocumentToGif(doc, { fps: 10, width: 80 });
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.length).toBeGreaterThan(100);
  }, 15_000);

  it('rejects invalid frame rates', () => {
    expect(() => renderDocumentToGif(doc, { fps: 0 })).toThrow('fps must be greater than zero');
  });
});

/**
 * Does the mask survive the rasterizer?
 *
 * The spotlight is one masked rectangle. That is only a good design if resvg — the
 * rasterizer behind every GIF this package writes — agrees with the browser about
 * what a `<mask>` means, including inside the nested transforms that groups
 * produce. If it did not, the fallback would be to draw the scrim and then redraw
 * every target on top of it, so this test is load-bearing rather than incidental.
 */
describe('spotlight through resvg', () => {
  const lit = animationDocumentSchema.parse({
    clothoVersion: 1,
    id: 'spotlit',
    duration: 1000,
    canvas: { width: 200, height: 100, background: '#ffffff' },
    elements: [
      {
        type: 'group',
        id: 'g',
        x: 20,
        y: 20,
        appearances: [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }],
      },
      {
        type: 'rect',
        id: 'keep',
        parentId: 'g',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        fill: '#22c55e',
        strokeWidth: 0,
        cornerRadius: 0,
        appearances: [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }],
      },
      {
        type: 'rect',
        id: 'dimmed',
        x: 140,
        y: 20,
        width: 40,
        height: 40,
        fill: '#22c55e',
        strokeWidth: 0,
        cornerRadius: 0,
        appearances: [{ start: 0, end: 1000, entryDuration: 0, exitDuration: 0 }],
      },
    ],
    effects: [
      {
        type: 'spotlight',
        id: 'sp',
        elementIds: ['keep'],
        time: 0,
        duration: 1000,
        fadeIn: 0,
        padding: 0,
        dim: 0.8,
      },
    ],
  });

  /**
   * The stage layout is a fragment; the player layout nests it inside an outer
   * `<svg>`. Wrapping it the same way here keeps the mask inside a nested viewport,
   * which is exactly where it has to survive.
   */
  function stageDocument(time: number): string {
    const stage = renderDocumentGifFrame(lit, time, { layout: 'stage' });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="100%" height="100%" fill="#ffffff"/><svg width="200" height="100" viewBox="0 0 200 100">${stage}</svg></svg>`;
  }

  /** One rasterization, probed several times — resvg loads system fonts per call. */
  function raster(time: number) {
    const rendered = new Resvg(stageDocument(time), {
      fitTo: { mode: 'width', value: 200 },
    }).render();
    const pixels = rendered.pixels as Uint8Array;
    const width = rendered.width;
    return (x: number, y: number): [number, number, number] => {
      const i = (y * width + x) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    };
  }

  it('resolves the scrim token to a real color before rasterizing', () => {
    const stage = renderDocumentGifFrame(lit, 500, { layout: 'stage' });
    expect(stage).toContain('mask=');
    expect(stage).not.toContain('var(--cloth-scrim');
  });

  it('leaves the target untouched and darkens the rest', () => {
    const at = raster(500);
    // Inside the spotlight, through a group transform: the authored green, exactly.
    expect(at(40, 40)).toEqual([34, 197, 94]);

    // The same green outside it, dimmed by the scrim.
    const [r, g, b] = at(160, 40);
    expect(g).toBeLessThan(197);
    expect(r + g + b).toBeLessThan(34 + 197 + 94);

    // Blank stage under the scrim goes dark too.
    const [wr, wg, wb] = at(100, 90);
    expect(wr + wg + wb).toBeLessThan(3 * 255);
  }, 20_000);

  it('restores the stage once the effect is over', () => {
    const at = raster(1000);
    expect(at(160, 40)).toEqual([34, 197, 94]);
    expect(at(100, 90)).toEqual([255, 255, 255]);
  }, 20_000);
});
