// The camera: which part of the canvas the viewer is looking at (docs/SCHEMA-V1.md §7).
//
// Until v1 gained this, `Scene.viewBox` was a constant derived from `canvas`, so a
// document that needed to show a large graph had to draw it small. The two
// workarounds authors used — moving every element in the opposite direction, or
// splitting the document — both cost more than they should.
//
// Camera values live in canvas coordinates so they survive a responsive variant
// changing the stage size, and they reuse the element keyframe timing model rather
// than inventing a second one.

import { z } from 'zod';
import { easeSchema, idSchema } from './primitives';

export const cameraKeyframeSchema = z.object({
  time: z.number().int().min(0),
  /** Camera properties are always numeric, unlike element tracks. */
  value: z.number(),
  ease: easeSchema.optional(),
});

export const cameraPropertySchema = z.enum(['zoom', 'x', 'y']);

export const cameraTrackSchema = z.object({
  property: cameraPropertySchema,
  keyframes: z.array(cameraKeyframeSchema).min(1),
});

/**
 * Frame a set of elements, as a shorthand for the `(x, y, zoom)` that would do it.
 *
 * Resolved per frame against live element bounds, so a focus on a moving element
 * follows it. `duration` is the transition in; the focus then holds until the next
 * focus entry or the end of the document.
 */
export const cameraFocusSchema = z.object({
  time: z.number().int().min(0),
  duration: z.number().int().min(0).default(600),
  elementIds: z.array(idSchema).min(1),
  /** Canvas units of breathing room added around the target bounds. */
  padding: z.number().nonnegative().default(24),
  /** Ceiling on the zoom a focus may request, so a tiny target does not fill the stage. */
  maxZoom: z.number().positive().default(4),
  ease: easeSchema.optional(),
});

/**
 * How stroke widths respond to zoom.
 *
 * `scale` is what an optical camera does — magnifying a drawing thickens its
 * lines — and is the default because it needs no compensation and keeps output
 * identical to a document without a camera. `fixed` divides stroke widths by the
 * zoom so line weight stays constant, which reads better for dense diagrams. It is
 * applied to the scene as plain numbers rather than through `vector-effect`, so
 * every adapter and the resvg-based GIF renderer agree.
 */
export const cameraStrokeScalingSchema = z.enum(['scale', 'fixed']).default('scale');

export const cameraSchema = z.object({
  tracks: z.array(cameraTrackSchema).default([]),
  focus: z.array(cameraFocusSchema).default([]),
  strokeScaling: cameraStrokeScalingSchema,
});

export type CameraKeyframe = z.infer<typeof cameraKeyframeSchema>;
export type CameraProperty = z.infer<typeof cameraPropertySchema>;
export type CameraTrack = z.infer<typeof cameraTrackSchema>;
export type CameraFocus = z.infer<typeof cameraFocusSchema>;
export type CameraStrokeScaling = z.infer<typeof cameraStrokeScalingSchema>;
export type Camera = z.infer<typeof cameraSchema>;
