# Examples

Each example is a single self-contained file. They share one document,
[`shared/document.json`](./shared/document.json), so the difference between them is
purely the integration — which is the point.

| File | Runs with |
| --- | --- |
| [`vanilla.html`](./vanilla.html) | Open it in a browser. No build step. |
| [`static-svg.ts`](./static-svg.ts) | `bun examples/static-svg.ts` — writes frames to disk |
| [`react.tsx`](./react.tsx) | Paste into a React app |
| [`vue.vue`](./vue.vue) | Paste into a Vue 3 app |
