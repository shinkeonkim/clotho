import type { AnimationDocument, AnimationElement } from '../core/schema';
import { buildScene } from '../core/scene/build';
import type { SceneNode } from '../core/scene/nodes';
import { computeSnapshot } from '../core/runtime/snapshot';
import { serializeScene } from '../svg/serialize';

export class AnimationAssertionError extends Error {
  constructor(
    message: string,
    public readonly time: number,
    public readonly elementId?: string,
  ) {
    super(`${message} (t=${time}${elementId ? `, element=${elementId}` : ''})`);
    this.name = 'AnimationAssertionError';
  }
}

function flatten(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) => [node, ...(node.kind === 'g' ? flatten(node.children) : [])]);
}

function textOf(node: SceneNode): string {
  if (node.kind === 'text')
    return node.content ?? node.spans?.map(({ content }) => content).join('') ?? '';
  return node.kind === 'g' ? node.children.map(textOf).join('') : '';
}

function nodeId(node: SceneNode): string | undefined {
  const value = node.attrs['data-clotho-id'];
  return typeof value === 'string' ? value : undefined;
}

export interface FrameAssertion {
  visible(id: string): FrameAssertion;
  hidden(id: string): FrameAssertion;
  textIncludes(value: string, id?: string): FrameAssertion;
  connected(fromId: string, toId: string): FrameAssertion;
  position(
    id: string,
    expected: Readonly<Record<string, number>>,
    tolerance?: number,
  ): FrameAssertion;
  insideCanvas(id: string): FrameAssertion;
}

export function expectAnimation(doc: AnimationDocument): { at(time: number): FrameAssertion } {
  return {
    at(time) {
      const scene = buildScene(doc, time);
      const nodes = flatten(scene.nodes);
      const state = computeSnapshot(doc, time);
      const fail = (message: string, id?: string): never => {
        throw new AnimationAssertionError(message, time, id);
      };
      const assertion: FrameAssertion = {
        visible(id) {
          if (!nodes.some((node) => nodeId(node) === id))
            fail('expected element to be visible', id);
          return assertion;
        },
        hidden(id) {
          if (nodes.some((node) => nodeId(node) === id)) fail('expected element to be hidden', id);
          return assertion;
        },
        textIncludes(value, id) {
          const candidates = id ? nodes.filter((node) => nodeId(node) === id) : nodes;
          if (!candidates.some((node) => textOf(node).includes(value)))
            fail(`expected text to include ${JSON.stringify(value)}`, id);
          return assertion;
        },
        connected(fromId, toId) {
          const connector = doc.elements.find(
            (element) =>
              (element.type === 'line' || element.type === 'arrow') &&
              element.fromId === fromId &&
              element.toId === toId,
          );
          if (!connector || !nodes.some((node) => nodeId(node) === connector.id))
            fail(`expected a visible connector from ${fromId} to ${toId}`);
          return assertion;
        },
        position(id, expected, tolerance = 0.001) {
          const actual = state.get(id);
          if (!actual) return fail('element has no runtime state', id);
          for (const [property, wanted] of Object.entries(expected)) {
            const received = actual[property];
            if (typeof received !== 'number' || Math.abs(received - wanted) > tolerance)
              fail(`expected ${property}=${wanted}, received ${String(received)}`, id);
          }
          return assertion;
        },
        insideCanvas(id) {
          const element = doc.elements.find((item) => item.id === id);
          const actual = state.get(id);
          if (!element || !actual) return fail('element has no runtime state', id);
          const box = elementBox(element, actual);
          if (
            !box ||
            box.x < 0 ||
            box.y < 0 ||
            box.x + box.width > doc.canvas.width ||
            box.y + box.height > doc.canvas.height
          )
            fail(`element is outside ${doc.canvas.width}×${doc.canvas.height}`, id);
          return assertion;
        },
      };
      return assertion;
    },
  };
}

function elementBox(element: AnimationElement, state: Readonly<Record<string, unknown>>) {
  if (element.type === 'rect' || element.type === 'image' || element.type === 'code')
    return {
      x: Number(state.x),
      y: Number(state.y),
      width: Number(state.width),
      height: Number(state.height),
    };
  if (element.type === 'circle') {
    const r = Number(state.r);
    return { x: Number(state.cx) - r, y: Number(state.cy) - r, width: r * 2, height: r * 2 };
  }
  return null;
}

export interface AnimationSample {
  readonly time: number;
  readonly locale?: string;
  readonly theme: 'light' | 'dark';
  readonly svg: string;
}

export function animationSampleTimes(doc: AnimationDocument): number[] {
  const times = new Set<number>([
    0,
    doc.duration,
    ...doc.chapters.map(({ time }) => time),
    ...doc.checkpoints.map(({ time }) => time),
  ]);
  doc.elements.forEach((element) =>
    element.tracks.forEach((track) => track.keyframes.forEach(({ time }) => times.add(time))),
  );
  return [...times].sort((a, b) => a - b);
}

export function snapshotAnimationMatrix(
  doc: AnimationDocument,
  options: { locales?: readonly string[]; themes?: readonly ('light' | 'dark')[] } = {},
): AnimationSample[] {
  const locales = options.locales ?? doc.locales;
  const themes = options.themes ?? ['light', 'dark'];
  return animationSampleTimes(doc).flatMap((time) =>
    locales.flatMap((locale) =>
      themes.map((theme) => ({
        time,
        locale,
        theme,
        svg: serializeScene(buildScene(doc, time, { locale }), { standalone: true }),
      })),
    ),
  );
}

export interface PixelDiff {
  readonly changed: number;
  readonly ratio: number;
  readonly diff: Uint8Array;
}

export function diffRgba(actual: Uint8Array, expected: Uint8Array, threshold = 0): PixelDiff {
  if (actual.length !== expected.length || actual.length % 4 !== 0)
    throw new Error('RGBA buffers must have the same pixel length');
  const diff = new Uint8Array(actual.length);
  let changed = 0;
  for (let index = 0; index < actual.length; index += 4) {
    const mismatch = [0, 1, 2, 3].some(
      (offset) => Math.abs(actual[index + offset]! - expected[index + offset]!) > threshold,
    );
    if (mismatch) changed += 1;
    diff.set(
      mismatch ? [255, 0, 255, 255] : [actual[index]!, actual[index + 1]!, actual[index + 2]!, 80],
      index,
    );
  }
  return { changed, ratio: changed / (actual.length / 4), diff };
}

/** WCAG contrast ratio for six-digit hex colors; null for unresolved CSS colors. */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseRgb(foreground);
  const bg = parseRgb(background);
  if (!fg || !bg) return null;
  const luminance = ([red, green, blue]: readonly number[]) => {
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(red!) + 0.7152 * channel(green!) + 0.0722 * channel(blue!);
  };
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(value: string): readonly [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return null;
  const packed = Number.parseInt(match[1]!, 16);
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
}

export function animationFailureReport(errors: readonly AnimationAssertionError[]): string {
  const rows = errors
    .map(
      (error) =>
        `<tr><td>${error.time}</td><td>${escapeHtml(error.elementId ?? '')}</td><td>${escapeHtml(error.message)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Clotho visual report</title><style>body{font-family:system-ui;padding:24px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style><h1>Animation QA</h1><table><thead><tr><th>Time</th><th>Element</th><th>Failure</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
