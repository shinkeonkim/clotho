import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'core/index': 'src/core/index.ts',
    'svg/index': 'src/svg/index.ts',
    'dom/index': 'src/dom/index.ts',
    'react/index': 'src/react/index.ts',
    'vue/index': 'src/vue/index.ts',
    'node/index': 'src/node/index.ts',
    'gif/index': 'src/gif/index.ts',
    'cli/index': 'src/cli/index.ts',
    'plugins/index': 'src/plugins/index.ts',
  },
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  // The stylesheet is copied verbatim to dist/clotho.css ("@kokoa/clotho/styles.css").
  publicDir: 'src/styles',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'vue'],
});
