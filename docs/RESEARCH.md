# 기존 애니메이션 시스템 조사 (2026-08-08)

`clotho` 패키지의 출발점이 되는 두 기존 구현체(`.private/shinkeonkim.github.io`,
`.private/oh-my-blog`)를 실측 조사한 결과를 정리한다. 이후 설계·구현 판단의 근거 문서다.

---

## 1. 요약 결론

| 항목 | 결과 |
| --- | --- |
| 두 구현의 관계 | oh-my-blog 엔진은 shinkeonkim.github.io 엔진의 **포크 + 개선판** |
| 코어 로직 동일성 | 스키마 6파일 중 5파일이 **import 문 1줄 차이**, 런타임/렌더러 대부분 **완전 동일** |
| 더 앞선 쪽 | **엔진(뷰어) 자체는 oh-my-blog**, **주변 생태계(데이터·검증·마이그레이션)는 shinkeonkim.github.io** |
| 데이터 자산 | `shinkeonkim.github.io/public/animations/*.json` **383개** (v4 350개 / v3 33개) |
| 에디터(Studio) | 양쪽 약 **8,700~9,000 LOC**, 거의 동일. `clotho-editor`로 분리 대상 |

> USER_REQUEST.md에는 "shinkeonkim.github.io가 더 고도화"라고 적혀 있으나, 엔진 코드 기준으로는
> oh-my-blog 쪽이 뒤에 갈라져 나가며 기능이 더 추가된 상태다. 반대로 데이터·검증 도구는
> shinkeonkim.github.io에만 있다. **clotho는 양쪽의 합집합**을 취해야 한다.

---

## 2. 파일 단위 실측 비교

### 2.1 공통 코어 (거의 동일)

`shinkeonkim.github.io/src/entities/animation/engine/` ↔ `oh-my-blog/packages/animation-engine/src/`

| 파일 | diff 라인 수 | 비고 |
| --- | --- | --- |
| `schema/keys.ts` | 0 | 완전 동일 |
| `schema/runtime.ts` | 0 | 완전 동일 (스냅샷 계산 핵심) |
| `schema/primitives.ts` | 4 | `astro/zod` ↔ `zod` import 차이뿐 |
| `schema/elements.ts` | 4 | 동일 |
| `schema/effects.ts` | 4 | 동일 |
| `schema/document.ts` | 4 | 동일 |
| `phase-styles.ts` | 0 | 완전 동일 |
| `markers.ts` | 0 | 완전 동일 |
| `render-elements/index.tsx` | 0 | 완전 동일 |
| `render-elements/shapes.tsx` | 0 | 완전 동일 |
| `render-elements/code.tsx` | 0 | 완전 동일 |
| `render-elements/effects.ts` | 0 | 완전 동일 |
| `render-elements/flow-particle.tsx` | 0 | 완전 동일 |
| `render-elements/arrows.tsx` | 6 | oh-my-blog가 `resolveElementColor` 적용 |
| `render-elements/text-image.tsx` | 6 | 동일 사유 |
| `engine.tsx` | 99 | 아래 2.2 참조 |

**해석**: 코어(스키마 + 런타임 + SVG 렌더러)는 사실상 하나의 코드베이스다. clotho로 뽑아낼 때
의미 있는 병합 충돌이 발생하지 않는다. 이것이 이 프로젝트의 가장 큰 호재다.

### 2.2 oh-my-blog에만 있는 것 (엔진 개선분 — clotho가 흡수해야 함)

| 파일 | 역할 |
| --- | --- |
| `clock.ts` (+test) | `advanceTime()` — 루프/종료 판정을 순수 함수로 분리. 엔진의 rAF 콜백에서 setState 클로저 대신 `timeRef` 사용 |
| `theme-colors.ts` (+test) | 라이트/다크 대응. 스키마 기본 전경색(`#18181b`, `#0b0b0f`)만 `var(--color-fg)`로 치환하고 작성자 지정 색은 보존. 투명 캔버스는 테마 매트 노출 |
| `stage-geometry.ts` (+test) | `aspectRatio`, `isWideAspect`, `aspectRatioStyle`. SVG 자체에 `aspect-ratio` 부여 |
| `zoom.ts` (+test), `zoom-controls.tsx` | 확대 뷰어 100~300%, 25% 스텝 |
| `playback.ts` (+test) | `effectivePlayback(user, inView, reducedMotion)` |
| `focus-trap.ts` (+test), `use-viewer-a11y.ts` | 모달 포커스 트랩 / Esc / body 스크롤 락 / 포커스 복원 |
| `use-fullscreen.ts`, `use-reduced-motion.ts` | 훅 분리 |
| `controls-bar.tsx`, `step-label.tsx`, `icons.tsx`, `animation-modal.tsx` | 플레이어 UI 컴포넌트 분해 + 이모지 → SVG 아이콘 |
| `AnimationPlayer.tsx`, `index.ts` | 패키지 진입점 |

엔진 차이(`engine.tsx` 99줄)의 실질 내용:
- `initialTime`, `onPlaybackEnd` prop 추가
- `timeRef` + `advanceTime()` 도입 (setState 함수형 업데이트 제거)
- effect 의존성을 `def` 통째 → `def.duration`, `def.settings.loop`로 좁힘 (불필요한 재시작 방지)
- `def.id` 변경 시에만 시간 리셋 (`defIdRef` 가드)
- `.anim-stage-frame` 래퍼 + `preserveAspectRatio` + 테마 매트

### 2.3 shinkeonkim.github.io에만 있는 것 (생태계 — clotho가 흡수해야 함)

| 파일 | 역할 |
| --- | --- |
| `schema/*.test.ts` 6종, `runtime.test.ts`(395줄) | **테스트 자산 전량**. oh-my-blog엔 스키마/런타임 테스트가 없다 |
| `phase-styles.test.ts`, `markers.test.ts`, `render-elements/effects.test.ts` | 동일 |
| `loader.ts` (+test) | 파일시스템 기반 JSON 로더 + zod 검증. 실패 시 `null` |
| `scripts/validate-animations.mjs` (211줄) | 383개 JSON 전수 검증. 스키마 파싱 + **중복 ID** + **참조 무결성**(`fromId`/`toId`/`childIds`/`effects.elementId`) + **시간 범위**(`0..duration`, `start < end`). `prebuild`에 연결됨 |
| `scripts/migrate-animations-v3.mjs` (128줄) | v2(step 기반) → v3(타임라인 기반) 변환기 |
| `src/plugins/remark-animation.mjs` | ` ```anim:<id> {overrides} ` 코드펜스 → `.anim-placeholder` div |
| `ui/hydrate-animations.ts` | IntersectionObserver 지연 하이드레이션 + fetch 캐시 |
| `generate_animations.py` (459줄) | 애니메이션 생성 보조 스크립트 |
| `public/animations/*.json` | **383개 실데이터** |

---

## 3. 데이터 포맷 (v4)

### 3.1 문서 구조

```jsonc
{
  "version": 4,                       // 3 | 4 — 스키마상 구조 차이는 없음(리터럴만 다름)
  "id": "bellman-ford",               // ^[a-z0-9][a-z0-9_-]*$
  "title": "...", "description": "...",
  "category": "algorithm",            // network|cache|algorithm|architecture|flow|protocol|general
  "tags": ["graph", "..."],
  "duration": 12000,                  // ms
  "canvas": { "width": 800, "height": 460, "background": "transparent" },
  "elements": [ /* 아래 3.2 */ ],
  "chapters": [ { "id", "time", "label", "subtitle" } ],
  "effects":  [ /* 아래 3.3 */ ],
  "settings": { "loop": true, "autoplay": true, "showCaption": false, "showChapterList": false },
  "updatedAt": "..."
}
```

### 3.2 요소 10종과 실사용 빈도 (383개 전수 집계)

| type | 출현 수 | 비고 |
| --- | ---: | --- |
| `rect` | 2,304 | label/subtitle 내장 |
| `text` | 1,783 | |
| `circle` | 823 | |
| `arrow` | 587 | `fromId`/`toId` 앵커 연결 또는 좌표 직접 지정, `curvature` |
| `line` | 477 | |
| `code` | 19 | 코드 블록 렌더 |
| `path` | 9 | |
| `polygon` | 5 | |
| `image` | 0 | **스키마엔 있으나 실데이터 미사용** |
| `group` | 0 | **스키마엔 있으나 실데이터 미사용** |

모든 요소 공통 필드: `id`, `name?`, `rotation`, `appearances[]`, `tracks[]`.

- `appearances[]`: `{ start, end, entryMode?, entryDuration, exitMode?, exitDuration }`
  - entry/exit 모드 8종: `instant | fade | slide-left | slide-right | slide-up | slide-down | zoom | pop`
- `tracks[]`: `{ property, keyframes: [{ time, value, ease? }] }`
  - 보간은 `schema/keys.ts`의 키 분류로 결정: 숫자 키는 lerp, 색상 키는 RGBA lerp(#rgb/#rrggbb/#rrggbbaa 지원), 텍스트 키는 t<0.5 스텝
  - ease 4종: `linear | easeIn | easeOut | easeInOut`

### 3.3 이펙트 3종 (실사용 빈도)

| type | 출현 수 | 필드 |
| --- | ---: | --- |
| `pulse` | 1,258 | `scale`(기본 1.12), `duration` |
| `highlight` | 842 | `color`(기본 `#facc15`), `duration` |
| `flow` | 162 | `color`, `particles`(1~10), `radius`, `duration` |

### 3.4 런타임 (`schema/runtime.ts` — 순수 함수, 프레임워크 무관)

- `computeSnapshot(def, time) → Map<id, ElementVisualState>`: 요소별 base 속성에 트랙 보간값을 덮어쓰고, `appearances`로 `visible` + `__entryMode/__entryProgress/__exitMode/__exitProgress` 부여
- `activeAppearance(el, time)`: `entry | visible | exit` 페이즈와 진행률 계산
- `currentChapter(def, time)`, `activeEffects(def, time)`

**이 파일이 clotho 코어의 심장이다. React/Astro 의존이 전혀 없다.**

---

## 4. 통합 지점 (consumer 측)

| 관심사 | shinkeonkim.github.io | oh-my-blog |
| --- | --- | --- |
| 데이터 위치 | `public/animations/*.json` (정적 파일) | `animation-api` 서비스 (DB) |
| 마크다운 삽입 | `remark-animation.mjs` → `.anim-placeholder` | `apps/web/app/animation-embed.tsx` |
| 하이드레이션 | `hydrate-animations.ts` (IO 지연) | Next.js 클라이언트 컴포넌트 |
| 스타일 | `src/styles/global.css` (약 100줄, `.anim-*` 21개 셀렉터) | `apps/web/app/globals.css` (약 500줄, `.anim-*` 80개+ 셀렉터) |
| 검증 | `scripts/validate-animations.mjs` (prebuild) | `packages/schema/src/animation.ts` (passthrough 느슨한 봉투 검증) |

**CSS가 숨은 결합점이다.** 엔진이 만드는 클래스명(`anim-engine`, `anim-stage-frame`,
`anim-caption`, `anim-step-list`, `anim-modal-*`, `anim-wrapper-*`)에 대한 스타일이 각 앱의
전역 CSS에 흩어져 있다. clotho는 이를 패키지 자산으로 함께 배포해야 한다.

---

## 5. clotho 설계에 미치는 함의

1. **코어를 프레임워크 무관 순수 TS로 뽑는다.** `runtime.ts`, `clock.ts`, `zoom.ts`,
   `stage-geometry.ts`, `playback.ts`, `theme-colors.ts`, `phase-styles.ts`, `keys.ts`는
   이미 DOM/React 의존이 없다. 그대로 승격 가능하다.
2. **React 어댑터를 서브패스로 분리한다.** 렌더러(`render-elements/*.tsx`)와 플레이어는
   현재 React JSX다. 두 소비처 모두 React이므로 React를 1급 어댑터로 두되, 코어는
   SVG를 문자열/데이터로 기술할 수 있게 열어 둔다(향후 vanilla/Vue 어댑터 여지).
3. **oh-my-blog 엔진 + shinkeonkim 테스트**를 합친 것이 clotho v0의 목표 지점이다.
4. **383개 JSON을 회귀 테스트 픽스처로 쓴다.** 스키마 파싱 100% 통과 + 스냅샷 계산 무크래시가
   포팅 정확성의 객관적 판정 기준이 된다.
5. **CSS를 패키지 자산으로 배포한다.** oh-my-blog의 500줄 버전이 상위집합이므로 이쪽을 기준으로 삼는다.
6. **검증기를 패키지 API + CLI로 승격한다.** `validate-animations.mjs`의 의미 검증(중복 ID,
   참조 무결성, 시간 범위)은 스키마만으로는 못 잡는 부분이며, 오픈소스 사용자에게 가치가 크다.
7. **Studio(약 9,000 LOC)는 clotho-editor로 분리한다.** clotho 코어에 대한 의존만 남긴다.
