// SceneNode → live SVG elements, patched in place.
//
// A 12-second animation at 60fps is 720 frames. Rebuilding the subtree each time
// would allocate and discard thousands of elements a second and reset anything the
// browser tracks per-element (focus, CSS transitions, text selection). So the
// patcher matches nodes by key and updates only what changed, which is the same
// bargain React and Vue make — implemented here in about a hundred lines because the
// scene graph already did the hard part.
//
// Keys come from element ids, so they are stable across frames by construction.

import type { Scene, SceneAttrs, SceneDef, SceneNode, SceneTspan } from '../core/scene/nodes';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Attribute bookkeeping, so removals can be detected without reading the DOM. */
const appliedAttrs = new WeakMap<Element, Set<string>>();

function setAttrs(element: Element, attrs: SceneAttrs): void {
  const previous = appliedAttrs.get(element);
  const next = new Set<string>();

  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    const text = typeof value === 'number' ? formatNumber(value) : value;
    next.add(name);
    // Reading before writing avoids invalidating style/layout for unchanged values,
    // which is most of them on most frames.
    if (element.getAttribute(name) !== text) element.setAttribute(name, text);
  }

  if (previous) {
    for (const name of previous) {
      if (!next.has(name)) element.removeAttribute(name);
    }
  }
  appliedAttrs.set(element, next);
}

/** Numbers are already rounded by `compactAttrs`; see nodes.ts roundAttrNumber. */
function formatNumber(value: number): string {
  return String(value);
}

function setStyle(element: Element, node: SceneNode): void {
  const style = (element as SVGElement).style;
  if (!style) return;
  style.opacity = node.style?.opacity !== undefined ? String(node.style.opacity) : '';
  style.color = node.style?.color ?? '';
}

function createElement(kind: string): Element {
  return document.createElementNS(SVG_NS, kind);
}

/** Key an element by its scene key, so the next frame can find it. */
const KEY_ATTR = 'data-cloth-key';

function keyOf(element: Element): string | null {
  return element.getAttribute(KEY_ATTR);
}

function patchTspans(parent: Element, spans: readonly SceneTspan[]): void {
  const existing = new Map<string, Element>();
  for (const child of Array.from(parent.children)) {
    const key = keyOf(child);
    if (key !== null) existing.set(key, child);
  }

  const ordered: Element[] = [];
  for (const span of spans) {
    let element = existing.get(span.key);
    if (!element || element.tagName !== 'tspan') {
      element = createElement('tspan');
      element.setAttribute(KEY_ATTR, span.key);
    }
    existing.delete(span.key);
    setAttrs(element, span.attrs);
    element.setAttribute(KEY_ATTR, span.key);

    if (span.spans && span.spans.length > 0) {
      patchTspans(element, span.spans);
    } else {
      const text = span.content ?? '';
      // Clear any nested spans left from a previous frame before writing text.
      if (element.children.length > 0) element.textContent = text;
      else if (element.textContent !== text) element.textContent = text;
    }
    ordered.push(element);
  }

  for (const stale of existing.values()) stale.remove();
  reorder(parent, ordered);
}

function patchNodes(parent: Element, nodes: readonly SceneNode[]): void {
  const existing = new Map<string, Element>();
  for (const child of Array.from(parent.children)) {
    const key = keyOf(child);
    if (key !== null) existing.set(key, child);
  }

  const ordered: Element[] = [];
  for (const node of nodes) {
    let element = existing.get(node.key);
    // A key whose element changed kind (a resolved image replacing its placeholder)
    // has to be recreated; reusing a <rect> as an <image> is not possible.
    if (!element || element.tagName !== node.kind) {
      element = createElement(node.kind);
    }
    existing.delete(node.key);

    setAttrs(element, node.attrs);
    element.setAttribute(KEY_ATTR, node.key);
    setStyle(element, node);

    if (node.kind === 'g') {
      patchNodes(element, node.children);
    } else if (node.kind === 'text') {
      if (node.spans && node.spans.length > 0) {
        patchTspans(element, node.spans);
      } else {
        const text = node.content ?? '';
        if (element.children.length > 0) element.textContent = text;
        else if (element.textContent !== text) element.textContent = text;
      }
    }

    ordered.push(element);
  }

  for (const stale of existing.values()) stale.remove();
  reorder(parent, ordered);
}

/**
 * Put `ordered` in place as `parent`'s children, moving as few nodes as possible.
 *
 * Paint order is document order in SVG, so getting this wrong means labels
 * disappearing behind shapes.
 */
function reorder(parent: Element, ordered: readonly Element[]): void {
  let reference: ChildNode | null = null;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const element = ordered[i]!;
    if (element.nextSibling !== reference || element.parentNode !== parent) {
      parent.insertBefore(element, reference);
    }
    reference = element;
  }
}

function patchDefs(svg: Element, defs: readonly SceneDef[]): void {
  let container = svg.querySelector(':scope > defs');
  if (defs.length === 0) {
    container?.remove();
    return;
  }
  if (!container) {
    container = createElement('defs');
    svg.insertBefore(container, svg.firstChild);
  }

  const existing = new Map<string, Element>();
  for (const child of Array.from(container.children)) {
    const key = keyOf(child);
    if (key !== null) existing.set(key, child);
  }

  const ordered: Element[] = [];
  for (const def of defs) {
    let element = existing.get(def.key);
    if (!element) element = createElement('marker');
    existing.delete(def.key);
    setAttrs(element, def.attrs);
    element.setAttribute(KEY_ATTR, def.key);
    patchNodes(element, def.children);
    ordered.push(element);
  }
  for (const stale of existing.values()) stale.remove();
  reorder(container, ordered);
}

/**
 * Apply a scene to an `<svg>` element, reusing whatever is already there.
 *
 * Safe to call every frame; the first call effectively builds the tree.
 */
export function patchScene(svg: SVGSVGElement, scene: Scene): void {
  if (svg.getAttribute('viewBox') !== scene.viewBox) {
    svg.setAttribute('viewBox', scene.viewBox);
  }
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  if (scene.title) svg.setAttribute('aria-label', scene.title);
  else svg.removeAttribute('aria-label');
  svg.style.aspectRatio = scene.aspectRatio;
  svg.style.background = scene.background === 'transparent' ? '' : scene.background;

  patchDefs(svg, scene.defs);

  // Everything except <defs> belongs to the scene body.
  const body = Array.from(svg.children).filter((child) => child.tagName !== 'defs');
  const wrapper = ensureBodyGroup(svg, body);
  patchNodes(wrapper, scene.nodes);
}

/**
 * A single `<g>` holds the scene body, which keeps `<defs>` out of the keyed
 * reconciliation and gives the patcher one container to diff against.
 */
function ensureBodyGroup(svg: SVGSVGElement, body: readonly Element[]): Element {
  const existing = body.find((child) => child.getAttribute(KEY_ATTR) === '__body');
  if (existing) return existing;
  const group = createElement('g');
  group.setAttribute(KEY_ATTR, '__body');
  svg.append(group);
  return group;
}

/** Create an `<svg>` element sized for the scene, ready to patch into. */
export function createStageSvg(scene: Scene): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'cloth-stage-svg');
  patchScene(svg, scene);
  return svg;
}
