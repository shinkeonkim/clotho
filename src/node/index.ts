// Node adapter: filesystem document loading.
//
// Separate entry point so a browser bundle importing "@kokoa/clotho" never
// pulls in node:fs.

export * from './loader';

// `./dev` is deliberately not re-exported. It pulls in the validator, the linter and
// an HTTP server — machinery for the `clotho dev` command, not for a consumer that
// only wants to read documents off disk. The CLI imports it directly.
