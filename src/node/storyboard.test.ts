// Storyboard rendering tests, against the real rasterizer and a temporary directory.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { animationDocumentSchema } from '../core/schema/document';
import { renderStoryboardPng, renderStoryboardSvg, writeStoryboard } from './storyboard';

const ALWAYS = [{ start: 0, end: 4000, entryDuration: 0, exitDuration: 0 }];

const animation = animationDocumentSchema.parse({
  clothoVersion: 1,
  id: 'walk',
  title: 'Walk',
  duration: 4000,
  canvas: { width: 200, height: 100, background: '#ffffff' },
  chapters: [
    { id: 'start', time: 0, label: 'Start' },
    { id: 'middle', time: 2000, label: 'Middle' },
  ],
  elements: [
    {
      type: 'circle',
      id: 'dot',
      cx: 20,
      cy: 50,
      r: 12,
      fill: '#6366f1',
      appearances: ALWAYS,
      tracks: [
        {
          property: 'cx',
          keyframes: [
            { time: 0, value: 20 },
            { time: 4000, value: 180, ease: 'linear' },
          ],
        },
      ],
    },
  ],
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clotho-storyboard-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('renderStoryboardSvg', () => {
  it('draws one cell per chapter', () => {
    const { svg, frames } = renderStoryboardSvg(animation);
    expect(frames).toHaveLength(2);
    // Each cell nests the stage in its own <svg>, plus the outer document.
    expect((svg.match(/<svg/g) ?? []).length).toBe(3);
  });

  it('captions each cell with its label and time', () => {
    const { svg } = renderStoryboardSvg(animation);
    expect(svg).toContain('1. Start');
    expect(svg).toContain('2. Middle');
    expect(svg).toContain('2000ms');
  });

  it('drops the captions when asked', () => {
    expect(renderStoryboardSvg(animation, { labels: false }).svg).not.toContain('Start');
  });

  /** A standalone file has no stylesheet, so a token would resolve to nothing. */
  it('resolves theme tokens to real colours', () => {
    expect(renderStoryboardSvg(animation).svg).not.toContain('var(--cloth-');
  });

  it('shows different moments in different cells', () => {
    const { svg } = renderStoryboardSvg(animation);
    // The dot moves, so the two cells cannot contain the same cx.
    const positions = [...svg.matchAll(/cx="([\d.]+)"/g)].map((match) => match[1]);
    expect(new Set(positions).size).toBeGreaterThan(1);
  });

  it('lays out the grid the caller asked for', () => {
    const { svg } = renderStoryboardSvg(animation, {
      selection: { mode: 'count', count: 4 },
      columns: 2,
      cellWidth: 100,
    });
    expect(svg).toContain('width="236"'); // 2 * 100 + 3 * 12
  });
});

describe('renderStoryboardPng', () => {
  it('rasterizes the sheet', () => {
    const { png, frames } = renderStoryboardPng(animation);
    expect(frames).toHaveLength(2);
    // PNG magic number, so this is a real image rather than an empty buffer.
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.length).toBeGreaterThan(1000);
  }, 20_000);
});

describe('writeStoryboard', () => {
  it('writes one contact sheet for a .png path', async () => {
    const out = join(dir, 'sheet.png');
    const result = await writeStoryboard(animation, out);
    expect(result.files).toEqual([out]);
    expect((await stat(out)).size).toBeGreaterThan(1000);
  }, 20_000);

  it('writes one contact sheet for a .svg path', async () => {
    const out = join(dir, 'sheet.svg');
    await writeStoryboard(animation, out);
    expect(await readFile(out, 'utf-8')).toContain('<svg');
  });

  it('writes one file per frame for a directory', async () => {
    const out = join(dir, 'frames');
    const result = await writeStoryboard(animation, out);
    expect(result.files).toHaveLength(2);
    const names = (await readdir(out)).sort();
    // Zero-padded so a directory listing and a slide order agree.
    expect(names[0]).toBe('walk-01-0ms.svg');
    expect(names[1]).toBe('walk-02-2000ms.svg');
  });

  it('writes PNGs per frame when asked', async () => {
    const out = join(dir, 'pngs');
    await writeStoryboard(animation, out, { format: 'png' });
    const names = await readdir(out);
    expect(names.every((name) => name.endsWith('.png'))).toBe(true);
  }, 20_000);

  it('creates the directory it was pointed at', async () => {
    const out = join(dir, 'deep', 'nested');
    await writeStoryboard(animation, out);
    expect((await readdir(out)).length).toBe(2);
  });
});
