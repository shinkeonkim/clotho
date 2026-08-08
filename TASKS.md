# clotho 작업 계획

JSON 기반 시각화 애니메이션 패키지. 조사 결과는 [`docs/RESEARCH.md`](./docs/RESEARCH.md),
아키텍처 결정은 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) 참조.

범례: `[ ]` 예정 · `[~]` 진행 중 · `[x]` 완료

---

## Phase 0 — 조사 및 기반 (선제작업)

- [x] **0.1** 기존 두 구현체 실측 조사 → `docs/RESEARCH.md`
- [x] **0.2** 패키지 아키텍처 결정 → `docs/ARCHITECTURE.md`
- [x] **0.3** 작업 계획 문서화 → 본 문서
- [x] **0.4** 프로젝트 스캐폴딩 (bun, TypeScript, tsup, eslint/prettier, 디렉터리 구조)
- [x] **0.5** 383개 JSON 코퍼스를 회귀 픽스처로 연결 (`tests/fixtures`)

## Phase 1 — 코어 (프레임워크 무관, `clotho`)

기존 코드가 이미 순수 TS이므로 **포팅 + 테스트 보강**이 주 작업이다.

- [ ] **1.1** 스키마 포팅 — `primitives / elements / effects / document / keys`
  - 출처: 양쪽 동일. import만 `zod`로 통일
  - shinkeonkim의 스키마 테스트 6종 동반 이식
- [ ] **1.2** 런타임 포팅 — `computeSnapshot / activeAppearance / currentChapter / activeEffects`
  - 출처: `schema/runtime.ts` (양쪽 완전 동일), `runtime.test.ts` 395줄 동반
- [ ] **1.3** 순수 유틸 포팅 — `clock / playback / zoom / stage-geometry / theme-colors / phase-styles / focus-trap`
  - 출처: oh-my-blog (테스트 포함) + shinkeonkim `phase-styles.test.ts`
- [ ] **1.4** 383개 코퍼스 회귀 테스트
  - 전 파일 스키마 파싱 성공 + 타임라인 전 구간 `computeSnapshot` 무크래시/무NaN
- [ ] **1.5** 검증기 API + CLI (`clotho validate`)
  - 출처: `scripts/validate-animations.mjs` — 중복 ID / 참조 무결성 / 시간 범위
  - 결과를 구조화 객체로 반환, CLI는 `--json` / `--quiet` 지원
- [ ] **1.6** 마이그레이터 API + CLI (`clotho migrate`)
  - 출처: `scripts/migrate-animations-v3.mjs` (v2 → v3/v4)
- [ ] **1.7** 로더 — Node 파일시스템 로더 + 브라우저 fetch 로더 분리 (`clotho/node`)

## Phase 2 — React 어댑터 (`clotho/react`)

- [ ] **2.1** 마커 defs + SVG 렌더러 이식 — `shapes / arrows / text-image / code / flow-particle / effects`
  - oh-my-blog판(테마 색 적용) 기준
- [ ] **2.2** `AnimationEngine` — rAF 루프, `initialTime`/`onPlaybackEnd`, `defIdRef` 가드, 스테이지 프레임
- [ ] **2.3** 훅 — `useReducedMotion / useFullscreen / useViewerA11y`
- [ ] **2.4** 플레이어 UI — `ControlsBar / StepLabel / ZoomControls / AnimationModal / icons`
- [ ] **2.5** `AnimationPlayer` 통합 + IntersectionObserver 재생 제어
- [ ] **2.6** UI 문자열 i18n (현재 한국어 하드코딩 — 오픈소스 공개 전 필수)

## Phase 3 — 스타일

- [ ] **3.1** `.anim-*` CSS를 패키지 자산으로 추출 (`clotho/styles.css`)
  - 출처: oh-my-blog `globals.css` 약 500줄 (상위집합)
- [ ] **3.2** 테마 토큰 정리 — 소비처 CSS 변수 의존(`--color-fg` 등)을 clotho 자체 토큰으로 감싸고 오버라이드 가능하게
- [ ] **3.3** 라이트/다크 · 축소 모션 · 반응형 회귀 확인

## Phase 4 — 패키징 및 공개

- [ ] **4.1** 빌드 파이프라인 — ESM + `.d.ts`, 서브패스 exports 검증
- [ ] **4.2** 번들 크기 예산 및 사이드이펙트 플래그
- [ ] **4.3** README / API 문서 / JSON 포맷 스펙 문서
- [ ] **4.4** JSON Schema 산출물 배포 (에디터·외부 도구용, zod → JSON Schema)
- [ ] **4.5** 라이선스 · CONTRIBUTING · CHANGELOG · CI (typecheck/lint/test/build)
- [ ] **4.6** npm 배포 (`0.1.0`)

## Phase 5 — 역적용 (소비처 마이그레이션)

- [ ] **5.1** `oh-my-blog` — `packages/animation-engine`을 clotho 의존으로 교체
- [ ] **5.2** `shinkeonkim.github.io` — `src/entities/animation/engine`을 clotho 의존으로 교체
  - `astro/zod` → `zod` 전환 영향 확인
  - `prebuild`의 `validate-animations.mjs`를 `clotho validate`로 교체
- [ ] **5.3** 양쪽 383개 애니메이션 시각 회귀 확인

## Phase 6 — clotho-editor 분리 (별도 저장소)

- [ ] **6.1** Studio(약 9,000 LOC) 구조 조사 및 clotho 코어 의존 경계 확정
- [ ] **6.2** `/Users/koa/004-Projects/clotho-editor` 부트스트랩
- [ ] **6.3** 상태/히스토리/캔버스/타임라인/속성 패널 이식
- [ ] **6.4** 아이콘 라이브러리 · 이미지 업로드 등 호스트 의존 기능의 어댑터화

---

## 결정이 필요한 열린 질문

| # | 질문 | 현재 기본안 |
| --- | --- | --- |
| Q1 | `zod`를 의존성으로 둘 것인가, 검증을 선택적으로 뺄 것인가 | zod v3를 dependency로. 코어 타입은 zod 없이도 쓰이도록 타입/스키마 분리 |
| Q2 | 스키마 버전을 v4로 고정할지, clotho에서 v5를 새로 낼지 | v3/v4 입력을 그대로 수용. 새 버전은 내지 않음 |
| Q3 | 미사용 요소 `image` / `group`을 유지할지 | 유지(스키마 정의 존재). 렌더러도 함께 이식 |
| Q4 | React 외 어댑터(vanilla DOM) 우선순위 | v0.1은 React만. 코어는 어댑터 무관하게 유지 |
| Q5 | 패키지명 `clotho`의 npm 선점 여부 | 배포 직전 확인 필요. 대안: `@shinkeonkim/clotho` |
| Q6 | 한국어 UI 문자열 처리 | 기본 영어 + 문자열 주입 옵션 (2.6) |

---

## 작업 원칙

- 작업 단위별 커밋. 메시지 형식: `[작업 단위] 작업 내용`
- 포팅 시 **출처 파일을 명시**하고, 동작 변경이 있으면 커밋 메시지에 사유를 남긴다
- 383개 코퍼스 회귀가 깨지면 포팅 실패로 간주한다
