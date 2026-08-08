# Contributing to clotho

## Setup

```bash
bun install
bun test
```

## The invariants

Three rules hold the design together. Each has a check, and each check exists because
breaking the rule is easy and noticing is not.

### 1. The core is framework- and DOM-free

`src/core/` may not import React, Vue, or `node:*`, and may not touch `document`,
`window`, `requestAnimationFrame`, `localStorage`, `navigator`, `btoa`, or `atob`.

Every adapter sits on top of the core, so a leak here is inherited by all of them.
Host-dependent code goes in an adapter (`src/react`, `src/vue`, `src/dom`, `src/node`)
or is injected as a hook.

```bash
bun run check:core-purity
```

`requestAnimationFrame` is the instructive case: the player needs a heartbeat, so the
core defines a `Scheduler` interface and ships host-free implementations, while the
browser one lives in `src/dom/scheduler.ts` and is reused by React and Vue.

### 2. Render logic lives in the scene graph, not in adapters

An adapter maps `SceneNode` to its own output and nothing else. If you find yourself
writing "if this is a rect" in an adapter, it belongs in `src/core/scene/elements/`.

`tests/adapter-equivalence.test.ts` renders the same scene through the string, React,
and Vue paths and requires identical output. When it fails, the adapters have started
to drift.

### 3. Rendering must not change without saying so

`bun run check:legacy-equivalence` compares the runtime against the engine clotho
replaces, across 383 real documents and 27,690 frames. If a change is *meant* to alter
rendering, update the script and say why in the commit — do not delete it.

This check needs `.private/` (the reference repositories) and skips cleanly without
them, which also means CI cannot run it. Run it locally before anything that touches
the runtime.

## Document format changes

The format is a contract with documents that already exist. Any change to
`src/core/schema/` needs:

1. A note in `docs/SCHEMA-V1.md` explaining the reason, not just the change.
2. A migration path, if existing documents would stop parsing.
3. `bun run schema:generate`, so the published JSON Schema stays in sync.
4. The corpus regression (`bun test`) still green.

## Tests

- Unit tests live beside their module (`src/core/runtime/runtime.test.ts`).
- Corpus and cross-adapter tests live in `tests/`.
- Tests that need the reference corpus skip when it is absent; set
  `CLOTHO_CORPUS_DIR` to point elsewhere.

Prefer a test that states the behavior and the reason over one that restates the
implementation. Several tests in this repo carry a comment naming the bug they exist
to prevent; that is the standard to aim for.

## Commits

One unit of work per commit, subject in the form `[unit] what changed`. Say why in the
body when the reason is not obvious from the diff — especially when porting, where the
question "did this behavior change?" has to be answerable later.

## Before opening a PR

```bash
bun run typecheck && bun run lint && bun run format:check
bun test
bun run build && bun run check:size && bun run check:styles && bun run check:core-purity
bun run schema:check
bun run check:legacy-equivalence   # if you touched the runtime and have .private/
```
