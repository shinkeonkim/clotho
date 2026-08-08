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

- [x] **2.1** `SceneNode` 타입 정의 및 `buildScene(doc, t, options)` 
  - **어트리뷰트 이름은 SVG 표기 그대로** (`stroke-width`, `preserveAspectRatio`).
    svg/dom/vue는 그대로 통과, react만 kebab→camel 기계적 변환 (SVG의 진짜
    camelCase 이름은 하이픈이 없어 그대로 유지된다)
- [x] **2.2** 요소별 씬 변환 — shapes / connectors / text / image / path / polygon
- [x] **2.3** `code` 요소 씬 변환 + `CodeHighlighter` 주입 훅 (기본 JS 토크나이저)
  - 줄번호 거터 폭을 `estimateMonospaceWidth`로 교체 → CJK 정렬 버그 해소
- [x] **2.4** 이펙트 씬 변환 — highlight / pulse / flow(파티클)
  - flow가 `line`에서도 동작하도록 확대 (legacy는 `arrow`만 허용해 조용히 무시)
- [x] **2.5** 마커 defs를 데이터로 — `dangerouslySetInnerHTML` 제거.
  참조된 마커만 방출하므로 화살표 없는 문서는 `<defs>`가 아예 없다
- [x] **2.6** 그룹 중첩 씬 변환. 페인트 순서(text 마지막)를 **형제 단위**로 적용해
  평면 문서는 legacy와 동일하고 그룹 안 text는 그룹에 남는다
- [x] **2.7** 씬 그래프 골든 테스트
  - 383개 × 대표 시각 씬 빌드, 어트리뷰트 값 NaN/undefined 0, 결정성, 이스케이프
  - `check:svg-wellformed`: 1,915 프레임을 **실제 XML 파서(expat)** 로 검증.
    문자열 휴리스틱은 `x="1"y="2"` 버그를 통과시켰고 파서만 잡아냈다

## Phase 3 — 재생 컨트롤러

- [x] **3.1** `createPlayer(doc, opts)` — play/pause/toggle/seek/restart/setSpeed/setLoop/subscribe/destroy
  - 내부는 순수 `advanceTime()`. **rAF는 코어 밖(`clotho/dom`)에 있다** — 코어 순수성
    검사가 host global을 막으므로, 코어는 인터페이스 + `createManualScheduler`(테스트)
    + `noopScheduler`(SSR 기본값)만 갖는다. react/vue는 dom 어댑터의 것을 재사용
  - 첫 프레임 타임스탬프를 경과시간으로 세지 않고, 64ms 초과 프레임을 클램프한다
    (백그라운드 탭·디버거 정지 후 재생헤드가 순간이동하는 것을 막는다)
  - 종료 후 play는 처음부터 다시 시작한다 (재생 버튼이 먹통이 되지 않게)
- [x] **3.2** 챕터 추적, 루프/종료 처리, 상태 변화 없으면 알림 생략(불필요한 리렌더 방지)

## Phase 4 — 어댑터

- [x] **4.1** `/svg` — `SceneNode` → 문자열 직렬화 (순수, SSR 안전, XML 이스케이프)
  - 씬 그래프 검증 수단이자 다른 어댑터의 정답지
  - `renderDocumentToSvg(doc, t)`: 정지 프레임·썸네일·SSR·정적 내보내기
  - `standalone`은 `rawColors`를 켠다 — 스타일시트 없는 파일에서 `var(--cloth-fg)`는
    아무것도 해석되지 않는다
- [x] **4.2** `/react` — 씬 매퍼 + `useSyncExternalStore` 바인딩
  - `toReactPropName`: kebab→camel. `data-*`/`aria-*`는 통과, `xml:space` 등은 명시 매핑
  - 플레이어를 `doc.id`/`doc.duration`으로 키잉 (legacy는 `def` 객체 전체에 의존해
    부모 리렌더마다 재생이 처음으로 되돌아갔다)
- [x] **4.3** `/react` 플레이어 UI + 훅 (`usePlayer / useReducedMotion / useInView / useFullscreen`)
- [x] **4.4** `/dom` — 바닐라 어댑터. 키 기반 패치로 요소를 재사용한다
  (12초 애니메이션 = 720프레임. 매 프레임 재생성하면 포커스·선택·CSS 전환이 날아간다)
- [x] **4.5** `/dom` 플레이어 UI (프레임워크 없는 컨트롤)
- [x] **4.6** `/vue` — `h()` 매퍼 + `shallowRef` 바인딩 + `defineComponent` 컴포넌트
  - Vue는 미지의 어트리뷰트를 그대로 통과시키므로 변환이 아예 필요 없다
- [x] **4.7** UI 문자열 i18n — 기본 영어 + `koreanStrings` 제공 + 부분 오버라이드
- [x] **4.8** 어댑터 간 출력 동등성 테스트
  - 10종 요소·3종 이펙트·그룹·전환을 모두 쓰는 픽스처로 svg/react/vue 트리 비교
  - **실제 차이 발견**: 반올림이 직렬화기에만 있어 react/vue는 `cx="178.33333333333331"`,
    svg는 `cx="178.333333"`을 냈다. 반올림을 `compactAttrs`(씬 그래프)로 옮겨
    모든 어댑터가 바이트 단위로 일치하게 했다
  - `/dom`은 happy-dom으로 별도 검증 (트리 일치 + 프레임 간 요소 재사용)

## Phase 5 — 스타일

- [x] **5.1** CSS를 패키지 자산으로 추출 (`@shinkeonkim/clotho/styles.css`)
  - 출처: oh-my-blog `globals.css` 약 500줄. 클래스명 `anim-` → `cloth-` 전환
- [x] **5.2** 테마 토큰화 — **원본은 블로그가 정의한 `--color-*`에 의존했다.**
  다른 프로젝트에 넣으면 전부 미설정으로 렌더된다. `--cloth-*` 자체 토큰에 라이트/다크
  완전 기본값을 넣어 설정 없이 동작하고, 호스트는 한 겹 매핑으로 자기 팔레트를 씌운다
- [x] **5.3** `check:styles` — 어댑터가 내보내는 클래스 ↔ 스타일시트 규칙 일치,
  토큰 선언 누락, 호스트 변수 잔존, 중괄호 균형, **두 다크 경로의 토큰 집합 동일성**
  - 추출 과정에서 실제로 규칙 중간이 잘려 나간 것을 이 검사가 잡았다
  - 미디어 쿼리 5종(다크·축소모션·coarse 포인터·portrait·landscape) 보존 확인

## Phase 6 — 패키징 및 공개

- [x] **6.1** 빌드 — ESM + `.d.ts`, 서브패스 exports 8종 + CLI 빈 경로 검증
- [x] **6.2** 번들 크기 예산 (`check:size`)
  - **진입점의 전이 폐쇄를 측정한다.** 빌드가 공유 청크로 쪼개므로 진입 파일 하나의
    크기는 무의미하다(`core/index.js` 7KB vs 그것이 당기는 청크 50KB)
  - 렌더 어댑터에 **zod가 없음을 검사로 강제**한다. 이미 파싱된 문서를 받으므로
    검증기를 번들할 이유가 없고, 렌더만 하는 소비처에 gzip 9KB를 아낀다
  - core 25KB / svg 16KB / dom·react 20KB / vue 20KB / node 6KB / cli 11KB / css 4KB (gzip)
- [x] **6.3** README (설치·4종 사용법·API·훅·테마·i18n) / CONTRIBUTING / CHANGELOG
- [x] **6.4** JSON Schema 산출 (`schema/clotho-1.schema.json`, zod에서 생성)
  - `schema:check`로 zod와 동기 여부 강제. 생성물이므로 서식 대상에서 제외
  - `$schema` URL은 호스팅 위치가 정해질 때 확정 (필드는 선택이므로 차단 요소 아님)
- [x] **6.5** 예제 4종 (vanilla html / static-svg / react / vue) + 공용 문서 1개
  - `.ts`/`.tsx` 예제는 **타입체크 대상에 포함**했다 (패키지명 self-reference 경로 매핑).
    컴파일 안 되는 예제는 없는 것보다 나쁘다 — 일부러 깨뜨려 검증됨을 확인
- [x] **6.6** CI 워크플로 (typecheck/lint/format/purity/test/build/size/styles/schema)
- [ ] **6.7** `@shinkeonkim/clotho@0.1.0` npm 배포 — **사용자 확인 대기**
  - 되돌릴 수 없고 외부로 나가는 작업이라 임의로 실행하지 않는다

## Phase 7 — 역적용 (소비처 마이그레이션)

절차는 [`docs/MIGRATION.md`](./docs/MIGRATION.md)에 호출 지점 전수 조사 기반으로 정리했다.

- [x] **7.1** 383개 문서 v1 변환 + 렌더 동등성 검증 (`scripts/migrate-corpus.ts`)
  - 383/383 legacy 엔진과 **렌더 동등**, 13,116 프레임 비교, 실패 0
  - 변환 내용은 봉투 필드 하나뿐 (코퍼스에 group/image가 0건)
  - 기본은 별도 디렉터리 출력. `--in-place`는 명시적으로 선택해야 한다
- [x] **7.1b** 조사: 소비처 호출 지점 전수 파악
  - oh-my-blog: 엔진 import 27곳 + studio 1곳. 심볼은 스키마 타입·런타임·플레이어뿐
  - shinkeonkim.github.io: 엔진 import 30곳. 그중 25곳이 Studio
  - **결론: 양쪽 다 import 경로 치환이 대부분.** 심볼 대응표를 MIGRATION.md에 작성
- [x] **7.1c** 로컬 링크 검증 — 배포 없이 소비처에서 동작함을 확인
  - `shinkeonkim.github.io`에 `file:../..`로 링크 후 `parseDocument`/`computeSnapshot`/
    `buildScene`/`renderDocumentToSvg`/`clotho/node` 로더 모두 해석·실행·타입 통과
  - 검증 후 저장소 원상 복구 (브랜치 삭제, 추적 파일 복원, 미커밋 0건)
- [~] **7.3** `shinkeonkim.github.io` 적용 — **브랜치 `feat/clotho`에서 완료, 커밋 전**
  - 뷰어만 먼저 옮기는 것은 불가능했다: Studio가 문서를 저장하므로 뷰어만 v1으로 가면
    Studio가 v4를 쓰고 사이트가 못 읽어 작성 워크플로가 끊긴다. 선택 A로 진행
  - 383개 문서 v1 in-place 변환
  - `src/entities/animation/engine/` 삭제 (스키마·런타임·렌더러·마커·페이즈 약 1,100줄).
    `src/entities/animation/lib/loader.ts`가 `clotho/node`를 감싼다
  - 뷰어: `hydrate-animations.ts`가 `createDocumentCache` + clotho `/react` 사용.
    UI 문자열은 `koreanStrings`로 기존 한국어 유지. `AnimationPlayer.tsx` 삭제
  - `AnimationLoader.astro`: 엔진 CSS 약 150줄 → clotho 스타일시트 import + 팔레트 매핑
  - `global.css`: `.anim-*` 103줄 삭제
  - Studio 30곳 import 치환 + **그룹 로직 `childIds` → `parentId` 재작성**
    (`studio-groups.ts`에 `childIdsOf()` 추가, 그룹 생성이 목록 대신 포인터 설정)
  - 이미지: `src` → `assetId` + `registerExternalAsset()` / `registerInlineAsset()` 신설
  - **Studio 미리보기를 `clotho/dom`의 `mountStage`로 교체** — 에디터와 배포본이 같은
    렌더 경로를 쓴다 (기존에는 두 구현이 갈라져 있었다)
  - `prebuild`: `validate-animations.mjs` → `bunx clotho validate public/animations`.
    스크립트 삭제. 383개 검증 실행 확인 (에러 0, 경고 377)
  - **검증: `astro check` 0 errors · `vitest run` 388 tests 통과 ·
    `astro build` 에러 0 · 번들 CSS에 clotho 56클래스 · 클라이언트 청크에 clotho 포함 ·
    `anim-` 엔진 클래스 잔존 0 · 애니메이션 상세 페이지가 "clotho v1" 표시**
  - 일괄 치환이 게시된 블로그 본문까지 건드린 것을 발견해 되돌렸다. `AGENTS.md`는
    사실과 맞게 다시 썼다 (스키마 출처, parentId/assetId 차이, 검증 경로)
  - **커밋하지 않았다.** 사용자 저장소이므로 검토 후 결정할 사항이다
- [~] **7.2** `oh-my-blog` 적용 — **브랜치 `feat/clotho`에서 완료, 커밋 전**
  - `packages/animation-engine` 삭제, 세 워크스페이스의 의존 제거
  - `packages/schema/src/animation.ts`를 clotho 재수출로 교체. 예전 passthrough 봉투
    검증은 사실상 아무것도 검증하지 않았다
  - `apps/web/app/globals.css`에서 `.anim-*` 규칙 69개 제거 → clotho 스타일시트 import
  - `animation-studio` 23파일을 7.3과 동일하게 v1 변환. `registerDataUriAsset()` 추가
    (드롭·붙여넣기가 data URI로 온다)
  - `Studio.tsx`를 `AnimationStage` + `usePlayer`로 — 에디터가 타임라인의 주인
  - **저장 경로에서 실제 버그 발견**: update 페이로드의 `id`/`updatedAt` 금지 검사가
    무력화돼 있었다(zod가 refinement 전에 키를 제거). `.passthrough()`로 수정
  - 레거시 클라이언트 호환을 위해 저장 시 자동 마이그레이션 + 봉투 필드 자동 채움
  - **검증: `packages/schema` 353 tests · typecheck 0 · `animation-studio` typecheck 0 ·
    나머지 워크스페이스는 기준선과 에러 수 동일**
- [ ] **7.4** 시각 회귀 최종 확인 — 빌드 산출물의 애니메이션 렌더 확인

## Phase 8 — clotho-editor 분리 (별도 저장소)

계획은 `clotho-editor/docs/PORTING.md`.

- [x] **8.1** Studio 구조 조사 및 의존 경계 확정
  - 8,980 LOC(shinkeonkim) / 8,751 LOC(oh-my-blog), 거의 동일
  - **엔진에서 가져오는 것은 스키마 타입 + `computeSnapshot`/`activeAppearance`뿐.
    렌더러는 쓰지 않는다** — 자체 캔버스 미리보기를 갖고 있기 때문
  - 그래서 미리보기를 `buildScene` + `patchScene`으로 바꿀 수 있다. 지금은 에디터
    렌더와 사이트 렌더가 갈라져 에디터에서 맞게 보이는 것이 배포본에서 다를 수 있다
  - v1 필수 변경: `studio-groups.ts` 재작성(`childIds` → `parentId`),
    이미지 첨부 UI 신설(`src` → `assetId`)
- [x] **8.2** `/Users/koa/004-Projects/clotho-editor` 부트스트랩 (커밋 완료)
- [ ] **8.3** 상태/히스토리/캔버스/타임라인/속성 패널 이식 — **약 9,000 LOC, 6.7 대기**
- [ ] **8.4** 그룹 편집 UI (v1 `parentId` 모델) — legacy에 없던 기능
- [ ] **8.5** 이미지 첨부 UI (`encodeImageAsset` + `AssetResolver`)
- [ ] **8.6** 아이콘 라이브러리 등 호스트 의존 기능의 어댑터화

## 남은 작업

| 항목 | 상태 | 남은 이유 |
| --- | --- | --- |
| 6.7 npm 배포 | 대기 | **사용자 확인 필요** — 되돌릴 수 없고 외부로 나간다 |
| 7.3 커밋 | 대기 | **사용자 검토 필요** — 브랜치 `feat/clotho`에 미커밋 상태로 둠 |
| 7.2 `oh-my-blog` | 미착수 | 7.3과 동일 절차. 워크스페이스 4곳 + `animation-studio` 23파일 |
| 7.4 시각 회귀 | 부분 | 빌드·마크업·CSS는 확인. 브라우저 육안 확인은 미실시 |
| 8.3~8.6 Studio 이식 | 계획 완료 | 약 9,000 LOC. `clotho-editor/docs/PORTING.md`에 순서까지 정리 |

7.3의 소비처 변경은 브랜치에 미커밋으로 두었다. 사용자 저장소이므로 커밋 여부는
검토 후 결정할 사항이다. 되돌리려면:

```bash
git -C .private/shinkeonkim.github.io checkout -- . && git switch master
git -C .private/shinkeonkim.github.io branch -D feat/clotho
```

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
| `bun run check:svg-wellformed` | 1,915 프레임을 실제 XML 파서로 검증 | X (`.private`, python3 필요) |
