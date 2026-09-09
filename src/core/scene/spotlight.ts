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
import { isIdentity, toSvgTransform, type Matrix } from '../geometry/matrix';
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
 * How far into the effect's ramp `time` is, from 0 to 1.
 *
 * The ramp is applied at both ends for the same reason `pulse` uses a half sine:
 * an effect that ends must leave no residue, and nothing resets the stage after it.
 * When the two ramps would overlap they are each capped at half the duration, so a
 * short spotlight becomes a quick swell rather than snapping to full strength.
 *
 * Separate from the opacities so that the scrim and the lit wash share one curve.
 * A spotlight that only tints — `dim: 0`, `lit: 0.3` — has to ramp too, and that
 * cannot come from the scrim's own opacity, which is zero throughout.
 */
export function spotlightProgress(effect: SpotlightEffect, time: number): number {
  if (effect.duration <= 0) return 0;
  const elapsed = time - effect.time;
  if (elapsed < 0 || elapsed >= effect.duration) return 0;

  const ramp = Math.min(effect.fadeIn, effect.duration / 2);
  if (ramp <= 0) return 1;

  const rising = clamp(elapsed / ramp, 0, 1);
  const falling = clamp((effect.duration - elapsed) / ramp, 0, 1);
  return Math.min(rising, falling);
}

/** Scrim opacity at `time`. */
export function spotlightOpacity(effect: SpotlightEffect, time: number): number {
  return effect.dim <= 0 ? 0 : effect.dim * spotlightProgress(effect, time);
}

/** Opacity of the wash over the lit area at `time`. */
export function spotlightLitOpacity(effect: SpotlightEffect, time: number): number {
  return effect.lit <= 0 ? 0 : effect.lit * spotlightProgress(effect, time);
}

/** A shape that punches `bounds` out of the scrim, painted in the mask's ink. */
function holeForBounds(effect: SpotlightEffect, bounds: Bounds, paint: string): SceneNode {
  if (effect.shape === 'circle') {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const radius = Math.hypot(bounds.width, bounds.height) / 2 + effect.padding;
    return {
      kind: 'circle',
      key: `${effect.id}-hole`,
      attrs: compactAttrs({ cx, cy, r: radius, fill: paint }),
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
      fill: paint,
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
function toMaskShape(
  node: SceneNode,
  padding: number,
  keyPrefix: string,
  paint: string,
): SceneNode {
  const attrs: SceneAttrs = { ...node.attrs };
  delete attrs.opacity;
  delete attrs['fill-opacity'];
  delete attrs['stroke-opacity'];
  delete attrs['data-clotho-id'];

  // Markers do not survive into the mask. They default to `markerUnits:
  // strokeWidth`, and the mask's stroke *is* the padding — so a connector's
  // arrowhead came out at multiples of its real size, a huge triangle of lit
  // canvas hanging off the end of the line. The dilated line already covers where
  // the head sits, and the head's own def is coloured, which in a luminance mask
  // would punch a partial hole anyway.
  delete attrs['marker-start'];
  delete attrs['marker-mid'];
  delete attrs['marker-end'];

  const paints: SceneAttrs = {};
  if (node.kind !== 'g') {
    // A shape that does not fill must not fill in the mask either. A curved
    // connector would otherwise light the whole area between its arc and its
    // chord, which is nowhere near the shape the reader sees.
    paints.fill = attrs.fill === 'none' ? 'none' : paint;
    if (padding > 0) {
      paints.stroke = paint;
      paints['stroke-width'] = padding * 2;
      paints['stroke-linejoin'] = 'round';
      paints['stroke-linecap'] = 'round';
    } else if (attrs.stroke !== undefined) {
      paints.stroke = paint;
    }
  }

  const key = `${keyPrefix}-${node.key}`;
  if (node.kind === 'g') {
    return {
      kind: 'g',
      key,
      attrs: { ...attrs, ...paints },
      children: node.children.map((child) => toMaskShape(child, padding, key, paint)),
    };
  }
  return { ...node, key, attrs: { ...attrs, ...paints } };
}

/**
 * The built node for an element, keyed by its id.
 *
 * The phase wrapper is preferred over the element's own node. An element part way
 * through a slide or a zoom is drawn inside `${id}-phase`, which carries the
 * transition's transform, and taking the inner node instead would punch the hole
 * where the element is going to be rather than where it currently is.
 */
function findNode(nodes: readonly SceneNode[], elementId: string): SceneNode | null {
  const phaseKey = `${elementId}-phase`;
  for (const node of nodes) {
    if (node.key === phaseKey || node.key === elementId) return node;
    if (node.kind === 'g') {
      const found = findNode(node.children, elementId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Move a mask shape into root space.
 *
 * The mask's children hang off the mask, not off the group the element lives in, so
 * an element drawn inside `<g transform="translate(300 200)">` would have its hole
 * punched at the group's origin — lighting empty canvas while the target stays
 * dark. `accumulatedMatrices` already knows every element's ancestor transform, so
 * the shape is wrapped in it.
 */
function inRootSpace(shape: SceneNode, matrix: Matrix | undefined): SceneNode {
  if (!matrix || isIdentity(matrix)) return shape;
  return {
    kind: 'g',
    key: `${shape.key}-at`,
    attrs: { transform: toSvgTransform(matrix) },
    children: [shape],
  };
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

  const cover = compactAttrs({
    x: view.x,
    y: view.y,
    width: view.width,
    height: view.height,
  });

  /** Holes for one effect, painted in whichever ink the mask needs. */
  const holesFor = (
    effect: SpotlightEffect,
    bounds: Bounds,
    paint: string,
    keySuffix: string,
  ): SceneNode[] => {
    if (effect.shape !== 'elements') return [holeForBounds(effect, bounds, paint)];
    const shapes = effect.elementIds
      .map((id) => {
        const node = findNode(nodes, id);
        return node
          ? inRootSpace(
              toMaskShape(node, effect.padding, `${effect.id}${keySuffix}`, paint),
              ctx.matrices.get(id),
            )
          : null;
      })
      .filter((node): node is SceneNode => node !== null);
    // A target with no drawn node (an empty group) still deserves its area lit.
    return shapes.length > 0 ? shapes : [holeForBounds(effect, bounds, paint)];
  };

  const scrimHoles: SceneNode[] = [];
  const washes: { effect: SpotlightEffect; opacity: number; holes: SceneNode[] }[] = [];
  let opacity = 0;
  let dimColor: string | undefined;

  for (const effect of spotlights) {
    const progress = spotlightProgress(effect, ctx.time);
    if (progress <= 0) continue;

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

    const scrimOpacity = effect.dim * progress;
    if (scrimOpacity > 0) {
      scrimHoles.push(...holesFor(effect, bounds, '#000000', ''));
      // The strongest spotlight decides the colour as well as the opacity. Two
      // scrims in different colours cannot be one rectangle, and stacking them
      // would darken the overlap twice — which is the thing sharing a scrim exists
      // to prevent.
      if (scrimOpacity > opacity) dimColor = effect.dimColor;
      opacity = Math.max(opacity, scrimOpacity);
    }

    const litOpacity = effect.lit * progress;
    if (litOpacity > 0) {
      washes.push({
        effect,
        opacity: litOpacity,
        holes: holesFor(effect, bounds, '#ffffff', '-lit'),
      });
    }
  }

  const defs: SceneDef[] = [];
  const out: SceneNode[] = [];
  const maskBase = `${SPOTLIGHT_ID_PREFIX}-${ctx.doc.id}`;

  if (scrimHoles.length > 0 && opacity > 0) {
    // Ids are global to the page, so they carry the document id: two players
    // showing different documents can each have a spotlight called `sp-1`.
    defs.push({
      key: maskBase,
      kind: 'mask',
      attrs: compactAttrs({ id: maskBase, maskUnits: 'userSpaceOnUse', ...cover }),
      children: [{ kind: 'rect', key: 'lit', attrs: { ...cover, fill: '#ffffff' } }, ...scrimHoles],
    });
    out.push({
      kind: 'rect',
      key: maskBase,
      attrs: compactAttrs({
        ...cover,
        fill: dimColor ?? (ctx.options.rawColors ? SCRIM_RAW : SCRIM_VAR),
        opacity,
        mask: `url(#${maskBase})`,
        'pointer-events': 'none',
      }),
    });
  }

  // The wash is the inverse: black cover, white targets, so only the lit area is
  // painted. One per effect rather than one shared, because two coloured gels are
  // two colours — and unlike scrims, two washes overlapping is what a viewer would
  // expect from two lamps.
  for (const wash of washes) {
    const maskId = `${maskBase}-lit-${wash.effect.id}`;
    defs.push({
      key: maskId,
      kind: 'mask',
      attrs: compactAttrs({ id: maskId, maskUnits: 'userSpaceOnUse', ...cover }),
      children: [
        { kind: 'rect', key: 'unlit', attrs: { ...cover, fill: '#000000' } },
        ...wash.holes,
      ],
    });
    out.push({
      kind: 'rect',
      key: maskId,
      attrs: compactAttrs({
        ...cover,
        fill: wash.effect.litColor,
        opacity: wash.opacity,
        mask: `url(#${maskId})`,
        'pointer-events': 'none',
      }),
    });
  }

  return out.length > 0 ? { defs, nodes: out } : EMPTY;
}
