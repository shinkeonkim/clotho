// SVG attribute names → React prop names.
//
// The scene graph stores attributes the way SVG spells them (`stroke-width`,
// `xml:space`). React wants camelCase for the ones it knows about. The conversion is
// mechanical and, importantly, leaves alone the SVG attributes that are *already*
// camelCase — `preserveAspectRatio`, `viewBox`, `markerWidth`, `refX` — because they
// contain no separator. That asymmetry is exactly why the scene stores SVG spelling
// rather than React's: the reverse conversion would mangle them.
//
// A handful of names need explicit mapping because React's prop does not follow from
// mechanical conversion.

import type { SceneAttrs } from '../core/scene/nodes';

/** Names whose React prop is not a mechanical conversion of the SVG name. */
const EXPLICIT: Record<string, string> = {
  class: 'className',
  'xml:space': 'xmlSpace',
  'xml:lang': 'xmlLang',
  'xlink:href': 'xlinkHref',
};

/**
 * Attributes React expects to stay hyphenated.
 *
 * `data-*` and `aria-*` are passed through verbatim by React and must not be
 * camelCased, or `aria-label` would silently become an unknown `ariaLabel` prop.
 */
function isPassThrough(name: string): boolean {
  return name.startsWith('data-') || name.startsWith('aria-');
}

const cache = new Map<string, string>();

/** Convert one SVG attribute name to its React prop name. */
export function toReactPropName(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  let result: string;
  if (EXPLICIT[name]) result = EXPLICIT[name];
  else if (isPassThrough(name)) result = name;
  else result = name.replace(/[-:]([a-z])/g, (_match, char: string) => char.toUpperCase());

  cache.set(name, result);
  return result;
}

/** Convert a whole attribute bag for use as React props. */
export function toReactProps(attrs: SceneAttrs): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    props[toReactPropName(name)] = value;
  }
  return props;
}
