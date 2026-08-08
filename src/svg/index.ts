// SVG-string adapter: SceneNode → markup.
//
// Pure and SSR-safe (no DOM, no framework). Serves double duty as the golden-test
// surface for scene-graph correctness.

export * from './serialize';
export { renderDocumentToSvg } from './render';
