// Which properties a track may name.
//
// The parser drops unknown keys, so a track pointing at a property the element type
// does not have parses cleanly, validates cleanly, and animates nothing. That is the
// same failure as a typo in an element field — which the validator has caught since
// the beginning — except tracks were never checked.
//
// A survey of the 383-document corpus found 35 such tracks in 17 documents, and
// perturbing each one's keyframes changed not a single rendered byte: all 35 are
// inert. Three quarters of them name a property that exists on a *different* element
// type (`text.fill` where `color` is the name, `rect.content` where `label` is,
// `circle.subtitle` which only rect has), which is why the finding can usually say
// where the author's name does live.
//
// The set is derived from the schema rather than maintained by hand. There is no
// separate list of "names the renderer reads from state" to keep in sync: state is
// built from element fields and tracks, so a name the schema does not declare cannot
// reach the renderer at all. The corpus experiment is the evidence for that.

import { elementSchema } from './elements';
import type { AnimationElement } from './elements';

/**
 * Schema fields that are structure rather than appearance.
 *
 * Every element declares these, and none of them means anything as a track target —
 * `tracks` animating `tracks` is not a thing. Excluded so the check catches them
 * too, though the corpus contains none.
 */
const STRUCTURAL = new Set(['type', 'id', 'name', 'parentId', 'appearances', 'tracks', 'bindings']);

function shapeOf(schema: unknown): Record<string, unknown> {
  return (schema as { shape: Record<string, unknown> }).shape;
}

/** Element type → the property names that type declares, minus the structural ones. */
const BY_TYPE: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  elementSchema.options.map((option) => {
    const shape = shapeOf(option);
    const type = (shape.type as { _def: { value: string } })._def.value;
    return [type, new Set(Object.keys(shape).filter((key) => !STRUCTURAL.has(key)))] as const;
  }),
);

/** Property name → the element types that declare it. Powers the "did you mean". */
const BY_PROPERTY: ReadonlyMap<string, readonly string[]> = (() => {
  const owners = new Map<string, string[]>();
  for (const [type, properties] of BY_TYPE) {
    for (const property of properties) {
      const list = owners.get(property) ?? [];
      list.push(type);
      owners.set(property, list);
    }
  }
  return owners;
})();

/**
 * The properties a track may animate on this element.
 *
 * Takes the element rather than the type string so a caller with an element in hand
 * — an editor building a property picker, say — does not have to narrow it first.
 */
export function animatablePropertiesFor(element: AnimationElement): ReadonlySet<string> {
  return BY_TYPE.get(element.type) ?? new Set();
}

/** The element types that declare `property`, in schema order. Empty if none do. */
export function elementTypesWithProperty(property: string): readonly string[] {
  return BY_PROPERTY.get(property) ?? [];
}
