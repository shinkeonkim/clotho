import { describe, expect, it } from 'bun:test';
import {
  createPluginRegistry,
  definePlugin,
  exportWithPlugins,
  PluginError,
  runPluginPipeline,
  type ClothoPlugin,
  type JsonValue,
} from '.';

const manifest = (
  id: string,
  capabilities: ClothoPlugin['manifest']['capabilities'],
): ClothoPlugin['manifest'] => ({
  id,
  name: id,
  version: '1.0.0',
  clotho: '^0.1.8',
  capabilities,
});

const document = {
  clothoVersion: 1,
  id: 'plugin-output',
  duration: 1000,
  elements: [],
};

describe('definePlugin', () => {
  it('validates manifests and freezes a valid definition', () => {
    const plugin = definePlugin({
      manifest: manifest('example.parser', ['parse']),
      parse: (input) => ({ handled: false, value: input }),
    });
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(Object.isFrozen(plugin.manifest)).toBe(true);
  });

  it('requires capabilities and hooks to agree', () => {
    expect(() => definePlugin({ manifest: manifest('broken.plugin', ['compile']) })).toThrow(
      PluginError,
    );
  });

  it('keeps editor contributions explicit', () => {
    expect(() =>
      definePlugin({
        manifest: { ...manifest('editor.plugin', ['validate']), editor: { panels: ['one'] } },
        validate: () => [],
      }),
    ).toThrow(/editor capability/);
  });
});

describe('PluginRegistry', () => {
  const passive = (id: string, extra = {}): ClothoPlugin => ({
    manifest: { ...manifest(id, ['validate']), ...extra },
    validate: () => [],
  });

  it('rejects duplicate and missing plugins', () => {
    expect(() => createPluginRegistry([passive('same'), passive('same')])).toThrow(
      /already registered/,
    );
    expect(() =>
      createPluginRegistry([passive('consumer', { requires: [{ id: 'missing' }] })]).resolveOrder(),
    ).toThrow(/requires missing plugin/);
  });

  it('resolves requirements and ordering deterministically', () => {
    const registry = createPluginRegistry([
      passive('last', { after: ['middle'] }),
      passive('first', { before: ['middle'] }),
      passive('middle'),
    ]);
    expect(registry.list().map((plugin) => plugin.manifest.id)).toEqual([
      'first',
      'middle',
      'last',
    ]);
  });

  it('reports ordering cycles', () => {
    const registry = createPluginRegistry([
      passive('one', { after: ['two'] }),
      passive('two', { after: ['one'] }),
    ]);
    expect(() => registry.resolveOrder()).toThrow(/cycle/);
  });
});

describe('runPluginPipeline', () => {
  it('runs parse, normalize, compile, built-in validation and plugin validation', () => {
    const stages: string[] = [];
    const registry = createPluginRegistry([
      {
        manifest: manifest('trace.compiler', ['parse', 'normalize', 'compile', 'validate']),
        parse(input) {
          stages.push('parse');
          const source = input as { kind?: JsonValue };
          return source.kind === 'trace'
            ? { handled: true, value: { title: 'from trace' } }
            : { handled: false };
        },
        normalize(input) {
          stages.push('normalize');
          const record = input as Record<string, JsonValue>;
          return { ...record, title: String(record.title).trim() };
        },
        compile(input) {
          stages.push('compile');
          return { ...document, ...(input as Record<string, JsonValue>) };
        },
        validate() {
          stages.push('validate');
          return [
            {
              severity: 'warning',
              code: 'plugin-advice',
              path: 'title',
              message: 'example finding',
            },
          ];
        },
      },
    ]);

    const result = runPluginPipeline({ kind: 'trace' }, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.title).toBe('from trace');
    expect(result.findings.some((finding) => finding.code === 'plugin-advice')).toBe(true);
    expect(stages).toEqual(['parse', 'normalize', 'compile', 'validate']);
  });

  it('rejects competing parsers', () => {
    const parser = (id: string): ClothoPlugin => ({
      manifest: manifest(id, ['parse']),
      parse: () => ({ handled: true, value: document }),
    });
    const result = runPluginPipeline({}, createPluginRegistry([parser('one'), parser('two')]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('parse-conflict');
  });

  it('freezes hook input and isolates the caller input', () => {
    const input = { ...document, title: 'original' };
    const registry = createPluginRegistry([
      {
        manifest: manifest('immutable', ['normalize']),
        normalize(value) {
          expect(Object.isFrozen(value)).toBe(true);
          return { ...(value as Record<string, JsonValue>), title: 'normalized' };
        },
      },
    ]);
    const result = runPluginPipeline(input, registry);
    expect(result.ok).toBe(true);
    expect(input.title).toBe('original');
  });

  it('detects non-deterministic output', () => {
    let invocation = 0;
    const registry = createPluginRegistry([
      {
        manifest: manifest('unstable', ['normalize']),
        normalize(input) {
          invocation += 1;
          return {
            ...(input as Record<string, JsonValue>),
            title: `run-${invocation}`,
          };
        },
      },
    ]);
    const result = runPluginPipeline(document, registry, { verifyDeterminism: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('non-deterministic');
  });

  it('rejects non-JSON values returned by plugins', () => {
    const registry = createPluginRegistry([
      {
        manifest: manifest('invalid.output', ['normalize']),
        normalize() {
          return { bad: Number.NaN } as JsonValue;
        },
      },
    ]);
    const result = runPluginPipeline(document, registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-json');
  });
});

describe('exportWithPlugins', () => {
  it('collects artifacts from exporters and reports unsupported formats', () => {
    const registry = createPluginRegistry([
      {
        manifest: manifest('text.exporter', ['export']),
        export(format, animation) {
          if (format !== 'summary') return undefined;
          return [
            {
              filename: `${animation.id}.txt`,
              mime: 'text/plain',
              data: animation.title,
            },
          ];
        },
      },
    ]);
    expect(exportWithPlugins('summary', document, registry)[0]?.filename).toBe('plugin-output.txt');
    expect(() => exportWithPlugins('unknown', document, registry)).toThrow(/no plugin exports/);
  });
});
