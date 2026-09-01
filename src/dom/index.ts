// Vanilla-DOM adapter: no framework peer at all.
//
// Also home to the browser frame scheduler, which the React and Vue adapters reuse —
// the core cannot own it without touching a host global.

export * from './scheduler';
export * from './patch';
export * from './mount';
export * from './strings';
export * from './annotations';
