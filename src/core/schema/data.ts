import { z } from 'zod';

export const dataValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(dataValueSchema),
    z.record(dataValueSchema),
  ]),
);

export const dataBindingSchema = z.object({
  property: z.string().min(1),
  pointer: z.string().regex(/^(?:|\/.*)$/, 'pointer must be an RFC 6901 JSON Pointer'),
  formatter: z.enum(['identity', 'string', 'number', 'fixed', 'percent', 'uppercase', 'lowercase', 'color']).default('identity'),
  digits: z.number().int().min(0).max(10).optional(),
  fallback: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export type DataBinding = z.infer<typeof dataBindingSchema>;
export type DataValue = string | number | boolean | null | DataValue[] | { [key: string]: DataValue };
