# clotho 아키텍처

조사 근거는 [`RESEARCH.md`](./RESEARCH.md). 문서 포맷 스펙은 [`SCHEMA-V1.md`](./SCHEMA-V1.md). 이 문서는 그 위에서 내린 구조 결정을 기록한다.

---

## 1. 설계 원칙

1. **코어는 순수하다.** 스키마·런타임·기하·시간 계산에 DOM/프레임워크/파일시스템 의존을 두지 않는다. 기존 `runtime.ts`가 이미 그렇고, 이 성질을 깨뜨리지 않는 것이 clotho의 핵심 제약이다.
2. **렌더 결과는 데이터다.** 코어는 시각을 받아 **씬 그래프(순수 데이터)** 를 만든다. 프레임워크 어댑터는 그 데이터를 자기 표현으로 옮기기만 한다. 렌더 로직이 어댑터마다 복제되면 4개 어댑터가 4개의 서로 다른 버그를 갖게 된다.
3. **재생 상태도 프레임워크 밖에 있다.** rAF 루프·play/pause/seek/speed는 프레임워크 무관 컨트롤러가 소유하고, 어댑터는 구독만 한다.
4. **JSON이 계약이다.** 데이터 포맷은 코드보다 오래 산다. 스키마 변경은 마이그레이터를 동반한다.
5. **작성자 의도를 훼손하지 않는다.** 저장된 정의는 렌더 시점에만 매핑하고(테마 색 등) 변형해 저장하지 않는다. (기존 `theme-colors.ts` 원칙 계승)
6. **호스트 자원은 훅으로 주입받는다.** 이미지 에셋, 코드 하이라이터, 폰트 메트릭, i18n 문자열은 패키지가 결정하지 않고 소비처가 주입한다.

## 2. 계층 구조

```
┌─ core (프레임워크 무관, 순수) ──────────────────────────────────┐
│  schema      문서 파싱/검증 (zod)                                │
│  runtime     computeSnapshot(def, t) → SnapshotMap              │
│  scene       buildScene(def, t, ctx) → Scene   ★신규             │
│  timing      advanceTime, effectivePlayback, ease               │
│  player      createPlayer(def, opts) → PlayerHandle  ★신규       │
│  geometry    앵커, 종횡비, 폴리곤 중심                            │
│  theme       테마 색 해석, entry/exit 페이즈 스타일                │
│  text        UTF-8 안전 인코딩, XML 이스케이프, 폭 추정  ★신규     │
│  assets      에셋 참조 해석 + 호스트 훅  ★신규                    │
│  validate    스키마 + 의미 검증                                  │
│  migrate     legacy v3/v4 → clotho v1                           │
│  plugins     작성 pipeline 확장(parse/normalize/compile/validate) │
└─────────────────────────────────────────────────────────────────┘
              │ Scene (순수 데이터)          │ PlayerHandle (구독)
     ┌────────┴────────┬────────────┬────────┴──────┐
     ▼                 ▼            ▼               ▼
  /react            /vue          /dom            /svg
  React elements   Vue vnodes   실 DOM 패치     문자열 직렬화
                                                (SSR/정적 내보내기)
```

## 3. 씬 그래프 (Q4의 핵심)

기존 렌더러는 React JSX였다. 조사 결과 출력이 **순수 SVG 요소뿐**이고 `foreignObject`가 없으므로(marker defs 한 곳만 HTML 문자열), 중간 표현으로 안전하게 걷어낼 수 있다.

```ts
type Scene = {
  viewBox: { width: number; height: number };
  background: string; // 테마 해석 완료
  showMat: boolean;
  defs: SceneDef[]; // 화살촉 마커 등
  nodes: SceneNode[];
};

type SceneNode =
  | { kind: 'group'; attrs: Attrs; style?: NodeStyle; children: SceneNode[] }
  | {
      kind: 'rect' | 'circle' | 'line' | 'path' | 'polygon' | 'image';
      attrs: Attrs;
      style?: NodeStyle;
    }
  | { kind: 'text'; attrs: Attrs; style?: NodeStyle; spans: TextSpan[] };

type NodeStyle = {
  // CSS transform 문자열이 아니라 구조화 데이터
  opacity?: number;
  transform?: Transform[]; // [{ translate }, { scale }, { rotate }]
};
```

**중요한 변경**: 기존 `phase-styles.ts`는 `transform: "translate(10px 20px) scale(0.4)"`처럼 **CSS 문자열에 px 단위**를 붙여 반환한다. React `style` prop 전용 형태다. 씬 그래프에서는 구조화 데이터로 바꿔, 어댑터가 CSS transform이든 SVG `transform` 속성이든 고를 수 있게 한다. (SVG 속성 transform은 px 단위를 받지 않으므로 문자열 그대로는 재사용 불가다.)

각 어댑터가 하는 일은 `SceneNode` 트리를 자기 노드로 옮기는 30~80줄짜리 매퍼뿐이다.

### 어댑터별 특성

| 어댑터 | 방식 | 비고 |
| --- | --- | --- |
| `/react` | `SceneNode` → `createElement` | 기존 소비처 2곳이 사용. 1급 |
| `/vue` | `SceneNode` → `h()` | Vue 3, `defineComponent` |
| `/dom` | `SceneNode` → 실 DOM 패치 | 프레임워크 없이. 최초 마운트 후 속성만 갱신(요소 재생성 회피) |
| `/svg` | `SceneNode` → 문자열 | 정적 내보내기·SSR·썸네일. XML 이스케이프 필수(§6) |

`/svg`는 부수 효과 없는 순수 함수이므로 **씬 그래프 정확성의 골든 테스트 수단**이기도 하다. 프레임 문자열 스냅샷이 회귀 감시에 그대로 쓰인다.

## 4. 재생 컨트롤러

rAF 루프와 재생 상태가 현재 React 컴포넌트에 묶여 있다. 어댑터 4개가 각자 재구현하면 버그도 4개가 된다. 프레임워크 밖으로 뺀다.

```ts
const player = createPlayer(def, { autoplay, loop, speed, initialTime });
player.play();
player.pause();
player.seek(t);
player.setSpeed(1.5);
player.subscribe((state) => {
  /* { time, playing, chapterIndex } */
});
player.destroy();
```

내부는 기존 `advanceTime()`(순수)을 그대로 쓰고, rAF만 주입 가능한 스케줄러로 둔다 (테스트에서 가짜 시계 주입, SSR에서 no-op).

바인딩은 얇다 — React는 `useSyncExternalStore`, Vue는 `shallowRef` + `onScopeDispose`, vanilla는 직접 구독. 이 컨트롤러는 clotho-editor의 타임라인 스크럽에도 그대로 쓰인다.

## 5. 에셋 모델 (Q3)

이미지는 문서에 URL을 박아 넣는 방식(`src: string`)이었다. 오픈소스 패키지로는 부족하다 — 문서가 특정 호스트 경로에 묶이고, 자기완결적 공유가 안 된다.

문서는 `assets` 레지스트리를 갖고 요소는 `assetId`로 참조한다.

```jsonc
"assets": {
  "logo": { "kind": "inline",   "mime": "image/png", "data": "iVBORw0KG..." },
  "hero": { "kind": "external", "url": "https://example.com/hero.png" },
  "chart": { "kind": "ref",     "key": "post-42/chart" }
}
```

- `inline` — base64. 문서가 자기완결적. **`btoa()`는 Latin-1만 처리하므로 쓰지 않는다**(§6).
- `external` — URL 그대로.
- `ref` — 호스트가 해석. 소비처가 훅을 주입한다.

```ts
const resolver: AssetResolver = {
  resolve(ref) {
    // string | Promise<string> — data URI 또는 URL 반환
    return myCdn.urlFor(ref.key);
  },
};
```

`ref`가 해석되기 전에는 플레이스홀더를 렌더한다(레이아웃 흔들림 방지). 해석 실패는 씬 빌드를 깨뜨리지 않고 에셋 단위로 격리한다.

에디터가 "이미지 첨부" UI를 만들 수 있도록, 파일 → `inline` 에셋 변환 유틸(`encodeImageAsset`)을 코어에 둔다. 업로드 경로를 쓰는 호스트는 `ref` + 훅을 쓰면 된다.

## 6. 텍스트와 인코딩 (Q6)

조사에서 실제로 깨지는 지점을 확인했다. 추상적 고려사항이 아니다.

| 이슈 | 현상 | 대응 |
| --- | --- | --- |
| **CJK 폭 가정** | `code` 렌더러가 `charWidth = fontSize * 0.6` 고정. 한글/CJK는 monospace에서 약 2배 → 줄번호 폭과 정렬 어긋남 | `estimateTextWidth(str, fontSize)` — East Asian Width 기반 폭 2 계산. 호스트가 실측 메트릭을 주입할 훅도 제공 |
| **XML 이스케이프** | `/svg` 문자열 어댑터에서 `&`, `<`, `>`, 따옴표 미처리 시 문서 파손 + 주입 위험 | `escapeXmlText` / `escapeXmlAttr`를 직렬화 경로에 강제 |
| **base64 + UTF-8** | `btoa()`는 Latin-1 전용. 한글 포함 SVG/텍스트를 data URI로 만들면 예외 또는 깨짐 | `TextEncoder` 기반 인코더. Node/브라우저 양쪽 동작 |
| **JSON 로드** | BOM이 붙은 파일은 `JSON.parse` 실패 | UTF-8 명시 + BOM 스트립 |
| **그래핌 클러스터** | 이모지/결합 문자를 `.split('')`하면 서로게이트 페어가 쪼개짐 | 텍스트 분절이 필요한 곳은 `Intl.Segmenter` 사용 |
| **폰트 폴백** | SVG `<text>`는 시스템 폰트에 의존 → 한글 폰트 없는 환경에서 tofu | 기본 `font-family` 폴백 체인 제공 + 오버라이드 |

## 7. 패키지 경계

npm `clotho`는 선점되어 있어 **`@kokoa/clotho`** 로 배포한다. CLI 빈 이름은 `clotho` 유지.

```
@kokoa/clotho
├── "."            → 코어 (의존: zod)
├── "./react"      → React 어댑터   (peer: react, react-dom)
├── "./vue"        → Vue 3 어댑터   (peer: vue)
├── "./dom"        → 바닐라 어댑터  (peer 없음)
├── "./svg"        → 문자열 직렬화  (peer 없음, SSR 안전)
├── "./node"       → 파일시스템 로더
└── "./styles.css" → 스타일시트
```

**단일 패키지 + 서브패스**를 택한 이유: 어댑터가 코어와 버전이 어긋나면 씬 그래프 계약이 깨진다. 한 패키지로 묶으면 그 위험이 구조적으로 사라진다. 어댑터별 의존은 optional peer로 두어 React 소비처가 Vue를 끌어오지 않게 한다.

## 8. 디렉터리 구조

```
src/
├── core/
│   ├── schema/      primitives, elements, effects, assets, document, index
│   ├── runtime/     snapshot, chapters, effects
│   ├── scene/       build(씬 빌더), nodes(타입), elements/(요소별 씬 변환)
│   ├── timing/      clock, playback, ease
│   ├── player/      create-player, scheduler
│   ├── geometry/    anchors, stage, polygon
│   ├── theme/       colors, phase-styles
│   ├── text/        encode(base64/XML), width(EAW), segment
│   ├── assets/      resolver, encode
│   ├── validate/    schema + 의미 검증
│   ├── migrate/     legacy-v4 → v1
│   └── index.ts
├── react/  vue/  dom/  svg/     각 어댑터 (씬 매퍼 + 플레이어 바인딩 + UI)
├── node/            파일시스템 로더
├── styles/          clotho.css
└── cli/             validate, migrate
tests/
├── fixtures/        383개 legacy 코퍼스 (외부 참조)
└── corpus.test.ts   마이그레이션 + 씬 빌드 전수 회귀
```

## 9. 기존 구현 대비 변경 사항

| 항목             | 기존                             | clotho                         |
| ---------------- | -------------------------------- | ------------------------------ |
| 렌더 계층        | React JSX 직접                   | 씬 그래프 + 어댑터 4종         |
| 재생 루프        | React 컴포넌트 내부              | 프레임워크 무관 컨트롤러       |
| 페이즈 transform | CSS 문자열(px)                   | 구조화 데이터                  |
| 문서 버전        | `version: 3 \| 4` (둘이 동일)    | `clothoVersion: 1` 신규 체계   |
| `group`          | 스키마만 존재, **렌더러 미구현** | 실제 중첩 구현 (§SCHEMA-V1)    |
| `image`          | `src` 문자열                     | 에셋 레지스트리 + 호스트 훅    |
| 보간 키 판정     | 하드코딩 문자열 집합             | 속성 메타데이터 기반           |
| 코드 하이라이팅  | JS 전용 하드코딩 토크나이저      | 하이라이터 주입 훅 (기본은 JS) |
| 텍스트 폭        | `fontSize * 0.6` 고정            | EAW 기반 추정 + 메트릭 훅      |
| zod import       | `astro/zod` / `zod`              | `zod` 단일화                   |
| 검증             | 빌드 스크립트                    | 패키지 API + CLI               |
| 스타일           | 각 앱 전역 CSS                   | 패키지 자산                    |
| UI 문자열        | 한국어 하드코딩                  | 기본 영어 + 주입               |
| 테스트           | 두 저장소에 분산                 | 합집합                         |

## 10. 비목표 (v0.1 범위 밖)

- 에디터/Studio — `clotho-editor`로 분리
- Svelte/Solid/Angular 어댑터 (씬 그래프가 있으므로 추후 저비용)
- 비디오/GIF 서버 사이드 익스포트 (`/svg` 프레임 직렬화가 토대는 제공)
- 새 요소 타입 / 새 이펙트 타입 추가

## 11. Compiler plugin 경계

Plugin은 runtime과 renderer를 확장하지 않는다. 외부 입력을 순수 JSON으로 처리해 최종 `AnimationDocument`를 만들거나 추가 finding·artifact를 생성한다. 모든 adapter가 이해해야 하는 layout, accessibility와 timing 의미는 built-in으로 유지한다. 상세 계약과 안전 경계는 [`PLUGINS.md`](./PLUGINS.md)를 따른다.
