// Public entry for the SVG-string adapter: SceneNode → serialized SVG markup.
// Pure and SSR-safe (no DOM, no framework). Serves double duty as the golden-test
// surface for scene-graph correctness — see TASKS 4.1, 2.7.
//
// All text and attribute values MUST pass through core/text XML escaping.

export {};
