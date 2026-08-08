# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/).

## [Unreleased]

First release. clotho extracts the animation engine that grew inside two blogs into a
standalone package, and rebuilds its render layer to be framework-agnostic.

### Added

- **Document format v1** (`clothoVersion: 1`). Ten element types, appearance windows
  and property tracks, three effects, chapters. See `docs/SCHEMA-V1.md`.
- **Framework-agnostic scene graph.** `buildScene(doc, t)` returns pure data; adapters
  map it to their own output.
- **Four adapters** — SVG string (SSR, static export), vanilla DOM, React, Vue 3 — all
  producing byte-identical markup for the same scene.
- **Playback controller** outside any framework. `createPlayer` with an injectable
  scheduler, so playback is unit-testable and safe under SSR.
- **Working groups.** The legacy `group` element was declared but never rendered; v1
  nests via `parentId` with real transform composition and visibility inheritance.
- **Image assets** as a document-level registry: inline base64, external URL, or a
  host-resolved reference. `encodeImageAsset` for editor attach-image flows.
- **Validation** beyond the schema: duplicate ids, referential integrity, temporal
  bounds, parent cycles, unresolved assets, and properties the schema does not define.
- **Migration** from legacy v3/v4, verified lossless across 383 real documents.
- **CLI**: `clotho validate`, `clotho migrate`.
- **Stylesheet** with complete light and dark defaults under `--cloth-*` tokens.
- **JSON Schema** generated from the zod schema, for editor autocomplete.
- UI strings default to English and are overridable; Korean provided as `koreanStrings`.

### Fixed

Bugs carried over from the implementations clotho replaces:

- Code blocks containing CJK text mismeasured their line-number gutter. The width came
  from `text.length * fontSize * 0.6`, but Hangul and CJK occupy two monospace cells,
  so `'가나'` measured 14.4 where it renders 28.8. Width is now East-Asian-aware.
- `flow` effects targeting a `line` drew nothing; the renderer required an `arrow`
  specifically, though a line has the same two endpoints.
- Documents that failed to parse were reported as "not found" with no reason. Loaders
  now return the issues.
- Marker definitions were injected as an HTML string, and all thirteen were emitted on
  every stage. They are now data, and only the referenced ones are emitted.
- Group elements silently rendered nothing.
