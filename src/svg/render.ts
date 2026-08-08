// One-call rendering for static output.

import type { AnimationDocument } from '../core/schema/document';
import { buildScene } from '../core/scene/build';
import type { SceneOptions } from '../core/scene/context';
import { serializeScene, type SerializeOptions } from './serialize';

export interface RenderDocumentOptions extends SceneOptions, SerializeOptions {}

/**
 * Render one frame of a document as SVG markup.
 *
 * For thumbnails, static export, server rendering, and frame-by-frame comparison.
 * Defaults `rawColors` on: `var(--cloth-fg)` resolves to nothing outside a page
 * carrying clotho's stylesheet, and a standalone file has no stylesheet at all.
 */
export function renderDocumentToSvg(
  doc: AnimationDocument,
  time: number,
  options: RenderDocumentOptions = {},
): string {
  const scene = buildScene(doc, time, { rawColors: options.standalone === true, ...options });
  return serializeScene(scene, options);
}
