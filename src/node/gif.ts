import { writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { AnimationDocument } from '../core/schema/document';
import type { SceneOptions } from '../core/scene/context';
import { renderDocumentToSvg } from '../svg/render';

export interface GifExportOptions extends SceneOptions {
  /** Frames per second. Defaults to 12. */
  readonly fps?: number;
  /** Output width in pixels. Height follows the document aspect ratio. */
  readonly width?: number;
  /** Include the final timeline instant. Defaults to true. */
  readonly includeEndFrame?: boolean;
  /** GIF loop count: 0 forever, -1 once. Defaults to 0. */
  readonly repeat?: number;
  /** Opaque raster background. Defaults to white. */
  readonly background?: string;
  /** Maximum palette size per frame. Defaults to 256. */
  readonly colors?: number;
}

function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be greater than zero`);
  return value;
}

/** Render an animation document to an in-memory animated GIF. Node/Bun only. */
export function renderDocumentToGif(
  doc: AnimationDocument,
  options: GifExportOptions = {},
): Uint8Array {
  const fps = positive('fps', options.fps ?? 12);
  const width = Math.round(positive('width', options.width ?? doc.canvas.width));
  const colors = Math.round(positive('colors', options.colors ?? 256));
  if (colors < 2 || colors > 256) throw new Error('colors must be between 2 and 256');

  const interval = 1000 / fps;
  const frameCount = Math.max(1, Math.ceil(doc.duration / interval));
  const times = Array.from({ length: frameCount }, (_, index) => Math.min(index * interval, doc.duration));
  if (options.includeEndFrame !== false && times.at(-1) !== doc.duration) times.push(doc.duration);

  const gif = GIFEncoder();
  for (const [index, time] of times.entries()) {
    const svg = renderDocumentToSvg(doc, time, {
      assetResolver: options.assetResolver,
      fontFamily: options.fontFamily,
      monospaceFamily: options.monospaceFamily,
      standalone: true,
    });
    const image = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      background: options.background ?? '#ffffff',
      font: { loadSystemFonts: false, defaultFontFamily: 'sans-serif' },
    }).render();
    const pixels = new Uint8Array(image.pixels);
    const palette = quantize(pixels, colors);
    gif.writeFrame(applyPalette(pixels, palette), image.width, image.height, {
      palette,
      delay: Math.max(10, Math.round(interval / 10) * 10),
      repeat: index === 0 ? (options.repeat ?? 0) : undefined,
    });
  }
  gif.finish();
  return gif.bytes();
}

/** Render and write an animation document to a GIF file. Node/Bun only. */
export async function writeDocumentGif(
  doc: AnimationDocument,
  outputPath: string,
  options: GifExportOptions = {},
): Promise<void> {
  await writeFile(outputPath, renderDocumentToGif(doc, options));
}
