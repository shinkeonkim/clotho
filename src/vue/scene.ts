// SceneNode → Vue vnodes.
//
// Shorter than the React mapper because Vue passes unknown attributes through to the
// DOM verbatim: the scene's SVG attribute names (`stroke-width`, `xml:space`) need no
// conversion at all. That is the second payoff of storing SVG spelling in the scene.

import { h, type VNode } from 'vue';
import type { Scene, SceneDef, SceneNode, SceneTspan } from '../core/scene/nodes';

function attrsOf(node: SceneNode): Record<string, unknown> {
  const attrs: Record<string, unknown> = { ...node.attrs, key: node.key };
  if (node.style) {
    const style: Record<string, string | number> = {};
    if (node.style.opacity !== undefined) style.opacity = node.style.opacity;
    if (node.style.color !== undefined) style.color = node.style.color;
    if (Object.keys(style).length > 0) attrs.style = style;
  }
  return attrs;
}

function renderTspan(span: SceneTspan): VNode {
  const attrs = { ...span.attrs, key: span.key };
  if (span.spans && span.spans.length > 0) return h('tspan', attrs, span.spans.map(renderTspan));
  return h('tspan', attrs, span.content ?? '');
}

/** One scene node as a vnode. */
export function renderSceneNode(node: SceneNode): VNode {
  const attrs = attrsOf(node);

  if (node.kind === 'g') return h('g', attrs, node.children.map(renderSceneNode));
  if (node.kind === 'text') {
    if (node.spans && node.spans.length > 0) return h('text', attrs, node.spans.map(renderTspan));
    return h('text', attrs, node.content ?? '');
  }
  return h(node.kind, attrs);
}

function renderDef(def: SceneDef): VNode {
  return h('marker', { ...def.attrs, key: def.key }, def.children.map(renderSceneNode));
}

/** The scene as an `<svg>` vnode. */
export function renderSceneSvg(scene: Scene, className?: string): VNode {
  const children: VNode[] = [];
  if (scene.defs.length > 0) {
    children.push(h('defs', { key: '__defs' }, scene.defs.map(renderDef)));
  }
  children.push(...scene.nodes.map(renderSceneNode));

  return h(
    'svg',
    {
      viewBox: scene.viewBox,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': scene.title || undefined,
      class: className,
      style: {
        aspectRatio: scene.aspectRatio,
        ...(scene.background !== 'transparent' ? { background: scene.background } : {}),
      },
    },
    children,
  );
}
