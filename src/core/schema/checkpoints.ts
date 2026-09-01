import { z } from 'zod';
import { idSchema } from './primitives';

const responseValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const predicateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('equals'), value: responseValueSchema }),
  z.object({ type: z.literal('oneOf'), values: z.array(responseValueSchema).min(1) }),
  z.object({ type: z.literal('range'), min: z.number().optional(), max: z.number().optional() }),
]);

const checkpointBase = {
  id: idSchema,
  time: z.number().int().min(0),
  prompt: z.string().default(''),
  required: z.boolean().default(true),
};

export const checkpointSchema = z.discriminatedUnion('interaction', [
  z.object({ ...checkpointBase, interaction: z.literal('continue') }),
  z.object({
    ...checkpointBase,
    interaction: z.literal('choice'),
    options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
    predicate: predicateSchema.optional(),
  }),
  z.object({
    ...checkpointBase,
    interaction: z.literal('select-element'),
    elementIds: z.array(idSchema).min(1),
    predicate: predicateSchema.optional(),
  }),
  z.object({
    ...checkpointBase,
    interaction: z.literal('number-input'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    predicate: predicateSchema.optional(),
  }),
]);

export type Checkpoint = z.infer<typeof checkpointSchema>;
export type CheckpointPredicate = z.infer<typeof predicateSchema>;
export type CheckpointResponse = z.infer<typeof responseValueSchema>;
