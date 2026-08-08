import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'core/index': 'src/core/index.ts',
    'react/index': 'src/react/index.ts',
    'node/index': 'src/node/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  // The stylesheet ships as-is; consumers import "clotho/styles.css".
  publicDir: 'src/styles',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
});
