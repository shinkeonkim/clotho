# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-09-01

### Added

- React, Vue, DOM 플레이어에 `auto | light | dark` 테마 선택 API와 테마별 CSS 토큰
  오버라이드 경로를 추가했다.
- gallery의 아홉 애니메이션을 각각 독립된 README GIF로 제공한다.
- `renderDocumentToGif`/`writeDocumentGif` Node API와 `clotho gif` CLI를 추가했다.
- `defineAnimation`, `appear`, `track`, `repeatAppearances`, `stagger`, `effects.*` 타입 안전 저작 헬퍼를 추가했다.
- 챕터 목록을 좌·우·상·하에 배치하는 `settings.chapterListPosition`을 추가했다.
- npm OIDC trusted publishing용 GitHub Actions release workflow를 추가했다.

### Fixed

- `auto` connector anchor가 중심이 아니라 상대 endpoint를 향하는 외곽점을 고른다.
- 원형 요소의 대각선 anchor가 중심에 겹치지 않고 원주 위에 배치된다.
- chapter가 없는 DOM 플레이어에 빈 하단 막대가 표시되던 문제를 수정했다.
- chapter 표시는 기존 형식인 `Chapter n / total, label`로 복원했다.
- Bun gallery의 라이트·다크 색상 대비와 anchor 예제 배치를 개선했다.
- anchor 예제의 시작점은 고정하고 움직이는 hub의 경계를 연결선이 추적하게 했다.
- GIF가 stage만 추출하거나 폰트·CSS 색상을 누락하던 문제를 수정하고, 기본 출력에 전체
  player UI와 chapter rail을 포함했다.

## [0.1.0] - 2026-09-01

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
