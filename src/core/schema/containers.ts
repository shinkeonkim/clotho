// Which elements may hold children.
//
// Separate from ./elements.ts, which defines the zod schemas, for the same reason
// ./effect-targets.ts is: the render path needs this predicate — `buildElementTree`
// runs on every frame — and importing a *value* from a module that builds schemas
// drags zod into svg, dom, react, vue and testing, which receive documents already
// parsed and never pay for the validator.
//
// Types are free to come from there; values are not.

import type { AnimationElement } from './elements';

/**
 * Element types that may be a `parentId` target.
 *
 * `group` is the obvious one: a transform with no geometry of its own. `math` joined
 * it when baking arrived — a baked expression is a set of `path` elements that have
 * to hang off something, and hanging them off the `math` element itself is what lets
 * the original keep its `tex`, `alt`, appearance window and tracks instead of having
 * them copied onto a substitute group. Structurally the two are the same shape: both
 * render as a `<g>` carrying a translate and a rotate, and both take their
 * children's geometry as their own.
 */
export function canContainChildren(el: AnimationElement): boolean {
  return el.type === 'group' || el.type === 'math';
}
