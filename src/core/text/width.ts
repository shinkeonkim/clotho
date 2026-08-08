// Text width estimation.
//
// This exists because of a real bug found in the legacy engine, not as a
// precaution. Its code renderer computed `charWidth = fontSize * 0.6` and used it
// to size the line-number gutter:
//
//   const charWidth = c.fontSize * 0.6;
//   const lineNumberWidth = showLineNumbers ? String(lines.length).length * charWidth + 12 : 0;
//
// In a monospace font a CJK character occupies two cells, not one. Any code block
// containing Korean, Japanese, or Chinese text — the common case in the corpus this
// package was extracted from — therefore mismeasured, and the gutter and text
// drifted out of alignment.
//
// The estimate here is deliberately coarse. Real metrics need a font and a
// measuring context, neither of which belongs in a pure core, so hosts that care
// about exact layout inject a `TextMeasurer` (docs/ARCHITECTURE.md §1, principle 6).

/**
 * East Asian Wide and Fullwidth ranges, per Unicode UAX #11.
 *
 * Trimmed to the blocks that actually appear in technical writing rather than
 * transcribing the full table: CJK ideographs and the surrounding punctuation,
 * Hangul, kana, fullwidth forms, and the emoji blocks that render double-width.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK Radicals, Kangxi, CJK Symbols and Punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo, CJK Compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms, Small Form Variants
  [0xff00, 0xff60], // Fullwidth ASCII variants
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Emoji: symbols and pictographs, emoticons
  [0x1f900, 0x1f9ff], // Supplemental symbols and pictographs
  [0x20000, 0x2fffd], // CJK Extension B+
  [0x30000, 0x3fffd], // CJK Extension G+
];

/** Zero-width: combining marks and joiners contribute no advance of their own. */
const ZERO_WIDTH_RANGES: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x200b, 0x200f], // Zero-width space through RTL mark
  [0x2028, 0x202e], // Line/paragraph separators, bidi overrides
  [0xfe00, 0xfe0f], // Variation selectors
  [0xfe20, 0xfe2f], // Combining half marks
  [0x1ab0, 0x1aff], // Combining Diacritical Marks Extended
  [0x20d0, 0x20f0], // Combining Diacritical Marks for Symbols
];

function inRanges(code: number, ranges: readonly (readonly [number, number])[]): boolean {
  // Linear scan over ~16 sorted ranges; a binary search would not pay for itself.
  for (const [lo, hi] of ranges) {
    if (code < lo) return false;
    if (code <= hi) return true;
  }
  return false;
}

/** Cell width of one code point: 0 for combining marks, 2 for East Asian wide, else 1. */
export function codePointCells(codePoint: number): 0 | 1 | 2 {
  if (inRanges(codePoint, ZERO_WIDTH_RANGES)) return 0;
  if (inRanges(codePoint, WIDE_RANGES)) return 2;
  return 1;
}

/**
 * Total monospace cell count for a string.
 *
 * Iterates code points (not UTF-16 units), so a surrogate pair counts once rather
 * than twice.
 */
export function stringCells(text: string): number {
  let cells = 0;
  for (const ch of text) cells += codePointCells(ch.codePointAt(0)!);
  return cells;
}

/**
 * Advance width of one monospace cell, as a fraction of font size.
 *
 * 0.6 is the value legacy assumed and holds well across the monospace stack this
 * package ships (SF Mono, JetBrains Mono, Menlo, Consolas all sit near 0.6).
 */
export const MONOSPACE_CELL_RATIO = 0.6;

/** Measurement hook a host can inject when it has real font metrics. */
export interface TextMeasurer {
  /** Width in user units of `text` at `fontSize`, in the given font family. */
  measure(text: string, fontSize: number, fontFamily?: string): number;
}

/**
 * Estimated width of monospace text in user units.
 *
 * Correct for the case legacy got wrong. Hangul syllables are single UTF-16
 * units, so legacy's `text.length * fontSize * 0.6` measured `'가나'` at 14.4
 * where a monospace font actually gives it four cells: 28.8.
 */
export function estimateMonospaceWidth(text: string, fontSize: number): number {
  return stringCells(text) * fontSize * MONOSPACE_CELL_RATIO;
}

/**
 * Average advance ratio for proportional text, as a fraction of font size.
 *
 * Proportional fonts vary far more than monospace ones, so this is only good
 * enough for centering hints and bounding-box guesses. Anything that must be exact
 * should inject a measurer.
 */
export const PROPORTIONAL_CELL_RATIO = 0.52;

export function estimateTextWidth(
  text: string,
  fontSize: number,
  options: { monospace?: boolean; measurer?: TextMeasurer; fontFamily?: string } = {},
): number {
  if (options.measurer) return options.measurer.measure(text, fontSize, options.fontFamily);
  if (options.monospace) return estimateMonospaceWidth(text, fontSize);
  return stringCells(text) * fontSize * PROPORTIONAL_CELL_RATIO;
}
