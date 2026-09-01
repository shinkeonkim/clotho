import { writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { AnimationDocument } from '../core/schema/document';
import type { SceneOptions } from '../core/scene/context';
import { buildScene } from '../core/scene/build';
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
  /** Export the complete player chrome or only its SVG stage. Defaults to `player`. */
  readonly layout?: 'player' | 'stage';
  /** Palette used by the generated player chrome. Defaults to `light`. */
  readonly theme?: 'light' | 'dark';
  /** Optional font files for deterministic, faster rendering in CI or build scripts. */
  readonly fontFiles?: readonly string[];
}

const PALETTES = {
  light: {
    surface: '#ffffff',
    mat: '#fafafa',
    elevated: '#ffffff',
    fg: '#18181b',
    muted: '#71717a',
    border: '#e4e4e7',
    accent: '#6366f1',
    subtle: '#f4f4f5',
    arrow: '#94a3b8',
  },
  dark: {
    surface: '#18181b',
    mat: '#202024',
    elevated: '#27272a',
    fg: '#f4f4f5',
    muted: '#a1a1aa',
    border: '#3f3f46',
    accent: '#818cf8',
    subtle: '#27272a',
    arrow: '#a5b4cc',
  },
} as const;

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function resolveCssColors(svg: string, theme: 'light' | 'dark'): string {
  const p = PALETTES[theme];
  const tokens: Record<string, string> = {
    '--cloth-surface': p.surface,
    '--cloth-surface-subtle': p.subtle,
    '--cloth-surface-elevated': p.elevated,
    '--cloth-fg': p.fg,
    '--cloth-muted': p.muted,
    '--cloth-border': p.border,
    '--cloth-accent': p.accent,
    '--cloth-arrow': p.arrow,
  };
  return svg.replace(
    /var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,
    (_match, token: string, fallback?: string) => tokens[token] ?? fallback?.trim() ?? p.fg,
  );
}

/** Render one complete GIF frame as standalone SVG, including optional player UI. */
export function renderDocumentGifFrame(
  doc: AnimationDocument,
  time: number,
  options: GifExportOptions = {},
): string {
  const theme = options.theme ?? 'light';
  const p = PALETTES[theme];
  const stage = resolveCssColors(
    renderDocumentToSvg(doc, time, {
      assetResolver: options.assetResolver,
      fontFamily: options.fontFamily,
      monospaceFamily: options.monospaceFamily,
    }),
    theme,
  );
  if (options.layout === 'stage') return stage;

  const scene = buildScene(doc, time, options);
  const chapters = scene.chapters;
  const active =
    scene.chapter ?? (chapters.length > 0 ? { index: 0, chapter: chapters[0]! } : null);
  const showCaption = doc.settings.showCaption && active !== null;
  const showList = doc.settings.showChapterList && chapters.length > 0;
  const position = doc.settings.chapterListPosition;
  const side = showList && (position === 'left' || position === 'right');
  const horizontal = showList && (position === 'top' || position === 'bottom');
  const pad = 16;
  const gap = 12;
  const header = 58;
  const caption = showCaption ? 48 : 0;
  const railWidth = side ? Math.min(220, Math.max(170, doc.canvas.width * 0.28)) : 0;
  const railHeight = horizontal ? 78 : 0;
  const bodyTop = header + pad;
  const stageX = pad + (position === 'left' && side ? railWidth + gap : 0);
  const stageY = bodyTop + (position === 'top' && horizontal ? railHeight + gap : 0);
  const totalWidth = doc.canvas.width + pad * 2 + (side ? railWidth + gap : 0);
  const totalHeight =
    header + pad * 2 + doc.canvas.height + caption + (horizontal ? railHeight + gap : 0);
  const railX =
    position === 'left' ? pad : position === 'right' ? stageX + doc.canvas.width + gap : pad;
  const railY =
    position === 'top'
      ? bodyTop
      : position === 'bottom'
        ? stageY + doc.canvas.height + caption + gap
        : stageY;
  const railW = side ? railWidth : doc.canvas.width;
  const railH = side ? doc.canvas.height + caption : railHeight;

  const listItems = showList
    ? chapters
        .map((chapter, index) => {
          const current = active?.index === index;
          if (side) {
            const itemH = 58;
            const y = railY + 8 + index * (itemH + 7);
            return `<rect x="${railX + 8}" y="${y}" width="${railW - 16}" height="${itemH}" rx="8" fill="${current ? p.subtle : p.surface}" stroke="${current ? p.accent : p.border}"/><text x="${railX + 22}" y="${y + 24}" fill="${current ? p.accent : p.muted}" font-size="13">${index + 1}</text><text x="${railX + 48}" y="${y + 24}" fill="${p.fg}" font-size="15" font-weight="600">${xml(chapter.label || chapter.id)}</text>${chapter.subtitle ? `<text x="${railX + 48}" y="${y + 44}" fill="${p.muted}" font-size="11">${xml(chapter.subtitle)}</text>` : ''}`;
          }
          const itemW = Math.max(120, railW / chapters.length - 8);
          const x = railX + 8 + index * itemW;
          return `<rect x="${x}" y="${railY + 9}" width="${itemW - 7}" height="${railH - 18}" rx="8" fill="${current ? p.subtle : p.surface}" stroke="${current ? p.accent : p.border}"/><text x="${x + 12}" y="${railY + 35}" fill="${current ? p.accent : p.muted}" font-size="13">${index + 1}</text><text x="${x + 32}" y="${railY + 35}" fill="${p.fg}" font-size="14" font-weight="600">${xml(chapter.label || chapter.id)}</text>`;
        })
        .join('')
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}"><rect width="100%" height="100%" rx="14" fill="${p.surface}"/><rect x="0.5" y="0.5" width="${totalWidth - 1}" height="${totalHeight - 1}" rx="14" fill="none" stroke="${p.border}"/><line x1="0" y1="${header}" x2="${totalWidth}" y2="${header}" stroke="${p.border}"/><text x="${pad + 2}" y="37" fill="${p.fg}" font-size="20" font-weight="700">${xml(doc.title)}</text><rect x="${totalWidth - 188}" y="12" width="40" height="34" rx="8" fill="${p.surface}" stroke="${p.border}"/><text x="${totalWidth - 174}" y="35" fill="${p.muted}" font-size="18">Ⅱ</text><rect x="${totalWidth - 140}" y="12" width="40" height="34" rx="8" fill="${p.surface}" stroke="${p.border}"/><text x="${totalWidth - 128}" y="35" fill="${p.muted}" font-size="20">↻</text><rect x="${totalWidth - 92}" y="12" width="76" height="34" rx="8" fill="${p.surface}" stroke="${p.border}"/><text x="${totalWidth - 78}" y="34" fill="${p.muted}" font-size="13">1.00x</text><rect x="${stageX}" y="${stageY}" width="${doc.canvas.width}" height="${doc.canvas.height}" rx="10" fill="${p.mat}" stroke="${p.border}"/><svg x="${stageX}" y="${stageY}" width="${doc.canvas.width}" height="${doc.canvas.height}" viewBox="0 0 ${doc.canvas.width} ${doc.canvas.height}">${stage}</svg>${showCaption ? `<rect x="${stageX}" y="${stageY + doc.canvas.height + 8}" width="${doc.canvas.width}" height="${caption - 8}" rx="7" fill="${p.subtle}"/><rect x="${stageX}" y="${stageY + doc.canvas.height + 8}" width="4" height="${caption - 8}" fill="${p.accent}"/><text x="${stageX + 20}" y="${stageY + doc.canvas.height + 34}" fill="${p.muted}" font-size="16">Chapter ${active!.index + 1} / ${chapters.length}${active!.chapter.label ? `, ${xml(active!.chapter.label)}` : ''}</text>` : ''}${showList ? `<rect x="${railX}" y="${railY}" width="${railW}" height="${railH}" rx="10" fill="${p.surface}" stroke="${p.border}"/>${listItems}` : ''}</svg>`;
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
  const times = Array.from({ length: frameCount }, (_, index) =>
    Math.min(index * interval, doc.duration),
  );
  if (options.includeEndFrame !== false && times.at(-1) !== doc.duration) times.push(doc.duration);

  const gif = GIFEncoder();
  for (const [index, time] of times.entries()) {
    const svg = renderDocumentGifFrame(doc, time, options);
    const image = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      background: options.background ?? '#ffffff',
      font: {
        loadSystemFonts: options.fontFiles === undefined,
        fontFiles: options.fontFiles ? [...options.fontFiles] : undefined,
        defaultFontFamily: 'sans-serif',
      },
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
