import { definePlugin } from './manifest';
import { PluginError, type ClothoPlugin } from './types';

export class PluginRegistry {
  readonly #plugins = new Map<string, ClothoPlugin>();

  constructor(plugins: ClothoPlugin[] = []) {
    plugins.forEach((plugin) => this.register(plugin));
  }

  register(candidate: ClothoPlugin): this {
    const plugin = definePlugin(candidate);
    const { id } = plugin.manifest;
    if (this.#plugins.has(id)) {
      throw new PluginError('duplicate-plugin', `plugin ${id} is already registered`, id);
    }
    this.#plugins.set(id, plugin);
    return this;
  }

  get(id: string): ClothoPlugin | undefined {
    return this.#plugins.get(id);
  }

  list(): readonly ClothoPlugin[] {
    return this.resolveOrder();
  }

  resolveOrder(): readonly ClothoPlugin[] {
    const plugins = [...this.#plugins.values()];
    const ids = new Set(this.#plugins.keys());
    const edges = new Map<string, Set<string>>(
      plugins.map((plugin) => [plugin.manifest.id, new Set()]),
    );
    const indegree = new Map<string, number>(plugins.map((plugin) => [plugin.manifest.id, 0]));

    const addEdge = (from: string, to: string): void => {
      if (!ids.has(from) || !ids.has(to) || from === to || edges.get(from)!.has(to)) return;
      edges.get(from)!.add(to);
      indegree.set(to, indegree.get(to)! + 1);
    };

    for (const plugin of plugins) {
      const id = plugin.manifest.id;
      for (const requirement of plugin.manifest.requires ?? []) {
        if (!ids.has(requirement.id)) {
          throw new PluginError(
            'missing-plugin',
            `${id} requires missing plugin ${requirement.id}`,
            id,
          );
        }
        addEdge(requirement.id, id);
      }
      for (const before of plugin.manifest.before ?? []) addEdge(id, before);
      for (const after of plugin.manifest.after ?? []) addEdge(after, id);
    }

    const ready = [...ids].filter((id) => indegree.get(id) === 0).sort();
    const ordered: ClothoPlugin[] = [];
    while (ready.length > 0) {
      const id = ready.shift()!;
      ordered.push(this.#plugins.get(id)!);
      for (const target of [...edges.get(id)!].sort()) {
        indegree.set(target, indegree.get(target)! - 1);
        if (indegree.get(target) === 0) {
          ready.push(target);
          ready.sort();
        }
      }
    }

    if (ordered.length !== plugins.length) {
      throw new PluginError('dependency-cycle', 'plugin ordering contains a cycle');
    }
    return Object.freeze(ordered);
  }
}

export function createPluginRegistry(plugins: ClothoPlugin[] = []): PluginRegistry {
  return new PluginRegistry(plugins);
}
