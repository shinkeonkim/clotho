// The spotlight: take contrast away from everything except the targets.
//
// `highlight` makes one element stand out by replacing its fill, which costs the
// element its own color. In a document where color carries meaning — visited,
// type, owner — that is a real loss, and on a stage with forty elements a single
// yellow fill does not gather the eye anyway.
//
// This does the opposite: the targets are left exactly as they are and a scrim is
// laid over the rest. The scrim is one rectangle wearing a mask, so the cost is two
// nodes no matter how many elements are on stage.
//
// Masks are luminance-based: white shows the scrim, black hides it. So the mask is
// a white rectangle with the targets punched out in black. Verified against resvg
// (the rasterizer behind the GIF renderer) including inside nested transforms,
// which is what made the mask approach viable rather than the alternative of
// drawing the dim layer and then re-drawing every target on top of it.

import type { SpotlightEffect } from '../schema/effects';
import { padBounds, type Bounds } from '../geometry/bounds';
import { elementsRootBounds } from '../runtime/bounds';
import { clamp } from '../timing/ease';
import { compactAttrs, type SceneDef, type SceneNode, type SceneAttrs } from './nodes';
import { report, type SceneContext } from './context';

/** Prefix for spotlight mask ids. */
export const SPOTLIGHT_ID_PREFIX = 'cloth-spot';

/**
 * Scrim color, as a theme token with a literal fallback.
 *
 * Dimming means darkening in both themes — a light scrim over a dark stage would
 * raise the floor rather than lower it — so the token resolves to a near-black in
 * either. The fallback is what a standalone SVG file and the GIF renderer see.
 */
const SCRIM_VAR = 'var(--cloth-scrim, #0b1120)';
const SCRIM_RAW = '#0b1120';

export interface SpotlightOutput {
  readonly defs: readonly SceneDef[];
  readonly nodes: readonly SceneNode[];
}

const EMPTY: SpotlightOutput = { defs: [], nodes: [] };

/**
 * Scrim opacity at `time`, ramping in and out over `fadeIn`.
 *
 * The ramp is applied at both ends for the same reason `pulse` uses a half sine:
 * an effect that ends must leave no residue, and nothing resets the stage after it.
 * When the two ramps would overlap they are each capped at half the duration, so a
 * short spotlight becomes a quick swell rather than snapping to full dim.
 */
export function spotlightOpacity(effect: SpotlightEffect, time: number): number {
  if (effect.duration <= 0 || effect.dim <= 0) return 0;
  const elapsed = time - effect.time;
  if (elapsed < 0 || elapsed >= effect.duration) return 0;

  const ramp = Math.min(effect.fadeIn, effect.duration / 2);
  if (ramp <= 0) return effect.dim;

  const rising = clamp(elapsed / ramp, 0, 1);
  const falling = clamp((effect.duration - elapsed) / ramp, 0, 1);
  return effect.dim * Math.min(rising, falling);
}

/** A black shape that punches `bounds` out of the scrim. */
function holeForBounds(effect: SpotlightEffect, bounds: Bounds): SceneNode {
  if (effect.shape === 'circle') {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const radius = Math.hypot(bounds.width, bounds.height) / 2 + effect.padding;
    return {
      kind: 'circle',
      key: `${effect.id}-hole`,
      attrs: compactAttrs({ cx, cy, r: radius, fill: '#000000' }),
    };
  }
  const padded = padBounds(bounds, effect.padding);
  return {
    kind: 'rect',
    key: `${effect.id}-hole`,
    attrs: compactAttrs({
      x: padded.x,
      y: padded.y,
      width: padded.width,
      height: padded.height,
      fill: '#000000',
    }),
  };
}

/**
 * Recolor a subtree so only its coverage survives into the mask.
 *
 * A mask reads luminance, so a target's own colors would punch a partial hole —
 * a pale fill would leave the scrim half on. Every paint becomes pure black and
 * every opacity is dropped. `padding` becomes a black stroke of twice its width,
 * which dilates the silhouette by exactly the padding on every side.
 */
function toMaskShape(node: SceneNode, padding: number, keyPrefix: string): SceneNode {
  const attrs: SceneAttrs = { ...node.attrs };
  delete attrs.opacity;
  delete attrs['fill-opacity'];
  delete attrs['stroke-opacity'];
  delete attrs['data-clotho-id'];

  const paints: SceneAttrs = {};
  if (node.kind !== 'g') {
    paints.fill = '#000000';
    if (padding > 0) {
      paints.stroke = '#000000';
      paints['stroke-width'] = padding * 2;
      paints['stroke-linejoin'] = 'round';
    } else if (attrs.stroke !== undefined) {
      paints.stroke = '#000000';
    }
  }

  const key = `${keyPrefix}-${node.key}`;
  if (node.kind === 'g') {
    return {
      kind: 'g',
      key,
      attrs: { ...attrs, ...paints },
      children: node.children.map((child) => toMaskShape(child, padding, key)),
    };
  }
  return { ...node, key, attrs: { ...attrs, ...paints } };
}

/** Find the built node for an element, which is keyed by the element id. */
function findNode(nodes: readonly SceneNode[], elementId: string): SceneNode | null {
  for (const node of nodes) {
    if (node.key === elementId) return node;
    if (node.kind === 'g') {
      const found = findNode(node.children, elementId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Build the scrim for every active spotlight.
 *
 * All of them share one scrim rather than each getting its own. Stacked scrims
 * would darken twice where they overlap, and worse, one spotlight's scrim would dim
 * the other's target — so the holes are unioned and the opacity is the strongest of
 * them.
 */
export function buildSpotlights(
  ctx: SceneContext,
  spotlights: readonly SpotlightEffect[],
  nodes: readonly SceneNode[],
  view: Bounds,
): SpotlightOutput {
  if (spotlights.length === 0) return EMPTY;

  const holes: SceneNode[] = [];
  let opacity = 0;

  for (const effect of spotlights) {
    const strength = spotlightOpacity(effect, ctx.time);
    if (strength <= 0) continue;

    const { bounds, unresolved } = elementsRootBounds(
      effect.elementIds,
      {
        snapshot: ctx.snapshot,
        tree: ctx.tree,
        elementById: ctx.elementById,
        matrices: ctx.matrices,
        options: { measurer: ctx.options.measurer, fontFamily: ctx.fontFamily },
      },
      ctx.visibility,
    );

    if (unresolved.length > 0) {
      report(ctx, {
        code: 'spotlight-target',
        elementId: unresolved[0]!,
        message: `spotlight "${effect.id}" cannot frame ${unresolved.join(', ')}: not on stage at ${ctx.time}ms`,
      });
    }
    // Nothing to keep lit means the scrim would cover the whole stage. Dimming
    // everything says less than doing nothing, so the effect sits this frame out.
    if (!bounds) continue;

    opacity = Math.max(opacity, strength);

    if (effect.shape === 'elements') {
      const shapes = effect.elementIds
        .map((id) => findNode(nodes, id))
        .filter((node): node is SceneNode => node !== null)
        .map((node) => toMaskShape(node, effect.padding, effect.id));
      // A target with no drawn node (an empty group) still deserves its area lit.
      holes.push(...(shapes.length > 0 ? shapes : [holeForBounds(effect, bounds)]));
    } else {
      holes.push(holeForBounds(effect, bounds));
    }
  }

  if (holes.length === 0 || opacity <= 0) return EMPTY;

  // Ids are global to the page, so they carry the document id: two players showing
  // different documents can each have a spotlight called `sp-1`.
  const maskId = `${SPOTLIGHT_ID_PREFIX}-${ctx.doc.id}`;
  const cover = compactAttrs({
    x: view.x,
    y: view.y,
    width: view.width,
    height: view.height,
  });

  const def: SceneDef = {
    key: maskId,
    kind: 'mask',
    attrs: compactAttrs({ id: maskId, maskUnits: 'userSpaceOnUse', ...cover }),
    children: [{ kind: 'rect', key: 'lit', attrs: { ...cover, fill: '#ffffff' } }, ...holes],
  };

  const scrim: SceneNode = {
    kind: 'rect',
    key: maskId,
    attrs: compactAttrs({
      ...cover,
      fill: ctx.options.rawColors ? SCRIM_RAW : SCRIM_VAR,
      opacity,
      mask: `url(#${maskId})`,
      'pointer-events': 'none',
    }),
  };

  return { defs: [def], nodes: [scrim] };
}
