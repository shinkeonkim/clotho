import type { AnimationDocument } from '../schema/document';
import type { ResponsiveVariant } from '../schema/responsive';

export function selectResponsiveVariant(
  doc: AnimationDocument,
  width: number,
): ResponsiveVariant | undefined {
  return [...(doc.responsive ?? [])]
    .filter(
      (variant) =>
        width >= variant.minWidth && (variant.maxWidth === undefined || width <= variant.maxWidth),
    )
    .sort((a, b) => b.minWidth - a.minWidth)[0];
}

export function compileResponsiveStage(doc: AnimationDocument, width: number): AnimationDocument {
  const variant = selectResponsiveVariant(doc, width);
  if (!variant) return doc;
  const next = structuredClone(doc);
  if (variant.canvas) next.canvas = { ...next.canvas, ...variant.canvas };
  if (variant.chapterListPosition)
    next.settings = { ...next.settings, chapterListPosition: variant.chapterListPosition };
  next.elements = next.elements.map((element) => {
    const override = variant.elementOverrides[element.id];
    if (!override) return element;
    const { visible, ...properties } = override;
    return {
      ...element,
      ...properties,
      ...(visible === false ? { appearances: [] } : {}),
    } as typeof element;
  });
  return next;
}
