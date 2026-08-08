// Transient emphasis effects (docs/SCHEMA-V1.md §3). Unchanged from legacy.
//
// Usage across the 383 existing documents: pulse 1,258 · highlight 842 · flow 162.
// Effects are additive decoration keyed to an element and a moment; they never
// alter the element's own timeline.

import { z } from 'zod';
import { idSchema } from './primitives';

const effectBase = {
  id: idSchema,
  elementId: idSchema,
  time: z.number().int().min(0),
};

export const highlightEffectSchema = z.object({
  type: z.literal('highlight'),
  ...effectBase,
  color: z.string().default('#facc15'),
  duration: z.number().int().min(0).default(500),
});

export const pulseEffectSchema = z.object({
  type: z.literal('pulse'),
  ...effectBase,
  scale: z.number().positive().default(1.12),
  duration: z.number().int().min(0).default(500),
});

export const flowEffectSchema = z.object({
  type: z.literal('flow'),
  ...effectBase,
  color: z.string().default('#facc15'),
  particles: z.number().int().min(1).max(10).default(3),
  radius: z.number().positive().default(4),
  duration: z.number().int().min(0).default(800),
});

export const effectSchema = z.discriminatedUnion('type', [
  highlightEffectSchema,
  pulseEffectSchema,
  flowEffectSchema,
]);

export type HighlightEffect = z.infer<typeof highlightEffectSchema>;
export type PulseEffect = z.infer<typeof pulseEffectSchema>;
export type FlowEffect = z.infer<typeof flowEffectSchema>;
export type AnimationEffect = z.infer<typeof effectSchema>;
export type EffectType = AnimationEffect['type'];
