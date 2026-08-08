// Syntax highlighting for the `code` element.
//
// Ported from the legacy engine's render-elements/code.tsx, which hardcoded a
// JavaScript tokenizer and ignored the element's `language` field entirely. The
// tokenizer is kept as the default (it is what 19 existing code blocks were written
// against) but is now one implementation of an injectable interface, so a host that
// wants Shiki, Prism, or a language it actually cares about can supply one.
//
// The document schema does not change (docs/SCHEMA-V1.md §2.6).

export interface CodeToken {
  readonly text: string;
  readonly color: string;
}

export interface CodePalette {
  readonly keyword: string;
  readonly string: string;
  readonly comment: string;
  readonly number: string;
  readonly builtin: string;
  readonly text: string;
}

/**
 * Turns one line into colored runs.
 *
 * Line-at-a-time rather than whole-document because the renderer lays out one
 * `<tspan>` per line; a highlighter needing cross-line state (template literals,
 * block comments) can keep it in a closure.
 */
export interface CodeHighlighter {
  readonly name: string;
  highlightLine(line: string, palette: CodePalette, language: string): CodeToken[];
}

/** Legacy's palette, unchanged. Self-contained against the dark code background. */
export const DEFAULT_CODE_PALETTE: Omit<CodePalette, 'text'> = {
  keyword: '#c084fc',
  string: '#86efac',
  comment: '#94a3b8',
  number: '#fbbf24',
  builtin: '#7dd3fc',
};

const JS_KEYWORDS = new Set([
  'async',
  'await',
  'function',
  'return',
  'const',
  'let',
  'var',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'class',
  'extends',
  'super',
  'this',
  'import',
  'export',
  'from',
  'default',
  'as',
  'typeof',
  'instanceof',
  'in',
  'of',
  'yield',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'delete',
]);

const JS_BUILTINS = new Set([
  'Promise',
  'console',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Math',
  'JSON',
  'Map',
  'Set',
  'Symbol',
  'Error',
  'TypeError',
  'Date',
  'document',
  'window',
  'globalThis',
  'process',
]);

// Order matters: quoted runs first so a keyword inside a string is not recolored.
const JS_TOKEN_RE =
  /(`[^`]*`|"[^"]*"|'[^']*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|([^\w`"']+)/g;

/**
 * The default highlighter: a single-line JavaScript tokenizer.
 *
 * Its limits are legacy's limits, kept deliberately. It does not track block
 * comments or multi-line template literals, and it colors any language the same
 * way. Hosts that need better should inject a real highlighter.
 */
export const javascriptHighlighter: CodeHighlighter = {
  name: 'javascript-basic',
  highlightLine(line, palette) {
    const tokens: CodeToken[] = [];

    const commentIndex = line.indexOf('//');
    const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    const comment = commentIndex >= 0 ? line.slice(commentIndex) : '';

    JS_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = JS_TOKEN_RE.exec(code)) !== null) {
      if (match[1]) tokens.push({ text: match[1], color: palette.string });
      else if (match[2]) tokens.push({ text: match[2], color: palette.number });
      else if (match[3]) {
        const word = match[3];
        const color = JS_KEYWORDS.has(word)
          ? palette.keyword
          : JS_BUILTINS.has(word)
            ? palette.builtin
            : palette.text;
        tokens.push({ text: word, color });
      } else if (match[4]) tokens.push({ text: match[4], color: palette.text });
    }

    if (comment) tokens.push({ text: comment, color: palette.comment });
    return tokens;
  },
};

/** A highlighter that colors everything as plain text. */
export const plainHighlighter: CodeHighlighter = {
  name: 'plain',
  highlightLine(line, palette) {
    return line === '' ? [] : [{ text: line, color: palette.text }];
  },
};
