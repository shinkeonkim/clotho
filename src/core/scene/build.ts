// buildScene: (document, time, options) → Scene.
//
// The whole design turns on this being a pure function. Seeking, static frame
// export, server rendering, and editor scrubbing are the same call with a different
// `time`, and no adapter accumulates state that could drift from it.

import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import { aspectRatioStyle, viewBox } from '../geometry/stage';
import { resolveStageBackground } from '../theme/colors';
import { isNoopPhaseStyle, phaseStyleFromState } from '../theme/phase-styles';
import { toSvgTransform } from '../geometry/matrix';
import { computeSnapshot } from '../runtime/snapshot';
import { currentChapter, sortedChapters } from '../runtime/chapters';
import { activeEffectsByElement } from '../runtime/effects';
import {
  accumulatedMatrices,
  buildElementTree,
  resolveVisibility,
  type ElementNode,
} from '../runtime/tree';
import { DEFAULT_FONT_FAMILY, DEFAULT_MONOSPACE_FAMILY } from '../text/fonts';
import { collectMarkerDefs } from './markers';
import { compactAttrs, type Scene, type SceneDiagnostic, type SceneNode } from './nodes';
import type { ElementState, SceneContext, SceneOptions } from './context';
import { buildCircle, buildRect } from './elements/shapes';
import { buildArrow, buildLine, collectUsedHeads } from './elements/connectors';
import { buildImage, buildPath, buildPolygon, buildText } from './elements/text-image';
import { buildCode } from './elements/code';
import { buildFlowParticles } from './elements/particles';

/** Build the scene for one instant. */
export function buildScene(
  doc: AnimationDocument,
  time: number,
  options: SceneOptions = {},
): Scene {
  const snapshot = computeSnapshot(doc, time);
  const tree = buildElementTree(doc);
  const diagnostics: SceneDiagnostic[] = tree.issues.map((issue) => ({
    code: 'tree-issue' as const,
    elementId: issue.elementId,
    message: issue.message,
  }));

  const ctx: SceneContext = {
    doc,
    time,
    snapshot,
    tree,
    elementById: new Map(doc.elements.map((el) => [el.id, el])),
    matrices: accumulatedMatrices(tree, snapshot),
    visibility: resolveVisibility(tree, snapshot),
    effectsByElement: activeEffectsByElement(doc, time),
    options,
    diagnostics,
    fontFamily: options.fontFamily ?? DEFAULT_FONT_FAMILY,
    monospaceFamily: options.monospaceFamily ?? DEFAULT_MONOSPACE_FAMILY,
  };

  const nodes = buildNodes(ctx, tree.roots);
  nodes.push(...buildFlowParticles(ctx));

  const stage = resolveStageBackground(doc.canvas.background);

  return {
    canvas: doc.canvas,
    viewBox: viewBox(doc.canvas),
    aspectRatio: aspectRatioStyle(doc.canvas),
    background: stage.svgBackground,
    showMat: stage.showMat,
    title: doc.title,
    defs: collectMarkerDefs(collectUsedHeads(ctx)),
    nodes,
    chapter: currentChapter(doc, time),
    chapters: sortedChapters(doc),
    time,
    diagnostics,
  };
}

/**
 * Paint order within one sibling list: everything else, then text.
 *
 * Legacy sorted the entire flat element array this way so labels were never buried
 * under a later shape. Doing it per sibling list keeps that outcome identical for
 * documents without groups — which is all 383 existing ones — while letting a text
 * element inside a group stay inside it rather than being lifted to the top of the
 * stage.
 */
function textLast(nodes: readonly ElementNode[]): ElementNode[] {
  const others: ElementNode[] = [];
  const texts: ElementNode[] = [];
  for (const node of nodes) {
    (node.element.type === 'text' ? texts : others).push(node);
  }
  return [...others, ...texts];
}

function buildNodes(ctx: SceneContext, siblings: readonly ElementNode[]): SceneNode[] {
  const out: SceneNode[] = [];

  for (const node of textLast(siblings)) {
    const el = node.element;
    const state = ctx.snapshot.get(el.id);
    if (!state) continue;

    // Effective visibility already accounts for ancestor groups, so a hidden
    // subtree is skipped in one check here rather than at every level.
    if (ctx.visibility.get(el.id) === false) continue;

    const built = buildElementNode(ctx, el, state, node);
    if (built) out.push(built);
  }

  return out;
}

/**
 * One element, wrapped as needed for its transition and its children.
 *
 * Only groups have children: `buildElementTree` re-roots anything whose parent is
 * not a group, so a leaf never arrives here with a subtree.
 *
 * Wrappers are only emitted when they do something. A fully visible, unrotated leaf
 * produces a single node, keeping the output close to what legacy generated — and
 * every node keeps a key derived from its element id, so adapters that reconcile
 * between frames have stable identities to match on.
 */
function buildElementNode(
  ctx: SceneContext,
  el: AnimationElement,
  state: ElementState,
  node: ElementNode,
): SceneNode | null {
  let result: SceneNode | null;

  if (el.type === 'group') {
    const children = buildNodes(ctx, node.children);
    // An empty group is a transform around nothing; emitting it would only add a
    // node for adapters to reconcile.
    if (children.length === 0) return null;
    result = {
      kind: 'g',
      key: el.id,
      attrs: compactAttrs({ transform: groupTransformFor(state) }),
      children,
    };
  } else {
    result = buildOwnNode(ctx, el, state);
  }

  if (!result) return null;
  result = {
    ...result,
    attrs: compactAttrs({ ...result.attrs, 'data-clotho-id': el.id }),
  };

  const phase = phaseStyleFromState(el, state);
  if (isNoopPhaseStyle(phase)) return result;

  return {
    kind: 'g',
    key: `${el.id}-phase`,
    attrs: compactAttrs({
      transform: phase.transform ? toSvgTransform(phase.transform) : undefined,
    }),
    ...(phase.opacity !== undefined ? { style: { opacity: phase.opacity } } : {}),
    children: [result],
  };
}

function groupTransformFor(state: ElementState): string | undefined {
  const x = typeof state.x === 'number' ? state.x : 0;
  const y = typeof state.y === 'number' ? state.y : 0;
  const rotation = typeof state.rotation === 'number' ? state.rotation : 0;
  const parts: string[] = [];
  if (x !== 0 || y !== 0) parts.push(`translate(${x} ${y})`);
  if (rotation !== 0) parts.push(`rotate(${rotation})`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** The node for the element itself, or null for shapes that draw nothing. */
function buildOwnNode(
  ctx: SceneContext,
  el: AnimationElement,
  state: ElementState,
): SceneNode | null {
  switch (el.type) {
    case 'rect':
      return buildRect(ctx, el, state);
    case 'circle':
      return buildCircle(ctx, el, state);
    case 'line':
      return buildLine(ctx, el, state);
    case 'arrow':
      return buildArrow(ctx, el, state);
    case 'text':
      return buildText(ctx, el, state);
    case 'image':
      return buildImage(ctx, el, state);
    case 'path':
      return buildPath(ctx, el, state);
    case 'polygon':
      return buildPolygon(ctx, el, state);
    case 'code':
      return buildCode(ctx, el, state);
    case 'group':
      // A group is a transform and a visibility gate; it has no shape of its own.
      return null;
  }
}
