# clotho 작업 계획

JSON 기반 시각화 애니메이션 패키지. 조사는 [`docs/RESEARCH.md`](./docs/RESEARCH.md),
설계는 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md),
문서 포맷은 [`docs/SCHEMA-V1.md`](./docs/SCHEMA-V1.md).

범례: `[ ]` 예정 · `[~]` 진행 중 · `[x]` 완료

---

## 확정된 결정 (2026-08-08)

| # | 결정 |
| --- | --- |
| Q1 | zod를 dependency로 두는 것 허용 |
| Q2 | **새 버저닝 체계 도입.** `clothoVersion: 1` 신규 포맷. 소비처도 새 시스템으로 전환 |
| Q3 | **group·image 기능 실제 사용.** 이미지는 base64 인라인 + 호스트 훅 API 양쪽 지원. 에디터가 이미지 첨부 UI를 만들 수 있는 인터페이스 제공 |
| Q4 | **React 외 바닐라JS·Vue.js도 지원.** → 씬 그래프 + 어댑터 구조 |
| Q5 | npm `clotho` 선점됨 → **`@shinkeonkim/clotho`** 로 배포 |
| Q6 | **인코딩(UTF-8) 전반 고려.** CJK 폭, XML 이스케이프, base64, BOM, 그래핌 |

Q4가 구조를 가장 크게 바꿨다. 렌더 계층을 React JSX에서 **프레임워크 무관 씬 그래프**로
걷어내고 어댑터 4종(react/vue/dom/svg)을 얹는다. 재생 루프도 프레임워크 밖으로 뺀다.

---

## Phase 0 — 조사 및 기반 (완료)

- [x] **0.1** 기존 두 구현체 실측 조사 → `docs/RESEARCH.md`
- [x] **0.2** 패키지 아키텍처 결정 → `docs/ARCHITECTURE.md`
- [x] **0.3** 작업 계획 문서화 → 본 문서
- [x] **0.4** 프로젝트 스캐폴딩 (bun, TypeScript, tsup, eslint/prettier)
- [x] **0.5** 383개 legacy JSON 코퍼스를 회귀 픽스처로 연결
- [x] **0.6** v1 포맷 초안 작성 → `docs/SCHEMA-V1.md`
- [x] **0.7** v1 포맷 확정 (`SCHEMA-V1.md` §5 — S1~S6 결정 완료)
- [x] **0.8** 패키지명 `@shinkeonkim/clotho`로 전환 + 어댑터 서브패스 골격
- [x] **0.9** 코어 순수성 검사기 (`check:core-purity`)

## Phase 1 — 코어 스키마 및 런타임

- [x] **1.1** v1 스키마 구현 — `primitives / elements / effects / assets / document`
  - legacy 포팅 + v1 변경 6종(`parentId`, `interpolate`, `assets`, `category`, `clothoVersion: 1`)
  - `parseDocument` / `parseDocumentOrThrow` — 실패 시 이슈 목록을 반환값에 담는다
    (legacy 로더는 `null`로 삼켜 대문자 id 애니메이션이 렌더되지 않는 채로 배포된 적이 있다)
  - 383개 코퍼스가 v1 파서에 **거부되는지** 회귀로 고정 (마이그레이션 게이트)
  - 코어 번들 11.9KB / gzip 3.1KB. `.d.ts`는 237KB(zod 추론 인라인) → 6.2에서 검토
- [x] **1.2** 런타임 포팅 — `computeSnapshot / activeAppearance / currentChapter / activeEffects`
  - 출처: `schema/runtime.ts` (양쪽 완전 동일) + `runtime.test.ts` 395줄
  - `interpolate` 명시값 지원 추가, `auto`는 기존 휴리스틱 유지
  - `easeApply`/`lerp`는 `timing/ease`로, 색 파싱은 `runtime/color`로 분리
  - **legacy 엔진과의 차분 검증** (`check:legacy-equivalence`): 383개 문서 ×
    27,690 프레임 × 682만 속성 비교에서 차이 0. 참조 저장소 없으면 스킵
- [x] **1.3** 그룹 트리 해석 — `parentId` → 트리 빌드, transform 합성, 가시성 상속
  - 순환 참조 / 미존재 부모 / 비그룹 부모 / 자기 부모 검출 후 **재루팅**하여 렌더는 계속
  - `geometry/matrix`: SVG 6-값 아핀 행렬. 그룹 내부 요소를 가리키는 커넥터 앵커를
    루트 좌표로 풀기 위해 필요 (legacy는 그룹이 동작하지 않아 전부 절대 좌표였다)
  - **legacy에 구현이 없던 기능이라 전부 신규**
- [x] **1.4** 순수 유틸 포팅 — `timing/clock · playback`, `geometry/stage`, `theme/colors`
  - 출처: oh-my-blog (테스트 포함). `focus-trap`은 모달 전용이라 4.3으로 이동
  - `geometry/anchors`: 앵커·커넥터 끝점 해석을 React 컴포넌트에서 분리.
    **그룹 변환을 통과하도록 확장** (legacy는 좌표가 전부 절대라 필요 없었다)
- [x] **1.5** 페이즈 스타일 재작성 — `entryStyle / exitStyle`
  - **CSS 문자열(px) 반환 → `Matrix` 반환으로 변경.** SVG `transform` 속성은 px를
    받지 않으므로 legacy 문자열은 svg/dom/vue 어댑터에서 재사용 불가였다
  - 슬라이드 200단위·zoom 0.2·pop 0.4 등 수치는 그대로 유지 (383개의 시각 정체성)
  - 중심점이 없는 요소(group/code)는 zoom을 페이드로 강등
- [x] **1.6** 텍스트/인코딩 모듈 (Q6)
  - `estimateMonospaceWidth` — EAW 기반. **legacy 버그 확인·수정**: `text.length`를
    셌으므로 한글 `'가나'`를 14.4로 계산했으나 monospace 실폭은 28.8이다
  - `escapeXmlText / escapeXmlAttr` + XML 1.0 금지 제어문자 제거
  - `toBase64 / fromBase64` — `TextEncoder` 기반. 플랫폼 디코더와 일치 검증
  - `segmentGraphemes` — `Intl.Segmenter`, 미지원 시 코드포인트 폴백
  - CJK 계열을 명시한 폰트 폴백 체인 기본값
- [x] **1.7** 에셋 모듈 (Q3) — `AssetResolver`, `inline/external/ref` 해석,
  `encodeImageAsset` / `inlineAssetFromDataUri` / `sniffImageMime`
  - 씬 빌드는 동기이므로 async 리졸버는 `prefetchAssets`로 선행 해석 → `pending` 보고
  - 리졸버 예외는 에셋 단위로 격리
- [x] **1.8** 마이그레이터 — legacy v3/v4 → v1 (`clotho migrate`)
  - 원칙: **선언된 것이 아니라 렌더된 것을 보존한다.** group은 legacy에서 렌더러
    분기가 없어 아무것도 그리지 않았고 자식은 절대 좌표로 독립 렌더됐다. 따라서
    자식 좌표를 유지하고 그룹 transform을 항등으로 리셋한다(불일치 시 note 보고)
  - `image.src` → `assets` 등록. `data:` URI는 inline, 그 외는 external
  - **383개 무손실 변환 확인**: 4가지 명시 변경 외 모든 필드 바이트 동일, note 0건,
    멱등, 검증 에러 0
  - `check:legacy-equivalence`가 실제 마이그레이터를 통과하도록 갱신 → 차이 0 유지
- [x] **1.9** 검증기 API + CLI (`clotho validate`)
  - 출처: `validate-animations.mjs` — 중복 ID / 참조 무결성 / 시간 범위
  - v1 추가: `parentId` 순환·미존재·비그룹, `assetId` 미해결, 미사용 에셋,
    flow 대상 타입, 키프레임 역순, 0 duration 이펙트
  - **실데이터에서 기존 버그 2종 발견** (아래 참조)
- [x] **1.10** 로더 — `core/load`(BOM·JSON·마이그레이션 게이트 + fetch 로더),
  `clotho/node`(파일시스템). 실패 시 원인을 반환값에 담는다
  - id를 경로에 넣기 전에 패턴 검사 (`../` 탈출 차단)
  - `.d.ts`가 `lib.dom`에 의존하지 않도록 `Response`/`RequestCache`를 구조적 타입으로 대체

## Phase 2 — 씬 그래프 (Q4의 토대)

- [ ] **2.1** `SceneNode` 타입 정의 및 `buildScene(def, t, ctx)` 골격
- [ ] **2.2** 요소별 씬 변환 — shapes / arrows / text / image / path / polygon
  - 출처: `render-elements/*.tsx`의 JSX를 씬 노드 생성으로 치환
- [ ] **2.3** `code` 요소 씬 변환 + 하이라이터 주입 훅 (기본 JS 토크나이저)
- [ ] **2.4** 이펙트 씬 변환 — highlight / pulse / flow(파티클)
- [ ] **2.5** 마커 defs를 데이터로 — HTML 문자열 주입 제거
- [ ] **2.6** 그룹 중첩 씬 변환 (1.3 위)
- [ ] **2.7** 씬 그래프 골든 테스트 — 383개 × 대표 시각의 `/svg` 직렬화 스냅샷

## Phase 3 — 재생 컨트롤러

- [ ] **3.1** `createPlayer(def, opts)` — play/pause/seek/setSpeed/subscribe/destroy
  - 내부는 순수 `advanceTime()`, rAF는 주입 가능한 스케줄러 (테스트용 가짜 시계, SSR no-op)
- [ ] **3.2** 챕터 추적, 루프/종료 처리, 축소 모션 연동(`effectivePlayback`)

## Phase 4 — 어댑터

- [ ] **4.1** `/svg` — `SceneNode` → 문자열 직렬화 (순수, SSR 안전, XML 이스케이프)
  - **가장 먼저 구현한다.** 씬 그래프 검증 수단이자 다른 어댑터의 정답지
- [ ] **4.2** `/react` — 씬 매퍼 + `useSyncExternalStore` 바인딩
- [ ] **4.3** `/react` 플레이어 UI — `ControlsBar / StepLabel / ZoomControls / Modal / icons`
  - 출처: oh-my-blog `controls-bar.tsx` 등 + `use-fullscreen / use-viewer-a11y / use-reduced-motion`
- [ ] **4.4** `/dom` — 바닐라 어댑터. 최초 마운트 후 속성만 패치(요소 재생성 회피)
- [ ] **4.5** `/dom` 플레이어 UI (프레임워크 없는 컨트롤)
- [ ] **4.6** `/vue` — `h()` 매퍼 + `shallowRef` 바인딩 + 플레이어 컴포넌트
- [ ] **4.7** UI 문자열 i18n — 기본 영어 + 주입 옵션 (현재 한국어 하드코딩)
- [ ] **4.8** 어댑터 간 출력 동등성 테스트 (동일 씬 → 동일 SVG 구조)

## Phase 5 — 스타일

- [ ] **5.1** CSS를 패키지 자산으로 추출 (`@shinkeonkim/clotho/styles.css`)
  - 출처: oh-my-blog `globals.css` 약 500줄 (상위집합)
  - **클래스명 접두사 `anim-` → `cloth-`** 로 전환 (확정). 소비처 CSS 수정 동반
- [ ] **5.2** 테마 토큰화 — 소비처 CSS 변수 의존을 clotho 토큰으로 감싸고 오버라이드 가능하게
- [ ] **5.3** 라이트/다크 · 축소 모션 · 반응형 회귀 확인

## Phase 6 — 패키징 및 공개

- [ ] **6.1** 빌드 — ESM + `.d.ts`, 서브패스 exports 6종 검증
- [ ] **6.2** 번들 크기 예산 (코어 / 어댑터별), 사이드이펙트 플래그
- [ ] **6.3** README / API 문서 / v1 포맷 스펙 문서
- [ ] **6.4** JSON Schema 산출물 배포 (zod → JSON Schema, `$schema` URL 확정)
- [ ] **6.5** 프레임워크별 예제 (react / vue / vanilla / SSR)
- [ ] **6.6** CONTRIBUTING · CHANGELOG · CI (typecheck/lint/test/build)
- [ ] **6.7** `@shinkeonkim/clotho@0.1.0` 배포

## Phase 7 — 역적용 (소비처 마이그레이션)

- [ ] **7.1** 383개 legacy 문서를 v1으로 일괄 변환 + 시각 회귀 확인
- [ ] **7.2** `oh-my-blog` — `packages/animation-engine` 제거, clotho 의존으로 교체
  - `packages/schema/src/animation.ts`의 passthrough 봉투 검증도 clotho로 대체
  - `animation-api` 저장 검증 경로 전환
- [ ] **7.3** `shinkeonkim.github.io` — `src/entities/animation/engine` 제거, clotho 의존으로 교체
  - `astro/zod` → `zod` 전환 영향 확인
  - `prebuild`의 `validate-animations.mjs` → `clotho validate`
- [ ] **7.4** 양쪽 시각 회귀 최종 확인

## Phase 8 — clotho-editor 분리 (별도 저장소)

- [ ] **8.1** Studio(약 9,000 LOC) 구조 조사 및 clotho 코어 의존 경계 확정
- [ ] **8.2** `/Users/koa/004-Projects/clotho-editor` 부트스트랩
- [ ] **8.3** 상태/히스토리/캔버스/타임라인/속성 패널 이식
- [ ] **8.4** 그룹 편집 UI (v1 `parentId` 모델)
- [ ] **8.5** 이미지 첨부 UI (`encodeImageAsset` + `AssetResolver` 훅)
- [ ] **8.6** 아이콘 라이브러리 등 호스트 의존 기능의 어댑터화

---

## 검증기가 실데이터에서 찾은 기존 버그

1.9 검증기를 마이그레이션된 383개 문서에 돌려 나온 경고 10건은 전부 실제 문제였다.

| 문서 | 문제 |
| --- | --- |
| `point-in-non-convex-polygon.json` | `arrow` 2개(`ray1`/`ray2`)가 `toX`/`toY`를 쓴다. 스키마 필드는 `x2`/`y2`이므로 끝점이 해석되지 않고 **legacy에서도 렌더된 적이 없다** |
| `http2-multiplexing` 외 4건 | `flow` 이펙트 8개가 `rect`를 대상으로 한다. legacy 엔진은 `type !== 'arrow'`를 걸러내므로 **아무것도 그리지 않았다** |

두 경우 모두 조용히 실패하던 설정이다. Phase 7 역적용 때 원본 문서를 고친다.

## 추가 확정 사항

| # | 항목 | 결정 |
| --- | --- | --- |
| S1~S6 | v1 포맷 세부 | `docs/SCHEMA-V1.md` §5에 확정 기록 |
| N1 | Vue 지원 범위 | **Vue 3부터** (`h()` API 안정) |
| N2 | 어댑터 배포 형태 | 서브패스 유지 (씬 그래프 계약 버전 어긋남 방지) |
| N3 | CSS 클래스 접두사 | **`cloth-`** (`anim-`에서 전환) |
| N4 | 폰트 메트릭 | 추정 기본 + 실측 주입 훅 제공 |

## 작업 원칙

- 작업 단위별 커밋. 메시지 형식: `[작업 단위] 작업 내용`
- 포팅 시 **출처 파일을 명시**하고, 동작 변경이 있으면 커밋 메시지에 사유를 남긴다
- 383개 코퍼스 회귀(마이그레이션 무손실 + 씬 그래프 동등성)가 깨지면 실패로 간주한다
- 코어에 프레임워크/DOM 의존이 새어 들어가면 실패로 간주한다 (CI에서 강제)
- 렌더 동작을 바꾸는 변경은 `check:legacy-equivalence`가 잡는다. 의도된 변경이면
  스크립트를 지우지 말고 이유를 남기고 갱신한다

## 로컬 검증 명령

| 명령 | 내용 | CI |
| --- | --- | --- |
| `bun test` | 유닛 + 코퍼스 회귀 | O |
| `bun run typecheck` / `lint` | 타입/린트 | O |
| `bun run check:core-purity` | 코어에 프레임워크·DOM 의존 유입 차단 | O |
| `bun run check:legacy-equivalence` | legacy 엔진과 렌더 동등성 차분 검증 | X (`.private` 필요) |
