# Examples

Two kinds of example, answering two different questions.

## "How do I put this on a page?" — integration

Each file is self-contained and they all render the same document,
[`shared/document.json`](./shared/document.json), so the only difference between them is
the integration. That is the point: the document does not change when the framework does.

| File                                | Runs with                                       |
| ----------------------------------- | ----------------------------------------------- |
| [`vanilla.html`](./vanilla.html)     | `bun examples/vanilla.html`                     |
| [`static-svg.ts`](./static-svg.ts)   | `bun examples/static-svg.ts` — writes frames    |
| [`react.tsx`](./react.tsx)           | Paste into a React app                          |
| [`vue.vue`](./vue.vue)               | Paste into a Vue 3 app                          |

## "What can the format actually do?" — the gallery

```
bun examples/gallery/index.html
```

Nine documents, one per capability, each with a note saying what to look for. Every
element type, every transition mode, every easing curve, every arrowhead, every anchor —
and `iteration`, which shows the five ways to write a loop in a format that has no loop
construct.

Press **frames** under any document to lay its whole timeline out at once. A timing
mistake in the middle of a four-second clip is easy to miss while it plays and obvious
in a strip of nine.

`bun examples/gallery/build.ts` writes the same thing to disk — JSON documents to read
and SVG frames to diff.

[`tests/gallery-coverage.test.ts`](../tests/gallery-coverage.test.ts) checks the gallery
against the schema, so adding a mode to the format fails the build until the gallery
demonstrates it. The examples cannot fall behind without somebody noticing.

| Document        | Shows                                                          |
| --------------- | -------------------------------------------------------------- |
| `elements`      | All ten element types, including groups and both asset kinds    |
| `transitions`   | Eight entry/exit modes sharing one window                       |
| `easing`        | Four curves over the same distance                              |
| `interpolation` | `auto` · `number` · `color` · `discrete`                        |
| `iteration`     | Loops: stepping cursor, unrolled body, counter, repeats, effects |
| `effects`       | `highlight` · `pulse` · `flow`                                   |
| `connectors`    | Ten anchors, nine arrowheads, curvature                          |
| `groups`        | Nested transforms and a connector crossing coordinate spaces     |
| `chapters`      | Chapter markers with the caption bar on                          |

New to the format? Read [`docs/AUTHORING.md`](../docs/AUTHORING.md) alongside these.
