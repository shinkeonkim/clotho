// SceneNode → React elements.
//
// The whole React renderer, replacing legacy's seven renderer modules. It knows
// nothing about rects or arrows — the scene graph already decided all of that — so
// there is only one place left for a React-specific bug to live.

import { createElement, type ReactElement, type ReactNode } from 'react';
import type { Scene, SceneDef, SceneNode, SceneTspan } from '../core/scene/nodes';
import { toReactProps } from './attrs';

function styleOf(node: SceneNode): Record<string, string | number> | undefined {
  if (!node.style) return undefined;
  const style: Record<string, string | number> = {};
  if (node.style.opacity !== undefined) style.opacity = node.style.opacity;
  if (node.style.color !== undefined) style.color = node.style.color;
  return Object.keys(style).length > 0 ? style : undefined;
}

function renderTspan(span: SceneTspan): ReactElement {
  const props = toReactProps(span.attrs);
  const children: ReactNode =
    span.spans && span.spans.length > 0 ? span.spans.map(renderTspan) : (span.content ?? '');
  return createElement('tspan', { ...props, key: span.key }, children);
}

/** One scene node as a React element. */
export function renderSceneNode(node: SceneNode): ReactElement {
  const props: Record<string, unknown> = { ...toReactProps(node.attrs), key: node.key };
  const style = styleOf(node);
  if (style) props.style = style;

  if (node.kind === 'g') {
    return createElement('g', props, node.children.map(renderSceneNode));
  }
  if (node.kind === 'text') {
    const children: ReactNode =
      node.spans && node.spans.length > 0 ? node.spans.map(renderTspan) : (node.content ?? '');
    return createElement('text', props, children);
  }
  return createElement(node.kind, props);
}

function renderDef(def: SceneDef): ReactElement {
  return createElement(
    'marker',
    { ...toReactProps(def.attrs), key: def.key },
    def.children.map(renderSceneNode),
  );
}

export interface SceneSvgProps {
  readonly scene: Scene;
  readonly className?: string;
}

/**
 * The scene as an `<svg>` element.
 *
 * Marker definitions come through as elements rather than injected markup, so
 * nothing here needs `dangerouslySetInnerHTML` — which legacy did need.
 */
export function SceneSvg({ scene, className }: SceneSvgProps): ReactElement {
  return createElement(
    'svg',
    {
      viewBox: scene.viewBox,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': scene.title || undefined,
      className,
      style: {
        aspectRatio: scene.aspectRatio,
        ...(scene.background !== 'transparent' ? { background: scene.background } : {}),
      },
    },
    scene.defs.length > 0
      ? createElement('defs', { key: '__defs' }, scene.defs.map(renderDef))
      : null,
    ...scene.nodes.map(renderSceneNode),
  );
}
