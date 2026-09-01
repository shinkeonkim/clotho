// Public entry for the framework-agnostic core: schema, runtime, scene graph,
// timing, player controller, geometry, theme, text/encoding, assets, validation,
// migration.
//
// Nothing here may import a framework or touch a host global — every adapter
// (react/vue/dom/svg) sits on top of this, so a leak here is inherited by all of
// them. Enforced by `bun run check:core-purity`. See docs/ARCHITECTURE.md §1.

export const VERSION = '0.0.0';

export * from './schema';
export * from './timing';
export * from './geometry';
export * from './theme';
export * from './text';
export * from './assets';
export * from './runtime';
export * from './scene';
export * from './player';
export * from './migrate';
export * from './validate';
export * from './load';
export * from './authoring';
export * from './i18n';
