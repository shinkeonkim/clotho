import { z } from 'zod';
import { PluginError, type ClothoPlugin, type PluginCapability } from './types';

const capabilitySchema = z.enum(['parse', 'normalize', 'compile', 'validate', 'export', 'editor']);

export const pluginManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    clotho: z.string().min(1),
    capabilities: z.array(capabilitySchema).min(1),
    requires: z
      .array(z.object({ id: z.string().min(1), version: z.string().min(1).optional() }))
      .optional(),
    before: z.array(z.string().min(1)).optional(),
    after: z.array(z.string().min(1)).optional(),
    editor: z
      .object({
        panels: z.array(z.string().min(1)).optional(),
        toolbarItems: z.array(z.string().min(1)).optional(),
        inspectors: z.array(z.string().min(1)).optional(),
      })
      .optional(),
  })
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const capability of manifest.capabilities) {
      if (seen.has(capability)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilities'],
          message: `duplicate capability: ${capability}`,
        });
      }
      seen.add(capability);
    }
    if (manifest.editor && !seen.has('editor')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['editor'],
        message: 'editor contributions require the editor capability',
      });
    }
  });

const HOOK_CAPABILITIES: Exclude<PluginCapability, 'editor'>[] = [
  'parse',
  'normalize',
  'compile',
  'validate',
  'export',
];

export function definePlugin(plugin: ClothoPlugin): ClothoPlugin {
  const parsed = pluginManifestSchema.safeParse(plugin.manifest);
  if (!parsed.success) {
    throw new PluginError(
      'invalid-manifest',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      plugin.manifest?.id,
    );
  }

  const capabilities = new Set(parsed.data.capabilities);
  for (const capability of HOOK_CAPABILITIES) {
    const hasHook = typeof plugin[capability] === 'function';
    if (hasHook !== capabilities.has(capability)) {
      throw new PluginError(
        'capability-mismatch',
        `${parsed.data.id} must declare and implement ${capability} together`,
        parsed.data.id,
      );
    }
  }

  return Object.freeze({ ...plugin, manifest: Object.freeze(parsed.data) });
}
