// Node adapter: filesystem document loading.
//
// Separate entry point so a browser bundle importing "@shinkeonkim/clotho" never
// pulls in node:fs.

export * from './loader';
