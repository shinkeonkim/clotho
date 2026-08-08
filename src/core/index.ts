// Public entry for the framework-agnostic core: schema, runtime, scene graph,
// timing, player controller, geometry, theme, text/encoding, assets, validation,
// migration.
//
// Nothing here may import a framework or touch a host global — every adapter
// (react/vue/dom/svg) sits on top of this, so a leak here is inherited by all of
// them. Enforced by `bun run check:core-purity`. See docs/ARCHITECTURE.md §1.
//
// Populated by TASKS 1.x–3.x.

export const VERSION = '0.0.0';

export * from './schema';
export * from './timing/ease';
export * from './runtime';
