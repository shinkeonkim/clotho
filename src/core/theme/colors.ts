// Theme-safe color resolution for the stage. Ported from oh-my-blog's
// theme-colors.ts — the reference implementation that had light/dark support at
// all (shinkeonkim's did not).
//
// Authored colors are sacred: they pass through untouched. Only the *schema
// defaults* that are unsafe across light and dark get routed — free-standing text
// and arrow labels, which render directly on the themed stage. Every other default
// sits on a theme-stable surface and is left alone:
//   - fill #a5b4fc / stroke #6366f1 are brand colors legible on either mat
//   - code fill #1e293b + textColor #e2e8f0 are self-contained
//
// This never mutates a stored document; it maps values at render time. Rewriting
// the document instead would destroy the author's ability to say "I really do want
// near-black here".

export type ColorRole = 'fill' | 'stroke' | 'text' | 'label';

/** Schema default for `text.color` — equals a light foreground, unsafe on dark. */
const UNSAFE_TEXT_DEFAULT = '#18181b';
/** Schema default for `label`-ish colors on rect/circle/arrow. */
const UNSAFE_LABEL_DEFAULT = '#0b0b0f';

/** CSS variable that flips foreground per theme. Defined in clotho's stylesheet. */
export const THEME_FG_VAR = 'var(--cloth-fg)';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Map a color to a theme-safe value for its render role. Only the unsafe
 * foreground defaults are rewritten; anything else — authored or theme-stable —
 * comes back unchanged.
 */
export function resolveElementColor(
  value: string | undefined,
  role: ColorRole,
): string | undefined {
  if (value === undefined) return value;
  if (role === 'text' && normalize(value) === UNSAFE_TEXT_DEFAULT) return THEME_FG_VAR;
  if (role === 'label' && normalize(value) === UNSAFE_LABEL_DEFAULT) return THEME_FG_VAR;
  return value;
}

const TRANSPARENT_KEYWORDS = new Set(['', 'transparent', 'none']);
const ZERO_ALPHA = /^(?:rgba|hsla)\([^)]*,\s*0(?:\.0+)?\s*\)$/i;

/** True when a background provides no coverage, so the themed stage mat shows through. */
export function isTransparentColor(value: string | undefined): boolean {
  if (value === undefined) return true;
  const v = normalize(value);
  return TRANSPARENT_KEYWORDS.has(v) || ZERO_ALPHA.test(v);
}

export interface StageBackground {
  /** Value to paint on the `<svg>` element itself. */
  readonly svgBackground: string;
  /** Whether to reveal the tokenized stage mat behind a transparent canvas. */
  readonly showMat: boolean;
}

/**
 * Decide how to back the stage. Transparent canvases stay transparent and expose
 * the themed mat, which gives boundary and depth in both themes; an authored
 * background is kept verbatim and covers the mat.
 */
export function resolveStageBackground(value: string | undefined): StageBackground {
  if (value === undefined || isTransparentColor(value)) {
    return { svgBackground: 'transparent', showMat: true };
  }
  return { svgBackground: value, showMat: false };
}
