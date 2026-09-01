/**
 * Experimental compiler plugin API.
 *
 * Plugins extend authoring, validation and export. They do not add runtime
 * element types or mutate renderer behavior; built-in Clotho capabilities stay
 * in core and may share the same pure-data pipeline internally.
 */
export * from './types';
export * from './manifest';
export * from './registry';
export * from './pipeline';
