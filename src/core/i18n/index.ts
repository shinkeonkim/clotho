import type { AnimationDocument } from '../schema/document';
import type { TextElement } from '../schema/elements';

export type TranslationMap = Readonly<Record<string, string>>;

/** Resolve a localized value without ever losing the authored default text. */
export function resolveLocalizedText(
  defaultText: string,
  translations: TranslationMap | undefined,
  locale: string | undefined,
): string {
  if (!locale || !translations) return defaultText;
  const wanted = locale.toLowerCase();
  const exact = Object.entries(translations).find(([tag]) => tag.toLowerCase() === wanted)?.[1];
  if (exact !== undefined) return exact;
  const base = wanted.split('-')[0]!;
  const baseMatch = Object.entries(translations).find(([tag]) => tag.toLowerCase() === base)?.[1];
  return baseMatch ?? defaultText;
}

/** Languages an editor should offer for one text element. */
export function textElementLocales(
  doc: AnimationDocument,
  element: TextElement,
): readonly string[] {
  return element.locales ?? doc.locales;
}
