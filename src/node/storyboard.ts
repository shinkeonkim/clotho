// Rendering a storyboard.
//
// The frame choice is in core/storyboard; this is the half that needs a rasterizer
// and a filesystem. Reuses the same resvg the GIF renderer uses, so a sheet and a
// GIF of the same document agree about fonts and about what a `var(--cloth-*)`
// resolves to.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { AnimationDocument } from '../core/schema/document';
import {
  sheetLayout,
  storyboardTimes,
  CAPTION_HEIGHT,
  type StoryboardFrame,
  type StoryboardOptions,
} from '../core/storyboard';
import { renderDocumentToSvg } from '../svg/render';
import { serializeSceneBody } from '../svg/serialize';
import { buildScene } from '../core/scene/build';
import type { SceneOptions } from '../core/scene/context';

export interface StoryboardRenderOptions extends StoryboardOptions, SceneOptions {
  readonly columns?: number;
  /** Width of one cell in pixels. Defaults to the canvas width. */
  readonly cellWidth?: number;
  readonly gap?: number;
  readonly background?: string;
  /** Caption each cell with its chapter label and time. On by default. */
  readonly labels?: boolean;
  readonly theme?: 'light' | 'dark';
}

const PALETTE = {
  light: { paper: '#ffffff', ink: '#18181b', muted: '#71717a', border: '#e4e4e7' },
  dark: { paper: '#18181b', ink: '#f4f4f5', muted: '#a1a1aa', border: '#3f3f46' },
} as const;

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Substitute theme tokens with real colours.
 *
 * A standalone file has no stylesheet, so `var(--cloth-fg)` would resolve to nothing
 * and text would vanish. Same approach as the GIF renderer.
 */
function resolveTokens(svg: string, theme: 'light' | 'dark'): string {
  const palette = PALETTE[theme];
  const tokens: Record<string, string> = {
    '--cloth-fg': palette.ink,
    '--cloth-muted': palette.muted,
    '--cloth-border': palette.border,
    '--cloth-surface': palette.paper,
    '--cloth-surface-elevated': palette.paper,
    '--cloth-surface-subtle': palette.paper,
    '--cloth-stage-mat': palette.paper,
    '--cloth-scrim': theme === 'dark' ? '#000000' : '#0b1120',
    '--cloth-accent': '#6366f1',
    '--cloth-arrow': palette.muted,
  };
  return svg.replace(
    /var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,
    (_match, token: string, fallback?: string) => tokens[token] ?? fallback?.trim() ?? palette.ink,
  );
}

/** The whole contact sheet as one SVG document. */
export function renderStoryboardSvg(
  animation: AnimationDocument,
  options: StoryboardRenderOptions = {},
): { svg: string; frames: StoryboardFrame[] } {
  const frames = storyboardTimes(animation, options);
  const layout = sheetLayout(animation, frames.length, {
    columns: options.columns,
    cellWidth: options.cellWidth,
    gap: options.gap,
  });
  const gap = options.gap ?? 12;
  const theme = options.theme ?? 'light';
  const palette = PALETTE[theme];
  const paper = options.background ?? palette.paper;
  const showLabels = options.labels ?? true;
  const stageHeight = layout.cellHeight - CAPTION_HEIGHT;

  const cells = frames.map((frame, index) => {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const x = gap + column * (layout.cellWidth + gap);
    const y = gap + row * (layout.cellHeight + gap);

    // The body rather than a whole document: the cell already provides the `<svg>`
    // and the viewBox, and nesting a second one would leave two viewports arguing
    // about the same drawing.
    const stage = resolveTokens(
      serializeSceneBody(buildScene(animation, frame.time, { ...options, rawColors: false })),
      theme,
    );

    const caption = showLabels
      ? `<text x="${x + 4}" y="${y + stageHeight + 17}" font-size="12" fill="${palette.muted}" font-family="system-ui, sans-serif">${xml(
          frame.label ? `${index + 1}. ${frame.label}` : `${index + 1}.`,
        )}</text>` +
        `<text x="${x + layout.cellWidth - 4}" y="${y + stageHeight + 17}" font-size="12" fill="${palette.muted}" text-anchor="end" font-family="ui-monospace, monospace">${frame.time}ms</text>`
      : '';

    return (
      `<rect x="${x}" y="${y}" width="${layout.cellWidth}" height="${stageHeight}" rx="8" fill="${palette.paper}" stroke="${palette.border}"/>` +
      `<svg x="${x}" y="${y}" width="${layout.cellWidth}" height="${stageHeight}" viewBox="0 0 ${animation.canvas.width} ${animation.canvas.height}" preserveAspectRatio="xMidYMid meet">${stage}</svg>` +
      caption
    );
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">` +
    `<rect width="100%" height="100%" fill="${paper}"/>` +
    cells.join('') +
    '</svg>';

  return { svg, frames };
}

/** Rasterize the contact sheet. */
export function renderStoryboardPng(
  animation: AnimationDocument,
  options: StoryboardRenderOptions & { readonly width?: number } = {},
): { png: Uint8Array; frames: StoryboardFrame[] } {
  const { svg, frames } = renderStoryboardSvg(animation, options);
  const rendered = new Resvg(
    svg,
    options.width ? { fitTo: { mode: 'width', value: options.width } } : {},
  ).render();
  return { png: rendered.asPng(), frames };
}

export interface WrittenStoryboard {
  readonly files: readonly string[];
  readonly frames: readonly StoryboardFrame[];
}

/**
 * Write a storyboard to disk.
 *
 * A path ending in `.png` or `.svg` produces one contact sheet; anything else is
 * treated as a directory and gets one file per frame, which is the shape a slide
 * deck wants.
 */
export async function writeStoryboard(
  animation: AnimationDocument,
  out: string,
  options: StoryboardRenderOptions & {
    readonly width?: number;
    readonly format?: 'png' | 'svg';
  } = {},
): Promise<WrittenStoryboard> {
  const asSheet = out.endsWith('.png') || out.endsWith('.svg');

  if (asSheet) {
    await mkdir(dirname(out), { recursive: true });
    if (out.endsWith('.svg')) {
      const { svg, frames } = renderStoryboardSvg(animation, options);
      await writeFile(out, svg, 'utf-8');
      return { files: [out], frames };
    }
    const { png, frames } = renderStoryboardPng(animation, options);
    await writeFile(out, png);
    return { files: [out], frames };
  }

  await mkdir(out, { recursive: true });
  const frames = storyboardTimes(animation, options);
  const format = options.format ?? 'svg';
  const files: string[] = [];

  for (const [index, frame] of frames.entries()) {
    // Zero-padded so a directory listing and a slide order agree.
    const name = `${animation.id}-${String(index + 1).padStart(2, '0')}-${frame.time}ms.${format}`;
    const file = join(out, name);
    const svg = renderDocumentToSvg(animation, frame.time, { ...options, standalone: true });
    if (format === 'svg') {
      await writeFile(file, resolveTokens(svg, options.theme ?? 'light'), 'utf-8');
    } else {
      const rendered = new Resvg(
        resolveTokens(svg, options.theme ?? 'light'),
        options.width ? { fitTo: { mode: 'width', value: options.width } } : {},
      ).render();
      await writeFile(file, rendered.asPng());
    }
    files.push(file);
  }

  return { files, frames };
}
