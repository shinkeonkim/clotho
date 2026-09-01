import { animationDocumentSchema } from '../schema';
import { validateDocument } from '../validate/validate';
import { cloneJson, freezeJson, stableJson, toJsonValue } from './json';
import type { PluginRegistry } from './registry';
import {
  PluginError,
  type ClothoPlugin,
  type JsonValue,
  type PluginContext,
  type PluginExportArtifact,
  type PluginPipelineOptions,
  type PluginPipelineResult,
  type PluginTraceEntry,
} from './types';

function contextFor(plugin: ClothoPlugin, seed: string): PluginContext {
  return Object.freeze({ seed, pluginId: plugin.manifest.id });
}

function invoke<T>(plugin: ClothoPlugin, action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof PluginError) throw error;
    throw new PluginError(
      'plugin-failure',
      `plugin ${plugin.manifest.id} failed`,
      plugin.manifest.id,
      { cause: error },
    );
  }
}

interface SingleRun {
  result: PluginPipelineResult;
  signature?: string;
}

function runOnce(input: unknown, plugins: readonly ClothoPlugin[], seed: string): SingleRun {
  const trace: PluginTraceEntry[] = [];
  try {
    let value = toJsonValue(input);
    const handlers: { plugin: ClothoPlugin; value: JsonValue }[] = [];
    for (const plugin of plugins) {
      if (!plugin.parse) continue;
      const parsed = invoke(plugin, () =>
        plugin.parse!(freezeJson(cloneJson(value)), contextFor(plugin, seed)),
      );
      trace.push({ pluginId: plugin.manifest.id, stage: 'parse' });
      if (parsed.handled) {
        if (parsed.value === undefined) {
          throw new PluginError(
            'invalid-json',
            `${plugin.manifest.id} handled input without returning a value`,
            plugin.manifest.id,
          );
        }
        handlers.push({ plugin, value: toJsonValue(parsed.value, plugin.manifest.id) });
      }
    }
    if (handlers.length > 1) {
      throw new PluginError(
        'parse-conflict',
        `multiple plugins handled the same input: ${handlers.map(({ plugin }) => plugin.manifest.id).join(', ')}`,
      );
    }
    if (handlers[0]) value = handlers[0].value;

    for (const stage of ['normalize', 'compile'] as const) {
      for (const plugin of plugins) {
        const hook = plugin[stage];
        if (!hook) continue;
        value = toJsonValue(
          invoke(plugin, () => hook(freezeJson(cloneJson(value)), contextFor(plugin, seed))),
          plugin.manifest.id,
        );
        trace.push({ pluginId: plugin.manifest.id, stage });
      }
    }

    const parsedDocument = animationDocumentSchema.safeParse(value);
    if (!parsedDocument.success) {
      throw new PluginError(
        'invalid-document',
        parsedDocument.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; '),
      );
    }

    const findings = [...validateDocument(parsedDocument.data).findings];
    const readonlyDocument = freezeJson(
      toJsonValue(parsedDocument.data),
    ) as unknown as typeof parsedDocument.data;
    for (const plugin of plugins) {
      if (!plugin.validate) continue;
      findings.push(
        ...invoke(plugin, () => plugin.validate!(readonlyDocument, contextFor(plugin, seed))),
      );
      trace.push({ pluginId: plugin.manifest.id, stage: 'validate' });
    }
    const result = { ok: true, document: parsedDocument.data, findings, trace } as const;
    return { result, signature: stableJson(result) };
  } catch (error) {
    const pluginError =
      error instanceof PluginError
        ? error
        : new PluginError('plugin-failure', 'plugin pipeline failed', undefined, { cause: error });
    return { result: { ok: false, error: pluginError, trace } };
  }
}

export function runPluginPipeline(
  input: unknown,
  registry: PluginRegistry,
  options: PluginPipelineOptions = {},
): PluginPipelineResult {
  const seed = options.seed ?? 'clotho';
  let plugins: readonly ClothoPlugin[];
  try {
    plugins = registry.resolveOrder();
  } catch (error) {
    const pluginError =
      error instanceof PluginError
        ? error
        : new PluginError('plugin-failure', 'failed to resolve plugin order', undefined, {
            cause: error,
          });
    return { ok: false, error: pluginError, trace: [] };
  }
  const first = runOnce(input, plugins, seed);
  if (!options.verifyDeterminism || !first.result.ok) return first.result;
  const second = runOnce(input, plugins, seed);
  if (!second.result.ok || first.signature !== second.signature) {
    return {
      ok: false,
      error: new PluginError('non-deterministic', 'plugin pipeline output changed between runs'),
      trace: first.result.trace,
    };
  }
  return first.result;
}

export function exportWithPlugins(
  format: string,
  document: unknown,
  registry: PluginRegistry,
  options: Pick<PluginPipelineOptions, 'seed'> = {},
): PluginExportArtifact[] {
  const parsed = animationDocumentSchema.parse(document);
  const readonlyDocument = freezeJson(toJsonValue(parsed)) as unknown as typeof parsed;
  const seed = options.seed ?? 'clotho';
  const artifacts: PluginExportArtifact[] = [];
  for (const plugin of registry.resolveOrder()) {
    if (!plugin.export) continue;
    const output = invoke(plugin, () =>
      plugin.export!(format, readonlyDocument, contextFor(plugin, seed)),
    );
    if (output) artifacts.push(...output);
  }
  if (artifacts.length === 0) {
    throw new PluginError('unsupported-export', `no plugin exports ${format}`);
  }
  return artifacts;
}
