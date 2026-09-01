import { z } from 'zod';
import { idSchema } from './primitives';

export const responsiveElementOverrideSchema = z.object({
  x: z.number().optional(), y: z.number().optional(), cx: z.number().optional(), cy: z.number().optional(),
  width: z.number().positive().optional(), height: z.number().positive().optional(), r: z.number().positive().optional(),
  fontSize: z.number().positive().optional(), visible: z.boolean().optional(),
});

export const responsiveVariantSchema = z.object({
  id: idSchema,
  minWidth: z.number().min(0).default(0),
  maxWidth: z.number().positive().optional(),
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).partial().optional(),
  chapterListPosition: z.enum(['left', 'right', 'top', 'bottom']).optional(),
  elementOverrides: z.record(responsiveElementOverrideSchema).default({}),
});

export type ResponsiveVariant = z.infer<typeof responsiveVariantSchema>;
