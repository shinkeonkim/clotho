# 소비처 마이그레이션 (Phase 7)

두 기존 프로젝트를 clotho로 전환하는 절차. 각 항목은 **실제 호출 지점을 조사해서**
작성했으며, 심볼 개수와 파일 목록은 조사 결과 그대로다.

---

## 0. 전제 조건

| 조건 | 상태 |
| --- | --- |
| 383개 문서가 v1으로 무손실 변환 | ✅ 검증 완료 (13,116 프레임 렌더 동등) |
| clotho가 설치 가능 | ⛔ **`@shinkeonkim/clotho` 배포 필요 (TASKS 6.7)** |
| 두 저장소 clean 상태 | ✅ 확인 (master / main, 미커밋 0건) |

배포 전에는 로컬 링크로 검증할 수 있다:

```jsonc
// 소비처 package.json
"@shinkeonkim/clotho": "file:../clotho"
```

전환은 **반드시 브랜치에서** 한다. 두 저장소 모두 기본 브랜치에 있다.

---

## 1. 문서 변환 (7.1) — 검증 완료

```bash
# 확인만
bun scripts/migrate-corpus.ts --dry-run --report migration-report.json

# 별도 디렉터리로 출력
bun scripts/migrate-corpus.ts --out .migrated

# 원본 덮어쓰기
bun scripts/migrate-corpus.ts --in-place
```

383개 전부 legacy 엔진과 **렌더 결과가 동일**하다(요소 상태 13,116 프레임 비교).
변환 내용은 봉투 필드 하나(`version: 4` → `clothoVersion: 1`)뿐이다 — 코퍼스에
`group`과 `image`가 0건이라 다른 재작성이 발생하지 않았다.

### 변환과 함께 고칠 것 (선택이지만 권장)

검증기가 **작성자가 의도를 적었으나 렌더된 적 없는 속성 377개**를 찾았다.
문서는 정상 렌더되므로 급하지 않지만, 전부 누군가 원했던 동작이다.

| 건수 | 문제 | 조치 |
| ---: | --- | --- |
| 182 | `effect.delay` | v2 잔재. 삭제하거나 `time`에 합산 |
| 37 | `rect.strokeDasharray` | `rect`에 없는 속성. 점선 테두리가 필요하면 스키마 확장 검토 |
| 22+22+20 | `line.label` / `labelColor` / `labelSize` | 라벨은 `arrow`에만 있다. `arrow`로 바꾸거나 별도 `text` 추가 |
| 18+18 | `circle.subtitle` / `subtitleSize` | `rect`에만 있다. 별도 `text` 추가 |
| 8 | `text.fontFamily` | 렌더 옵션 `fontFamily`로 대체 |
| 8 | `rect.opacity` | `rect`에 없다. `fill`의 알파(`#rrggbbaa`)로 |
| 7 | `arrow.arrowEnd` | **오타. `headEnd`가 맞다** — 화살촉이 안 나온 상태 |
| 4 | `line.strokeLinecap` | 스키마에 없다 |
| 2 | `arrow.toX` / `toY` | **오타. `x2`/`y2`가 맞다** — `point-in-non-convex-polygon`의 화살표 2개가 렌더된 적 없다 |
| 8 | `flow` 이펙트가 `rect` 대상 | legacy는 `arrow`만 허용해 무시했다. clotho는 `line`도 지원하므로 대상을 커넥터로 바꾸면 동작한다 |

`clotho validate <dir>`로 전체 목록을 볼 수 있다.

---

## 2. `oh-my-blog` (7.2)

### 조사 결과

`@oh-my-blog-animation/engine`을 import하는 지점 **27개**, `studio` **1개**.
가져오는 심볼은 전부 스키마 타입 + 런타임 함수 + 플레이어 컴포넌트다.

| 소비처 | 내용 |
| --- | --- |
| `apps/web/app/animation-embed.tsx` | `AnimationPlayer` |
| `apps/admin/app/(admin)/studio/[id]/studio-client.tsx` | `StudioMount` |
| `packages/animation-studio/**` (23파일) | 스키마 타입 + `computeSnapshot` / `activeAppearance` |
| `packages/schema/src/animation.ts` | passthrough 봉투 검증 |
| `apps/animation-api/src/animations/*` | 저장 시 검증 |

### 절차

```bash
git -C .private/oh-my-blog switch -c feat/clotho
```

1. **의존 추가** — `apps/web`, `apps/admin`, `packages/animation-studio`,
   `apps/animation-api`의 `package.json`에 `@shinkeonkim/clotho` 추가.
2. **`packages/animation-engine` 삭제.** 워크스페이스 목록에서도 제거.
3. **import 경로 치환** (아래 심볼 대응표 참조).
4. **`packages/schema/src/animation.ts` 대체.** passthrough 봉투 검증은
   `parseDocument`로 교체한다. 이쪽이 실제로 검증하므로 저장 시점에 잘못된 문서를
   막아준다.
5. **`apps/web/app/globals.css`의 `.anim-*` 약 500줄 삭제** →
   `import '@shinkeonkim/clotho/styles.css'`. 호스트 팔레트 매핑을 추가한다:
   ```css
   :root {
     --cloth-fg: var(--color-fg);
     --cloth-muted: var(--color-fg-muted);
     --cloth-surface: var(--color-surface);
     --cloth-surface-elevated: var(--color-surface-elevated);
     --cloth-surface-subtle: var(--color-surface-subtle);
     --cloth-border: var(--color-border);
     --cloth-accent: var(--color-accent);
     --cloth-font-mono: var(--font-mono);
   }
   ```
   테마는 `:root.dark`가 아니라 `data-cloth-theme="dark"`를 본다. 기존 다크 토글에
   이 속성을 함께 설정하거나, `:root.dark { --cloth-fg: …; }`로 직접 덮는다.
6. **`packages/animation-studio`는 clotho-editor로 이동**(Phase 8). 그 전까지는
   import만 clotho로 바꿔 두면 동작한다.
7. `bun run build && bun test`로 확인.

---

## 3. `shinkeonkim.github.io` (7.3)

### 조사 결과

엔진 import 지점 **30개** (`@/entities/animation/engine/schema` 28,
`.../loader` 2). Studio(`src/dev-only/studio/**`)가 그 대부분이다.

| 소비처 | 내용 |
| --- | --- |
| `src/entities/animation/ui/AnimationPlayer.tsx` | 플레이어 → clotho `/react`로 대체 |
| `src/entities/animation/ui/hydrate-animations.ts` | fetch + 하이드레이션 → `createDocumentCache` + clotho 플레이어 |
| `src/entities/animation/ui/AnimationLoader.astro` | 로더 |
| `src/dev-only/studio/**` (25파일) | 스키마 타입 + 런타임 |
| `src/dev-only/api/animations/*` | dev API |
| `scripts/validate-animations.mjs` | → `clotho validate` |
| `src/plugins/remark-animation.mjs` | 클래스명 `anim-placeholder` → `cloth-placeholder` |
| `src/styles/global.css` | `.anim-*` 약 100줄 삭제 |

### 절차

```bash
git -C .private/shinkeonkim.github.io switch -c feat/clotho
```

1. `bun add @shinkeonkim/clotho`
2. **`src/entities/animation/engine/` 삭제** (스키마·런타임·렌더러 전부 clotho에 있다).
3. `AnimationPlayer.tsx` / `AnimationLoader.astro` / `hydrate-animations.ts`를
   clotho `/react`로 교체. UI 문자열은 `koreanStrings`를 넘겨 기존 한국어를 유지한다:
   ```tsx
   import { AnimationPlayer, koreanStrings } from '@shinkeonkim/clotho/react';
   <AnimationPlayer doc={doc} strings={koreanStrings} />
   ```
4. **`astro/zod` → `zod` 전환 확인.** 기존 스키마가 `astro/zod`를 썼고 clotho는 `zod`를
   쓴다. Astro의 zod는 재수출이므로 런타임 충돌은 없지만, `zod`를 직접 dependency에
   추가해야 한다.
5. **`prebuild` 교체**:
   ```diff
   - bun scripts/validate-animations.mjs
   + bunx clotho validate public/animations
   ```
   `scripts/validate-animations.mjs` 삭제.
6. **클래스명 `anim-` → `cloth-`** — `remark-animation.mjs`의 placeholder 클래스,
   `global.css`의 `.anim-*` 블록, `.astro` 파일들. (`animation-filter`처럼
   애니메이션 목록 UI에 쓰인 `anim-` 클래스는 엔진과 무관하므로 **바꾸지 않는다** —
   `src/features/animation-filter/`, `src/widgets/animation-grid/`, `src/pages/animations/`)
7. **Studio(`src/dev-only/studio/`)는 clotho-editor로 이동**(Phase 8).
8. `bun run build && bun test`로 확인. 383개 애니메이션 시각 회귀 확인.

---

## 4. 심볼 대응표

양쪽 저장소 공통.

| legacy | clotho |
| --- | --- |
| `AnimationDef` | `AnimationDocument` |
| `animationDefSchema` | `animationDocumentSchema` |
| `computeSnapshot` | 동일 |
| `activeAppearance` | 동일 |
| `currentChapter` / `activeEffects` | 동일 |
| `SnapshotMap` / `ElementVisualState` | 동일 |
| `AnimationElement` 및 요소별 타입 | 동일 |
| `Anchor` / `EntryMode` / `ExitMode` / `Appearance` / `PropertyTrack` / `TrackKeyframe` / `Chapter` / `AnimationEffect` | 동일 |
| `ID_RE` | 동일 |
| `isNumericKey` / `isColorKey` / `isTextKey` | `isNumericProperty` / `isColorProperty` / `isTextProperty` |
| `entryStyle` / `exitStyle` | 동일. **반환 `transform`이 CSS 문자열 → `Matrix`** |
| `elementCenterFromState` | `elementCenter` |
| `resolveArrowCoords` | `resolveEndpoints` (인자 형태 변경) |
| `engineMarkerUrl` | `markerUrl` |
| `ENGINE_MARKER_DEFS` | 제거. `collectMarkerDefs()`가 데이터를 반환 |
| `resolveElementColor` / `resolveStageBackground` / `isTransparentColor` | 동일 |
| `aspectRatioStyle` / `isWideAspect` / `aspectRatio` | 동일 |
| `advanceTime` / `effectivePlayback` | 동일 |
| `clampZoom` / `zoomIn` / `zoomOut` / `resetZoom` | **미이식** — 확대 뷰어와 함께 4.x 후속 |
| `focusWrapTarget` / `useViewerA11y` / `useFullscreen` | `useFullscreen`은 `/react`에 있음. 모달 a11y는 후속 |
| `ANIM_DIR`, `loadAnimation`, `loadAllDocuments` | `clotho/node`의 `loadDocument` / `loadAllDocuments` (반환 형태 변경: `null` → 이슈 포함 결과) |
| `GroupElement.childIds` | **제거.** 자식이 `parentId`로 부모를 가리킨다 |
| `ImageElement.src` | **`assetId`** + 문서 `assets` 레지스트리 |

### 동작이 바뀌는 지점

| 항목 | 변경 | 영향 |
| --- | --- | --- |
| `entryStyle`/`exitStyle` 반환 | CSS 문자열 → `Matrix` | 직접 쓰던 코드는 `toSvgTransform()` 경유 |
| 로더 실패 | `null` → 이슈 목록 포함 결과 | 호출부가 원인을 표시할 수 있다 |
| 마커 defs | HTML 주입 → 씬 노드 | `dangerouslySetInnerHTML` 제거 |
| `flow` 대상 | `arrow`만 → `arrow`와 `line` | 기존에 무시됐던 8건이 이제 렌더된다 |
| 코드 블록 거터 폭 | `text.length` → EAW 기반 | **CJK 포함 코드 블록의 줄번호 정렬이 달라진다(수정)** |
| UI 문자열 | 한국어 하드코딩 → 영어 기본 | `koreanStrings`로 기존 문구 유지 |
| CSS 클래스 | `anim-` → `cloth-` | 소비처 CSS 수정 |

---

## 5. 되돌리기

두 저장소 모두 브랜치에서 작업하므로 `git switch` 후 브랜치 삭제로 원복된다.
문서 변환을 `--in-place`로 했다면 그것도 커밋 전이라면 `git checkout -- .`로 되돌아간다.
