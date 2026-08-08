// UTF-8 safe base64, for inline image assets and data URIs.
//
// `btoa()` is not an option: it throws on any code point above U+00FF, so a
// Korean filename, a CJK label, or an emoji inside an inline SVG breaks it. These
// go through `TextEncoder`/`TextDecoder`, which are standard in browsers and Node
// alike, so the core stays host-agnostic (see docs/SCHEMA-V1.md §2.3).
//
// Byte-level conversion is done by hand rather than through Buffer, which exists
// only in Node, or btoa, which cannot take the bytes.

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reverse lookup, built once. */
const BASE64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE64_ALPHABET.length; i += 1) BASE64_LOOKUP[BASE64_ALPHABET[i]!] = i;

/** Encode raw bytes as standard base64 with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += BASE64_ALPHABET[b0 >> 2];
    if (b1 === undefined) {
      out += BASE64_ALPHABET[(b0 & 0x03) << 4];
      out += '==';
      break;
    }
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += BASE64_ALPHABET[(b1 & 0x0f) << 2];
      out += '=';
      break;
    }
    out += BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Decode standard base64. Whitespace is tolerated; other junk throws. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '').replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (const ch of clean) {
    const value = BASE64_LOOKUP[ch];
    if (value === undefined) throw new Error(`invalid base64 character: ${JSON.stringify(ch)}`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (buffer >> bits) & 0xff;
      byteIndex += 1;
    }
  }
  return bytes.subarray(0, byteIndex);
}

/** Encode a string as base64 via UTF-8. Handles every code point, emoji included. */
export function toBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** Decode base64 into a string via UTF-8. */
export function fromBase64(base64: string): string {
  return new TextDecoder().decode(base64ToBytes(base64));
}

/** Build a `data:` URI from a MIME type and raw bytes. */
export function toDataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** Build a `data:` URI from a MIME type and already-encoded base64. */
export function dataUriFromBase64(mime: string, base64: string): string {
  return `data:${mime};base64,${base64.replace(/\s+/g, '')}`;
}

const DATA_URI_RE = /^data:([^;,]*)(;base64)?,(.*)$/s;

export interface ParsedDataUri {
  readonly mime: string;
  readonly base64: boolean;
  readonly data: string;
}

/** Parse a `data:` URI into its parts, or null when it is not one. */
export function parseDataUri(uri: string): ParsedDataUri | null {
  const match = DATA_URI_RE.exec(uri.trim());
  if (!match) return null;
  return { mime: match[1] || 'text/plain', base64: match[2] !== undefined, data: match[3] ?? '' };
}

/**
 * Strip a UTF-8 byte order mark.
 *
 * A BOM at the start of a JSON file makes `JSON.parse` throw on a character that
 * is invisible in every editor — a genuinely confusing failure, and cheap to
 * prevent at the loader boundary.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
