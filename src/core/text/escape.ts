// XML escaping for the SVG-string adapter.
//
// Not a nicety: without it, an animation whose text contains `&` or `<` produces
// malformed markup, and one containing `</text><script>` produces markup that does
// something entirely different from what the document said. React escaped this for
// free, so legacy never needed it; a string serializer has to do it by hand.

const TEXT_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

const ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/**
 * Escape for XML character data. `>` is escaped too — not strictly required, but
 * it removes any chance of an accidental `]]>` and costs nothing.
 */
export function escapeXmlText(value: string): string {
  return value.replace(/[&<>]/g, (ch) => TEXT_ESCAPES[ch]!);
}

/** Escape for an XML attribute value, quote characters included. */
export function escapeXmlAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ATTR_ESCAPES[ch]!);
}

/**
 * Characters XML 1.0 forbids outright — C0 controls other than tab, newline, and
 * carriage return. These cannot be escaped into legality, so they are dropped;
 * leaving them in produces a document no parser will accept.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is exactly the intent here
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML_CHARS, '');
}

/** Escape text and remove characters XML cannot represent. */
export function sanitizeXmlText(value: string): string {
  return escapeXmlText(stripInvalidXmlChars(value));
}

/** Escape an attribute and remove characters XML cannot represent. */
export function sanitizeXmlAttr(value: string): string {
  return escapeXmlAttr(stripInvalidXmlChars(value));
}
