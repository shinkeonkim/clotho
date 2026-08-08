// SceneNode → SVG markup.
//
// Implemented first among the adapters, for three reasons: it is pure, so it can be
// snapshot-tested; it needs no framework, so it validates that the scene graph is
// genuinely framework-free; and it gives the other adapters an answer to compare
// against (TASKS 4.1).
//
// It is also the only adapter that has to escape anything. React, Vue, and
// `textContent` all escape for you; a string builder does not, and text in these
// documents contains `&`, `<`, and `>` routinely.

import type { Scene, SceneAttrs, SceneDef, SceneNode, SceneTspan } from '../core/scene/nodes';
import { sanitizeXmlAttr, sanitizeXmlText } from '../core/text/escape';

export interface SerializeOptions {
  /** Indent nested elements and put each on its own line. Off by default. */
  readonly pretty?: boolean;
  /** Emit the XML declaration and namespace, for a standalone `.svg` file. */
  readonly standalone?: boolean;
  /** Class attribute for the root `<svg>`. */
  readonly className?: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Six decimals is well past SVG rendering precision and keeps output stable
  // enough to snapshot; -0 would otherwise serialize as "-0".
  const rounded = Number(value.toFixed(6));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function serializeAttrs(attrs: SceneAttrs): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    const text = typeof value === 'number' ? formatNumber(value) : sanitizeXmlAttr(value);
    parts.push(`${name}="${text}"`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/** `style` for the node, built from the scene's structured style. */
function serializeStyle(node: SceneNode): string {
  const style = node.style;
  if (!style) return '';
  const parts: string[] = [];
  if (style.opacity !== undefined) parts.push(`opacity:${formatNumber(style.opacity)}`);
  if (style.color !== undefined) parts.push(`color:${style.color}`);
  if (parts.length === 0) return '';
  return ` style="${sanitizeXmlAttr(parts.join(';'))}"`;
}

function serializeTspan(span: SceneTspan, indent: string, nl: string): string {
  const attrs = serializeAttrs(span.attrs);
  if (span.spans && span.spans.length > 0) {
    const inner = span.spans.map((child) => serializeTspan(child, '', '')).join('');
    return `${indent}<tspan${attrs}>${inner}</tspan>${nl}`;
  }
  return `${indent}<tspan${attrs}>${sanitizeXmlText(span.content ?? '')}</tspan>${nl}`;
}

function serializeNode(node: SceneNode, depth: number, options: SerializeOptions): string {
  const pretty = options.pretty === true;
  const indent = pretty ? '  '.repeat(depth) : '';
  const nl = pretty ? '\n' : '';
  const attrs = serializeAttrs(node.attrs) + serializeStyle(node);

  if (node.kind === 'g') {
    if (node.children.length === 0) return `${indent}<g${attrs} />${nl}`;
    const inner = node.children.map((child) => serializeNode(child, depth + 1, options)).join('');
    return `${indent}<g${attrs}>${nl}${inner}${indent}</g>${nl}`;
  }

  if (node.kind === 'text') {
    if (node.spans && node.spans.length > 0) {
      const inner = node.spans
        .map((span) => serializeTspan(span, pretty ? '  '.repeat(depth + 1) : '', nl))
        .join('');
      return `${indent}<text${attrs}>${nl}${inner}${indent}</text>${nl}`;
    }
    return `${indent}<text${attrs}>${sanitizeXmlText(node.content ?? '')}</text>${nl}`;
  }

  return `${indent}<${node.kind}${attrs} />${nl}`;
}

function serializeDef(def: SceneDef, depth: number, options: SerializeOptions): string {
  const pretty = options.pretty === true;
  const indent = pretty ? '  '.repeat(depth) : '';
  const nl = pretty ? '\n' : '';
  const inner = def.children.map((child) => serializeNode(child, depth + 1, options)).join('');
  return `${indent}<marker${serializeAttrs(def.attrs)}>${nl}${inner}${indent}</marker>${nl}`;
}

/** Serialize the scene body — defs and nodes, without the enclosing `<svg>`. */
export function serializeSceneBody(scene: Scene, options: SerializeOptions = {}): string {
  const pretty = options.pretty === true;
  const nl = pretty ? '\n' : '';
  const defs =
    scene.defs.length > 0
      ? `${pretty ? '  ' : ''}<defs>${nl}${scene.defs
          .map((def) => serializeDef(def, 2, options))
          .join('')}${pretty ? '  ' : ''}</defs>${nl}`
      : '';
  const nodes = scene.nodes.map((node) => serializeNode(node, 1, options)).join('');
  return defs + nodes;
}

/**
 * Serialize a whole scene as an `<svg>` element.
 *
 * `standalone` adds the namespace declarations a file needs to open on its own;
 * without it the output is meant for inlining into an HTML document that already
 * has them.
 */
export function serializeScene(scene: Scene, options: SerializeOptions = {}): string {
  const pretty = options.pretty === true;
  const nl = pretty ? '\n' : '';

  const rootAttrs = serializeAttrs({
    ...(options.standalone ? { xmlns: SVG_NS, 'xmlns:xlink': XLINK_NS } : {}),
    viewBox: scene.viewBox,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': scene.title || undefined,
    class: options.className,
    ...(scene.background !== 'transparent' ? { style: `background:${scene.background}` } : {}),
  });

  const body = serializeSceneBody(scene, options);
  const prolog = options.standalone ? `<?xml version="1.0" encoding="UTF-8"?>${nl}` : '';
  return `${prolog}<svg${rootAttrs}>${nl}${body}</svg>`;
}
