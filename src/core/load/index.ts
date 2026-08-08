// Document loading that needs no filesystem: BOM-safe JSON parsing, optional
// legacy migration, and a fetch-based loader. The filesystem loader lives in the
// node adapter so browser bundles never pull node: builtins.

export * from './parse';
export * from './fetch';
