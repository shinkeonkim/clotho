export interface AnnotationPart {
  readonly kind: 'text' | 'reference';
  readonly value: string;
  readonly token?: string;
  readonly targetIds?: readonly string[];
}

const TOKEN = /\{([a-z][a-z0-9_-]*)\}/g;

export function annotationTokens(value: string): string[] {
  return [...value.matchAll(TOKEN)].map((match) => match[1]!);
}

export function splitAnnotations(
  value: string,
  references: Readonly<Record<string, string | readonly string[]>>,
): AnnotationPart[] {
  const parts: AnnotationPart[] = [];
  let offset = 0;
  for (const match of value.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > offset) parts.push({ kind: 'text', value: value.slice(offset, index) });
    const token = match[1]!;
    const target = references[token];
    const targetIds =
      target === undefined ? [] : typeof target === 'string' ? [target] : [...target];
    parts.push({ kind: 'reference', value: token, token, targetIds });
    offset = index + match[0].length;
  }
  if (offset < value.length) parts.push({ kind: 'text', value: value.slice(offset) });
  return parts;
}
