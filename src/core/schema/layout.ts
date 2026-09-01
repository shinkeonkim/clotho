import { z } from 'zod';
import { idSchema } from './primitives';

export const layoutModeSchema = z.enum(['row', 'column', 'grid']);
export const layoutAlignSchema = z.enum(['start', 'center', 'end']);

const relationConstraintProps = {
  elementId: idSchema,
  targetId: idSchema,
  gap: z.number().nonnegative().default(0),
};

export const layoutConstraintSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rightOf'), ...relationConstraintProps }),
  z.object({ type: z.literal('below'), ...relationConstraintProps }),
  z.object({ type: z.literal('sameX'), elementId: idSchema, targetId: idSchema }),
  z.object({ type: z.literal('sameY'), elementId: idSchema, targetId: idSchema }),
  z.object({
    type: z.literal('align'),
    elementIds: z.array(idSchema).min(2),
    axis: z.enum(['x', 'y']),
    edge: layoutAlignSchema.default('center'),
  }),
  z.object({
    type: z.literal('contain'),
    elementId: idSchema,
    containerId: idSchema,
    padding: z.number().nonnegative().default(0),
  }),
  z.object({
    type: z.literal('minGap'),
    firstId: idSchema,
    secondId: idSchema,
    axis: z.enum(['x', 'y']),
    gap: z.number().nonnegative(),
  }),
]);

export const layoutSchema = z.object({
  id: idSchema,
  elementIds: z.array(idSchema).min(1),
  mode: layoutModeSchema,
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  gap: z.number().nonnegative().default(16),
  rowGap: z.number().nonnegative().optional(),
  columnGap: z.number().nonnegative().optional(),
  columns: z.number().int().positive().optional(),
  align: layoutAlignSchema.default('start'),
  constraints: z.array(layoutConstraintSchema).default([]),
});

export type Layout = z.infer<typeof layoutSchema>;
export type LayoutConstraint = z.infer<typeof layoutConstraintSchema>;
export type LayoutMode = z.infer<typeof layoutModeSchema>;
