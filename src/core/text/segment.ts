// Grapheme-aware text splitting.
//
// `'👨‍👩‍👧'.split('')` yields eleven broken fragments; `[...'👨‍👩‍👧']` yields five. Neither is
// what a reader would call a character. Anything that slices text for display —
// per-character reveals, truncation with an ellipsis — has to work in grapheme
// clusters or it will emit lone surrogates and orphaned combining marks.
//
// Nothing in clotho slices text today (text tracks step between whole strings), so
// this is here for the features that will: typewriter effects and label
// truncation. It is exported because an editor needs the same notion of
// "one character" for cursor movement.

/** True when the runtime provides `Intl.Segmenter` (all current browsers, Node 16+). */
export function hasSegmenter(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
}

let cachedSegmenter: Intl.Segmenter | null = null;

function segmenter(): Intl.Segmenter | null {
  if (!hasSegmenter()) return null;
  cachedSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return cachedSegmenter;
}

/**
 * Split into grapheme clusters, falling back to code points where `Intl.Segmenter`
 * is unavailable. The fallback still never splits a surrogate pair, so the worst
 * case is a family emoji rendering as its component people rather than as mojibake.
 */
export function segmentGraphemes(text: string): string[] {
  const seg = segmenter();
  if (!seg) return [...text];
  return Array.from(seg.segment(text), (s) => s.segment);
}

/** Number of user-perceived characters. */
export function graphemeLength(text: string): number {
  return segmentGraphemes(text).length;
}

/** First `count` grapheme clusters. */
export function sliceGraphemes(text: string, count: number): string {
  if (count <= 0) return '';
  const graphemes = segmentGraphemes(text);
  if (count >= graphemes.length) return text;
  return graphemes.slice(0, count).join('');
}

/**
 * Truncate to at most `max` grapheme clusters, appending `ellipsis` when cut.
 *
 * The ellipsis counts toward the budget, so the result never exceeds `max`.
 */
export function truncateGraphemes(text: string, max: number, ellipsis = '…'): string {
  const graphemes = segmentGraphemes(text);
  if (graphemes.length <= max) return text;
  const ellipsisLength = graphemeLength(ellipsis);
  const keep = Math.max(0, max - ellipsisLength);
  return graphemes.slice(0, keep).join('') + ellipsis;
}
