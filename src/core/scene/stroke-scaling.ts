// Keep stroke weight constant while the camera zooms.
//
// Zooming an SVG viewBox scales strokes along with everything else, which is what
// an optical camera does and is the default (`strokeScaling: "scale"`). Dense
// diagrams often want the opposite: lines that stay one weight no matter how far
// in the camera goes.
//
// The obvious mechanism is `vector-effect="non-scaling-stroke"`, but it is a
// rendering hint whose support varies across the four adapters and the resvg
// rasterizer behind the GIF renderer — and "same result everywhere" is the promise
// this package is built on. Dividing the numbers instead is arithmetic every
// renderer already agrees about.

import { roundAttrNumber, type SceneNode } from './nodes';

const STROKE_WIDTH = 'stroke-width';

/** Multiply every `stroke-width` in the tree by `factor`. */
export function scaleStrokeWidths(nodes: readonly SceneNode[], factor: number): SceneNode[] {
  if (!Number.isFinite(factor) || factor === 1) return [...nodes];
  return nodes.map((node) => scaleNode(node, factor));
}

function scaleNode(node: SceneNode, factor: number): SceneNode {
  const width = node.attrs[STROKE_WIDTH];
  const attrs =
    typeof width === 'number'
      ? { ...node.attrs, [STROKE_WIDTH]: roundAttrNumber(width * factor) }
      : node.attrs;

  if (node.kind === 'g') {
    return { ...node, attrs, children: node.children.map((child) => scaleNode(child, factor)) };
  }
  return { ...node, attrs };
}
