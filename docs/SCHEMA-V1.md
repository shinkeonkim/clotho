# clotho 문서 포맷 v1 (초안)

**상태: 초안 — 구현 착수 전 확정 필요.** 기존 legacy v3/v4를 대체하는 새 체계다.
근거는 [`RESEARCH.md`](./RESEARCH.md), 구조 결정은 [`ARCHITECTURE.md`](./ARCHITECTURE.md).

설계 태도: **이유 있는 것만 바꾼다.** legacy v4는 383개 실문서로 검증된 포맷이므로
잘 작동하는 부분(요소 10종, `appearances`/`tracks` 타임라인 모델, 이펙트 3종, ms 시간 단위)은
그대로 계승한다. 아래 §2의 6가지만 변경한다.

---

## 1. 문서 골격

```jsonc
{
  "clotho": 1,                       // 포맷 버전. 이 필드의 존재가 clotho 문서임을 뜻한다
  "$schema": "…/clotho-1.json",      // 선택. 에디터 자동완성용
  "id": "bellman-ford",              // ^[a-z0-9][a-z0-9_-]*$
  "title": "벨만-포드",
  "description": "…",
  "category": "algorithm",           // 자유 문자열 (legacy: 고정 enum 7종)
  "tags": ["graph", "shortest-path"],
  "duration": 12000,                 // ms
  "canvas": { "width": 800, "height": 460, "background": "transparent" },
  "assets":   { /* §2.3 */ },
  "elements": [ /* §2.1, §2.2 */ ],
  "chapters": [ { "id": "c1", "time": 2000, "label": "Round 1", "subtitle": "" } ],
  "effects":  [ { "type": "pulse", "id": "p1", "elementId": "n-a", "time": 2000 } ],
  "settings": { "loop": true, "autoplay": true, "showCaption": false, "showChapterList": false },
  "updatedAt": "2026-08-08T00:00:00Z"
}
```

**버전 판별**: `clotho` 필드가 있으면 v1. 없고 `version: 3|4`면 legacy이며 런타임이 직접
받지 않고 `migrate()`를 통과해야 한다. `1 < 4`이라 `version` 숫자를 재사용하면 다운그레이드로
오독되므로 필드 이름 자체를 바꿨다.

## 2. legacy 대비 변경점

### 2.1 그룹: `childIds` → `parentId` (실제 중첩)

legacy `group`은 **스키마에만 있고 렌더러 구현이 없었다**(`RenderElement`에 분기 없음 → `null`).
게다가 `childIds` 참조 목록 구조로는 SVG `<g>` 중첩이 만들어지지 않아 부모 transform이
자식에 전파되지 않는다. 즉 legacy의 그룹은 동작한 적이 없다.

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
- 그룹의 `appearances`/`tracks`/entry·exit는 **서브트리 전체에 적용**된다. 그룹이 숨으면
  자식도 숨는다.
- `group`도 `tracks`를 가질 수 있어 그룹 단위 이동/회전 애니메이션이 된다.

평면 구조를 택한 이유: 중첩 배열보다 에디터가 다루기 쉽다(안정적인 평면 목록, 재부모화가
필드 하나 수정, id 조회가 O(1)). 트리는 렌더 시점에 만든다.

**검증 필수**: `parentId` 순환 참조, 존재하지 않는 부모, `group`이 아닌 요소를 부모로 지정.

### 2.2 트랙 보간: 하드코딩 키 집합 → 명시 가능

legacy는 `keys.ts`에 속성명 문자열 집합(`NUMERIC_KEYS`, `COLOR_KEYS`, `TEXT_KEYS`)을 박아
보간 방식을 정했다. 집합에 없는 속성은 조용히 스텝 보간으로 떨어지고, 사용자 정의 속성은
불가능하다.

```jsonc
{ "property": "fill", "interpolate": "color",
  "keyframes": [{ "time": 0, "value": "#e0e7ff" }, { "time": 2000, "value": "#dcfce7" }] }
```

`interpolate`: `"auto" | "number" | "color" | "discrete"` (기본 `"auto"`).
`auto`는 기존 속성명 휴리스틱을 그대로 적용하므로 마이그레이션이 무손실이다.

### 2.3 이미지: `src` 문자열 → 에셋 레지스트리 + 호스트 훅

legacy `image.src`는 URL 문자열이라 문서가 특정 호스트 경로에 묶였다. (실데이터 383개에
`image` 사용이 0건인 것도 이 때문으로 보인다.)

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

legacy enum은 `network|cache|algorithm|architecture|flow|protocol|general` 7종으로,
특정 블로그의 분류다. 오픈소스 패키지가 사용자의 분류 체계를 정할 이유가 없다.
자유 문자열(기본 `"general"`)로 두고 분류는 `tags`와 소비처에 맡긴다.

### 2.5 `version: 3 | 4` 제거

두 값의 스키마 차이가 **전혀 없었다**(리터럴만 다름). 구조 차이 없는 버전 분기는
검증만 복잡하게 만든다. `clotho: 1`로 대체한다.

### 2.6 코드 요소: 하이라이터 주입

legacy `code`는 `language` 필드를 받지만 렌더러는 JS 키워드 집합을 하드코딩한 토크나이저
하나뿐이었다. 문서 포맷은 그대로 두고 **렌더 옵션으로 하이라이터를 주입**받는다
(기본값은 기존 JS 토크나이저). 문서 스키마 변경은 없다.

## 3. 계승하는 부분 (변경 없음)

- **요소 10종**: `rect · circle · line · arrow · text · image · path · polygon · group · code`
- **`appearances[]`**: `{ start, end, entryMode?, entryDuration, exitMode?, exitDuration }`
  entry/exit 8종 `instant · fade · slide-{left,right,up,down} · zoom · pop`
- **`tracks[]`**: `{ property, keyframes: [{ time, value, ease? }] }`, ease 4종
- **이펙트 3종**: `highlight · pulse · flow`
- **`chapters[]`**, **`settings`**, ms 시간 단위, 앵커 연결(`fromId`/`toId`/`fromAnchor`/`toAnchor`)
- 시각 상태는 오직 `(문서, t)`의 순수 함수

## 4. 마이그레이션 (legacy v3/v4 → v1)

| legacy | v1 | 손실 |
| --- | --- | --- |
| `version: 3 \| 4` | `clotho: 1` | 없음 |
| `category` enum 값 | 동일 문자열 | 없음 |
| `group.childIds: ["a","b"]` | 각 자식에 `parentId` 부여 | 없음. **legacy에서 미동작이었으므로 시각 회귀도 없음** |
| `image.src: "url"` | `assets[gen] = {kind:'external', url}` + `assetId` | 없음 |
| `tracks[]` | `interpolate: "auto"` 부여(또는 생략) | 없음 |
| 그 외 전 필드 | 그대로 | 없음 |

**전 383개 문서가 무손실 변환 가능**해야 하며, 이를 회귀 테스트로 강제한다:
`migrate(legacy)` → v1 파싱 성공 → 두 문서의 씬 그래프가 전 타임라인에서 동일
(단, group/image는 legacy가 미동작·미사용이므로 비교 대상에서 제외).

역방향(`v1 → legacy`)은 제공하지 않는다. 소비처를 v1으로 전환하는 것이 목표다.

## 5. 확정 필요 항목

| # | 항목 | 제안 |
| --- | --- | --- |
| S1 | 판별 필드명 `clotho` vs `clothoVersion` vs `formatVersion` | `clotho` (간결, 충돌 없음) |
| S2 | `assets`를 객체 맵 vs 배열 | 객체 맵 (id 조회 O(1), 중복 불가) |
| S3 | 그룹 좌표를 상대 vs 절대 | 상대 (중첩의 의미가 성립) |
| S4 | 그룹 entry/exit를 자식에 상속시킬지 | 상속 (그룹이 하나의 단위로 등장/퇴장) |
| S5 | `$schema` 호스팅 URL | 4.4에서 JSON Schema 배포 시 확정 |
| S6 | `settings`에 재생 UI 관련 값을 계속 둘지 | 문서에 유지 (작성자 의도), 플레이어 옵션이 오버라이드 |
