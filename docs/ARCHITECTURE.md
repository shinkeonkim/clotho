# clotho 아키텍처

조사 근거는 [`RESEARCH.md`](./RESEARCH.md). 이 문서는 그 위에서 내린 구조 결정을 기록한다.

---

## 1. 설계 원칙

1. **코어는 순수하다.** 스키마·런타임·기하·시간 계산에 DOM/React/파일시스템 의존을 두지 않는다.
   기존 `runtime.ts`가 이미 그렇고, 이 성질을 깨뜨리지 않는 것이 clotho의 핵심 제약이다.
2. **렌더러는 어댑터다.** 표현 계층은 교체 가능한 어댑터로 두고, v0.1은 React만 제공한다.
3. **JSON이 계약이다.** 데이터 포맷은 코드보다 오래 산다. 스키마 변경은 마이그레이터를 동반한다.
4. **작성자 의도를 훼손하지 않는다.** 저장된 정의는 렌더 시점에만 매핑하고(테마 색 등)
   절대 변형해 저장하지 않는다. (`theme-colors.ts`의 기존 원칙 계승)

## 2. 패키지 경계

```
clotho/                      # 단일 패키지, 서브패스 exports
├── "."            → 코어   : 스키마 + 런타임 + 순수 유틸 + 검증/마이그레이션 (의존: zod)
├── "./react"      → 어댑터 : SVG 렌더러 + 엔진 + 플레이어 UI (peer: react, react-dom)
├── "./node"       → 로더   : 파일시스템 로더 (의존: node:fs)
└── "./styles.css" → 스타일 : .anim-* 스타일시트
```

CLI는 `clotho` 빈으로 노출한다 (`clotho validate`, `clotho migrate`).

**단일 패키지 + 서브패스**를 택한 이유: 소비처가 둘 다 코어와 React를 함께 쓰며, 모노레포
멀티 패키지는 버전 동기화 비용만 늘린다. 어댑터가 3개 이상으로 늘면 그때 분리한다.

## 3. 디렉터리 구조

```
src/
├── core/
│   ├── schema/         primitives, elements, effects, document, keys, index
│   ├── runtime/        snapshot(computeSnapshot/activeAppearance), chapters, effects
│   ├── timing/         clock(advanceTime), playback(effectivePlayback), ease
│   ├── geometry/       stage-geometry, anchors
│   ├── theme/          theme-colors, phase-styles
│   ├── validate/       스키마 파싱 + 의미 검증(중복 ID/참조 무결성/시간 범위)
│   ├── migrate/        v2 → v3/v4
│   └── index.ts
├── react/
│   ├── render-elements/  shapes, arrows, text-image, code, flow-particle, effects, markers
│   ├── engine.tsx        AnimationEngine (rAF 루프 + SVG 스테이지)
│   ├── player/           AnimationPlayer, controls-bar, step-label, zoom-controls, modal, icons
│   ├── hooks/            use-reduced-motion, use-fullscreen, use-viewer-a11y, focus-trap
│   └── index.ts
├── node/
│   └── loader.ts
├── styles/
│   └── clotho.css
└── cli/
    └── index.ts
tests/
├── fixtures/           383개 JSON 코퍼스 (심볼릭 참조)
└── corpus.test.ts      전수 회귀
```

## 4. 데이터 흐름

```
JSON 문서
   │  animationDefSchema.parse           (core/schema)
   ▼
AnimationDef ──────────────────────────► validate()  (core/validate)
   │
   │  computeSnapshot(def, t)            (core/runtime) ── 순수, 프레임워크 무관
   ▼
SnapshotMap: Map<elementId, ElementVisualState>
   │                                      + activeEffects(def, t)
   │                                      + currentChapter(def, t)
   ▼
<AnimationEngine>  rAF ── advanceTime()  (core/timing)
   │
   ▼
SVG 렌더러 (react/render-elements) ── phase-styles / theme-colors 적용
```

시간 t의 화면은 **오직 `(def, t)`의 함수**다. 누적 상태가 없으므로 임의 시각으로의 seek,
정지 프레임 렌더, 서버 사이드 스냅샷이 모두 같은 경로로 처리된다. 에디터(clotho-editor)의
스크럽도 이 성질에 의존한다.

## 5. 기존 구현 대비 변경 사항

| 항목 | 기존 | clotho |
| --- | --- | --- |
| zod import | `astro/zod`(A) / `zod`(B) | `zod` 단일화 |
| 테마 색 처리 | B에만 존재 | 코어 기본 동작으로 채택 |
| 시간 진행 | A는 setState 클로저 / B는 `advanceTime` | `advanceTime` 채택 |
| 검증 | A의 빌드 스크립트 | 패키지 API + CLI로 승격 |
| 스타일 | 각 앱 전역 CSS | 패키지 자산으로 배포 |
| UI 문자열 | 한국어 하드코딩 | 기본 영어 + 주입 옵션 |
| 테스트 | A에 스키마/런타임, B에 유틸 | 합집합 |

## 6. 비목표 (v0.1 범위 밖)

- 에디터/Studio — `clotho-editor`로 분리
- React 외 렌더 어댑터
- 새 요소 타입 / 새 이펙트 타입 추가
- 스키마 v5
- 서버 사이드 비디오/GIF 익스포트
