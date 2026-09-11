// Typesetting for the `math` element.
//
// The same shape as the code highlighter next door, and for the same reason: this
// is a capability the core has an opinion about the *placement* of but not the
// implementation of. A TeX typesetter is larger than this entire core — KaTeX
// several times over — and a package that went to the trouble of keeping zod out of
// its rendering adapters is not going to bundle one.
//
// So the host injects it. Without one the element still renders: the TeX source is
// drawn as monospace text and a diagnostic says why. That follows the same rule as
// an unresolved asset — draw a placeholder and report it, rather than returning null
// and leaving the author to wonder where their element went.

import type { SceneNode } from './nodes';

export interface MathRenderOptions {
  readonly fontSize: number;
  readonly color: string;
  readonly display: 'block' | 'inline';
  /**
   * Which side of the origin the expression should sit on.
   *
   * The typesetter has to apply this because it is the only party that knows how
   * wide its output is — the core hands over a string and gets back a subtree it
   * cannot measure. Ignoring it leaves `textAnchor: "middle"` doing nothing while
   * the element's bounds, which do shift by it, describe a box the expression is
   * not in.
   */
  readonly textAnchor: 'start' | 'middle' | 'end';
}

/**
 * Turns a TeX expression into a subtree.
 *
 * The subtree is in the element's own coordinate space, with the origin at the
 * element's anchor point, so the renderer never has to know where on the canvas the
 * expression sits — exactly as `highlightLine` never has to know where the line is.
 * `textAnchor` says which side of that origin to lay out from.
 *
 * Returning null means "I could not typeset this", which falls back to the source
 * text rather than drawing nothing.
 */
export interface MathRenderer {
  readonly name: string;
  render(tex: string, options: MathRenderOptions): SceneNode | null;
}
