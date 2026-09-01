# clotho 문서 포맷 v1

**상태: 확정 (2026-08-08).** 기존 legacy v3/v4를 대체하는 새 체계다. 근거는 [`RESEARCH.md`](./RESEARCH.md), 구조 결정은 [`ARCHITECTURE.md`](./ARCHITECTURE.md).

설계 태도: **이유 있는 것만 바꾼다.** legacy v4는 383개 실문서로 검증된 포맷이므로 잘 작동하는 부분(요소 10종, `appearances`/`tracks` 타임라인 모델, 이펙트 3종, ms 시간 단위)은 그대로 계승한다. 변경 사항은 아래 §2에 기록한다.

---

## 1. 문서 골격

```jsonc
{
  "clothoVersion": 1, // 포맷 버전. 이 필드의 존재가 clotho 문서임을 뜻한다
  "$schema": "…/clotho-1.json", // 선택. 에디터 자동완성용
  "id": "bellman-ford", // ^[a-z0-9][a-z0-9_-]*$
  "title": "벨만-포드",
  "description": "…",
  "category": "algorithm", // 자유 문자열 (legacy: 고정 enum 7종)
  "tags": ["graph", "shortest-path"],
  "duration": 12000, // ms
  "locales": ["ko", "en"], // 생략 시 기본값. BCP 47 tag로 자유롭게 확장
  "canvas": { "width": 800, "height": 460, "background": "transparent" },
  "assets": {/* §2.3 */},
  "elements": [/* §2.1, §2.2 */],
  "layouts": [/* §2.8 */],
  "chapters": [{ "id": "c1", "time": 2000, "label": "Round 1", "subtitle": "" }],
  "effects": [{ "type": "pulse", "id": "p1", "elementId": "n-a", "time": 2000 }],
  "settings": {
    "loop": true,
    "autoplay": true,
    "showCaption": false,
    "showChapterList": false,
    "chapterListPosition": "right",
  },
  "updatedAt": "2026-08-08T00:00:00Z",
}
```

**버전 판별**: `clothoVersion` 필드가 있으면 v1. 없고 `version: 3|4`면 legacy이며 런타임이 직접 받지 않고 `migrate()`를 통과해야 한다. `1 < 4`이라 `version` 숫자를 재사용하면 다운그레이드로 오독되므로 필드 이름 자체를 바꿨다.

## 2. legacy 대비 변경점

### 2.1 그룹: `childIds` → `parentId` (실제 중첩)

legacy `group`은 **스키마에만 있고 렌더러 구현이 없었다**(`RenderElement`에 분기 없음 → `null`). 게다가 `childIds` 참조 목록 구조로는 SVG `<g>` 중첩이 만들어지지 않아 부모 transform이 자식에 전파되지 않는다. 즉 legacy의 그룹은 동작한 적이 없다.

v1은 **평면 배열 + `parentId`** 로 트리를 표현한다.

```jsonc
"elements": [
  { "type": "group",  "id": "cluster", "x": 100, "y": 50, "rotation": 15,
    "appearances": [{ "start": 0, "end": 12000 }] },
  { "type": "rect",   "id": "box-a", "parentId": "cluster", "x": 0,  "y": 0, "width": 80, "height": 40 },
  { "type": "circle", "id": "dot-a", "parentId": "cluster", "cx": 40, "cy": 60, "r": 10 }
]
```

- `parentId` 생략 = 루트.
- 자식 좌표는 **부모 기준 상대 좌표**. 씬 빌더가 `<g transform>`로 합성한다.
- z-order: 같은 부모 안에서는 배열 순서.
- 그룹의 `appearances`/`tracks`/entry·exit는 **서브트리 전체에 적용**된다. 그룹이 숨으면 자식도 숨는다.
- `group`도 `tracks`를 가질 수 있어 그룹 단위 이동/회전 애니메이션이 된다.

평면 구조를 택한 이유: 중첩 배열보다 에디터가 다루기 쉽다(안정적인 평면 목록, 재부모화가 필드 하나 수정, id 조회가 O(1)). 트리는 렌더 시점에 만든다.

**검증 필수**: `parentId` 순환 참조, 존재하지 않는 부모, `group`이 아닌 요소를 부모로 지정.

### 2.2 트랙 보간: 하드코딩 키 집합 → 명시 가능

legacy는 `keys.ts`에 속성명 문자열 집합(`NUMERIC_KEYS`, `COLOR_KEYS`, `TEXT_KEYS`)을 박아 보간 방식을 정했다. 집합에 없는 속성은 조용히 스텝 보간으로 떨어지고, 사용자 정의 속성은 불가능하다.

```jsonc
{
  "property": "fill",
  "interpolate": "color",
  "keyframes": [
    { "time": 0, "value": "#e0e7ff" },
    { "time": 2000, "value": "#dcfce7" },
  ],
}
```

`interpolate`: `"auto" | "number" | "color" | "discrete"` (기본 `"auto"`). `auto`는 기존 속성명 휴리스틱을 그대로 적용하므로 마이그레이션이 무손실이다.

### 2.3 이미지: `src` 문자열 → 에셋 레지스트리 + 호스트 훅

legacy `image.src`는 URL 문자열이라 문서가 특정 호스트 경로에 묶였다. (실데이터 383개에 `image` 사용이 0건인 것도 이 때문으로 보인다.)

```jsonc
"assets": {
  "logo":  { "kind": "inline",   "mime": "image/png", "data": "iVBORw0KG…" },
  "hero":  { "kind": "external", "url": "https://example.com/hero.png" },
  "chart": { "kind": "ref",      "key": "post-42/chart" }
},
"elements": [
  { "type": "image", "id": "im-1", "assetId": "logo",
    "x": 20, "y": 20, "width": 120, "height": 40 }
]
```

- `inline` — base64. 문서 자기완결. 인코딩은 `TextEncoder` 기반(`btoa`는 Latin-1 전용이라 금지).
- `external` — URL 그대로.
- `ref` — 소비처가 주입한 `AssetResolver`가 해석. 해석 전에는 플레이스홀더, 실패는 에셋 단위 격리.

에디터의 "이미지 첨부"는 파일 → `inline` 변환 유틸(`encodeImageAsset`)로 구현한다.

### 2.4 `category`: 고정 enum → 자유 문자열

legacy enum은 `network|cache|algorithm|architecture|flow|protocol|general` 7종으로, 특정 블로그의 분류다. 오픈소스 패키지가 사용자의 분류 체계를 정할 이유가 없다. 자유 문자열(기본 `"general"`)로 두고 분류는 `tags`와 소비처에 맡긴다.

### 2.5 `version: 3 | 4` 제거

두 값의 스키마 차이가 **전혀 없었다**(리터럴만 다름). 구조 차이 없는 버전 분기는 검증만 복잡하게 만든다. `clothoVersion: 1`로 대체한다.

### 2.6 코드 요소: 하이라이터 주입

legacy `code`는 `language` 필드를 받지만 렌더러는 JS 키워드 집합을 하드코딩한 토크나이저 하나뿐이었다. 문서 포맷은 그대로 두고 **렌더 옵션으로 하이라이터를 주입**받는다 (기본값은 기존 JS 토크나이저). 문서 스키마 변경은 없다.

### 2.7 text 국제화

기존 `text.content`는 기본 문구로 유지한다. 문서의 `locales`는 제공하는 언어 목록이며 생략하면 `ko`, `en`이다. 특정 text만 다른 언어가 필요하면 요소의 `locales`로 덮어쓰고 `translations`에 locale별 문구를 저장한다.

```jsonc
{
  "type": "text",
  "id": "greeting",
  "x": 400,
  "y": 240,
  "content": "안녕하세요",
  "locales": ["ko", "en", "ja", "zh-CN", "fr"],
  "translations": {
    "en": "Hello",
    "ja": "こんにちは",
    "zh-CN": "你好",
    "fr": "Bonjour"
  }
}
```

언어 목록은 고정 enum이 아니라 BCP 47 형식의 문자열 배열이다. 렌더러는 `SceneOptions.locale`의 정확한 번역, 기본 언어 번역(`en-US` → `en`), `content` 순서로 문구를 선택한다. 따라서 기존 문서는 변환 없이 같은 문구를 표시한다.

### 2.8 Constraint Layout

`layouts`는 요소의 배치 의도를 저장한다. `row`, `column`, `grid`로 기본 배치를 정하고 `rightOf`, `below`, `sameX`, `sameY`, `align`, `contain`, `minGap`으로 요소 사이의 관계를 추가할 수 있다.

```jsonc
"layouts": [{
  "id": "steps",
  "mode": "row",
  "elementIds": ["parse", "check", "draw"],
  "x": 80,
  "y": 160,
  "gap": 24,
  "align": "center",
  "constraints": [
    { "type": "minGap", "firstId": "check", "secondId": "draw", "axis": "x", "gap": 40 }
  ]
}]
```

`defineAnimation`과 compiler pipeline은 layout을 계산한 뒤 각 요소의 절대 좌표를 문서에 고정한다. text는 host가 제공한 `TextMeasurer`를 우선 사용하고, 제공하지 않으면 core의 결정적인 폭 추정치를 사용한다. player와 adapter는 이미 계산된 좌표만 렌더링하므로 같은 입력에서 같은 장면을 만든다.

## 3. 계승하는 부분 (변경 없음)

- **요소 10종**: `rect · circle · line · arrow · text · image · path · polygon · group · code`
- **`appearances[]`**: `{ start, end, entryMode?, entryDuration, exitMode?, exitDuration }` entry/exit 8종 `instant · fade · slide-{left,right,up,down} · zoom · pop`
- **`tracks[]`**: `{ property, keyframes: [{ time, value, ease? }] }`, ease 4종
- **이펙트 3종**: `highlight · pulse · flow`
- **`chapters[]`**, **`settings`**, ms 시간 단위, 앵커 연결(`fromId`/`toId`/`fromAnchor`/`toAnchor`)
- 시각 상태는 오직 `(문서, t)`의 순수 함수

## 4. 마이그레이션 (legacy v3/v4 → v1)

| legacy | v1 | 손실 |
| --- | --- | --- |
| `version: 3 \| 4` | `clothoVersion: 1` | 없음 |
| `category` enum 값 | 동일 문자열 | 없음 |
| `group.childIds: ["a","b"]` | 각 자식에 `parentId` 부여 | 없음. **legacy에서 미동작이었으므로 시각 회귀도 없음** |
| `image.src: "url"` | `assets[gen] = {kind:'external', url}` + `assetId` | 없음 |
| `tracks[]` | `interpolate: "auto"` 부여(또는 생략) | 없음 |
| 그 외 전 필드 | 그대로 | 없음 |

**전 383개 문서가 무손실 변환 가능**해야 하며, 이를 회귀 테스트로 강제한다: `migrate(legacy)` → v1 파싱 성공 → 두 문서의 씬 그래프가 전 타임라인에서 동일 (단, group/image는 legacy가 미동작·미사용이므로 비교 대상에서 제외).

역방향(`v1 → legacy`)은 제공하지 않는다. 소비처를 v1으로 전환하는 것이 목표다.

## 5. 확정 사항 (2026-08-08)

| #   | 항목                 | 결정                                                 |
| --- | -------------------- | ---------------------------------------------------- |
| S1  | 판별 필드명          | **`clothoVersion: 1`**                               |
| S2  | `assets` 자료구조    | 객체 맵 (id 조회 O(1), 중복 불가)                    |
| S3  | 그룹 자식 좌표       | 부모 기준 상대 (중첩의 의미가 성립)                  |
| S4  | 그룹 entry/exit 상속 | 상속. 그룹이 하나의 단위로 등장/퇴장                 |
| S5  | `$schema` 호스팅 URL | 6.4에서 JSON Schema 배포 시 확정. 필드는 선택        |
| S6  | `settings` 위치      | 문서에 유지(작성자 의도). 플레이어 옵션이 오버라이드 |

추가로 v1에서 확정한 것:

- **`image.alt`** (선택) — legacy에는 a11y 대체 텍스트 수단이 전혀 없었다. 공개 패키지로서 이미지에 접근성 라벨 경로를 제공한다.
- **`assets.inline.data`는 순수 base64만 받는다.** `data:image/png;base64,…` 접두사를 붙인 문자열은 파싱 단계에서 거부하고 명확한 메시지를 준다(흔한 작성 실수). `mime`이 따로 있으므로 접두사는 중복 정보다.
- **`mime`은 `image/*`로 제한한다.** `image/svg+xml`도 허용하나, `<image href>`로 참조되는 SVG는 스크립트가 실행되지 않는 맥락임을 전제로 한다.
