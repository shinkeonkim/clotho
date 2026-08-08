// Default font stacks.
//
// SVG `<text>` has no font fallback of its own beyond what `font-family` lists, so
// a stage rendering Korean on a machine without a Korean font shows tofu boxes.
// Legacy inherited whatever the host page had set; a published package cannot
// assume that, so it ships stacks that name CJK families explicitly.
//
// Consumers override via the render options or by restyling `.cloth-*` classes.

/**
 * Proportional stack for labels and captions.
 *
 * Pretendard and Noto Sans KR cover Hangul; Hiragino/Yu Gothic and PingFang/Microsoft
 * YaHei cover Japanese and Chinese. System UI fonts come first so Latin text looks
 * native.
 */
export const DEFAULT_FONT_FAMILY = [
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'Pretendard',
  'Noto Sans KR',
  'Hiragino Sans',
  'Yu Gothic',
  'PingFang SC',
  'Microsoft YaHei',
  'Apple SD Gothic Neo',
  'Malgun Gothic',
  'sans-serif',
].join(', ');

/**
 * Monospace stack for code blocks.
 *
 * Ends in CJK families too: a code block containing a Korean comment otherwise
 * falls back to a default that may not be monospace at all, which is exactly the
 * misalignment `estimateMonospaceWidth` is trying to account for.
 */
export const DEFAULT_MONOSPACE_FAMILY = [
  'ui-monospace',
  'SFMono-Regular',
  'SF Mono',
  'JetBrains Mono',
  'Menlo',
  'Consolas',
  'Liberation Mono',
  'D2Coding',
  'Noto Sans Mono CJK KR',
  'monospace',
].join(', ');
