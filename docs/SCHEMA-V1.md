# clotho 문서 포맷 v1

**상태: 확정 (2026-08-08).** 기존 legacy v3/v4를 대체하는 새 체계다. 근거는 [`RESEARCH.md`](./RESEARCH.md), 구조 결정은 [`ARCHITECTURE.md`](./ARCHITECTURE.md).

설계 태도: **이유 있는 것만 바꾼다.** legacy v4는 383개 실문서로 검증된 포맷이므로 잘 작동하는 부분(요소 타입, `appearances`/`tracks` 타임라인 모델, 이펙트 3종, ms 시간 단위)은 그대로 계승한다. 변경 사항은 아래 §2에 기록한다.

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
  "charts": [/* §2.15 */],
  "style": {/* §2.16 */},
  "camera": {/* §2.11 */},
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

### 2.9 연결형 주석

`text.content`, 번역 문구, chapter의 `label`과 `subtitle`에서는 `{token}`으로 장면의 요소를 가리킬 수 있다. 같은 객체의 `references`에서 token을 하나 이상의 element id와 연결한다. 일반 문구는 그대로 유지되므로 기존 문서와 호환된다.

```jsonc
{
  "type": "text",
  "id": "description",
  "x": 40,
  "y": 300,
  "content": "{queue}에서 {node}를 꺼냅니다.",
  "translations": { "en": "Remove {node} from the {queue}." },
  "references": {
    "queue": "queue-box",
    "node": ["node-a", "node-b"]
  }
}
```

player에서 연결된 문구를 가리키거나 keyboard focus하면 대상 요소가 강조되고, click하면 강조가 유지된다. `Escape`로 고정을 해제한다. 번역 문구는 기본 문구와 같은 token 집합을 사용해야 한다. 존재하지 않는 element id와 연결하면 validation 오류가 발생한다.

### 2.10 Interactive Checkpoint

`checkpoints`는 timeline의 특정 시각에서 재생을 멈추고 사용자의 응답을 받는다. `continue`, `choice`, `select-element`, `number-input` interaction을 지원한다. 응답과 판정 결과는 문서를 수정하지 않고 `createInteractionSession`이 관리한다.

```jsonc
"checkpoints": [{
  "id": "predict-next",
  "time": 1800,
  "prompt": "다음에 방문할 node를 고르세요.",
  "interaction": "choice",
  "options": [
    { "value": "b", "label": "B" },
    { "value": "c", "label": "C" }
  ],
  "predicate": { "type": "equals", "value": "b" }
}]
```

정답은 JSON에 넣을 수 있는 `equals`, `oneOf`, `range` predicate로 판정하거나 host의 `evaluate` callback으로 판정한다. `select-element.elementIds`는 선택 가능한 장면 요소를 제한한다. SVG와 GIF 같은 비대화형 출력에는 `initialAnswers`로 결정적인 session 상태를 제공할 수 있다.

### 2.11 카메라

`camera`는 시청자가 캔버스의 어느 부분을 보고 있는지를 시간축 데이터로 표현한다. 없으면 지금까지처럼 캔버스 전체가 보이고, `Scene.viewBox`는 `0 0 <width> <height>` 상수 그대로다.

```jsonc
"camera": {
  "tracks": [
    { "property": "zoom", "keyframes": [{ "time": 0, "value": 1 }, { "time": 1500, "value": 2.4, "ease": "easeInOut" }] },
    { "property": "x", "keyframes": [{ "time": 0, "value": 400 }, { "time": 1500, "value": 210 }] },
    { "property": "y", "keyframes": [{ "time": 0, "value": 230 }, { "time": 1500, "value": 180 }] }
  ],
  "focus": [
    { "time": 3000, "duration": 700, "elementIds": ["n-a", "n-b"], "padding": 40, "maxZoom": 4 }
  ],
  "strokeScaling": "scale"
}
```

- `x`·`y`는 캔버스 좌표계의 **주시점**, `zoom`은 배율이다. 보이는 사각형은 `width = canvas.width / zoom`, 좌상단은 `(x - width/2, y - height/2)`다. 트랙이 없는 축은 캔버스 중심과 배율 1을 쓴다.
- 키프레임·`ease`는 요소 트랙과 같은 규칙이며 값은 숫자만 받는다. 카메라 전용 타이밍 개념은 없다.
- `focus`는 대상 요소들의 루트 좌표 bounding box에 `padding`을 더해 그것을 채우는 `(x, y, zoom)`으로 푸는 단축 표기다. 프레임마다 다시 계산하므로 **움직이는 대상을 따라간다**. `duration` 동안 직전 카메라 상태에서 전이하고, 그 뒤 다음 `focus`가 시작할 때까지 유지한다. `maxZoom`은 작은 대상이 화면을 가득 채우는 것을 막는다.
- `focus` 대상이 그 시각에 무대에 없으면 카메라를 움직이지 않고 `camera-focus` diagnostic을 남긴다. 빈 캔버스를 비추는 것보다 낫고, 조용히 멈추는 것과 구별되어야 한다.
- `strokeScaling`은 확대 시 선 두께가 함께 굵어질지(`scale`, 기본값) 일정하게 유지될지(`fixed`) 정한다. `fixed`는 `vector-effect` 대신 scene의 `stroke-width` 숫자를 직접 나누므로 네 어댑터와 resvg 기반 GIF가 모두 같은 결과를 낸다.
- `prefers-reduced-motion`에서는 카메라 이동이 **컷으로 강등**된다. 화면 전체가 움직이는 연출은 멀미를 가장 잘 유발하므로 속도를 늦추는 것으로는 부족하다. 어댑터가 관측한 값을 `SceneOptions.reducedMotion`으로 넘기며, 명시적으로 지정하면 그것이 이긴다.

`camera`가 바꾸는 것은 `Scene.viewBox` 문자열 하나뿐이다. 그래서 react·vue·dom·svg 네 어댑터와 GIF 렌더러는 카메라 지원을 위해 한 줄도 바뀌지 않았다.

### 2.12 Spotlight 효과

`spotlight`는 대상을 바꾸지 않고 **나머지를 어둡게 해서** 시선을 모은다. `highlight`가 대상의 fill을 갈아끼우느라 요소의 원래 색을 잃는 반면, spotlight는 대상을 그대로 두고 무대에서 대비를 걷어낸다. 색 자체가 정보인 문서에서 강조와 정보가 충돌하지 않게 된다.

```jsonc
"effects": [{
  "type": "spotlight",
  "id": "sp-1",
  "elementIds": ["n-a", "e-ab"],
  "time": 2000,
  "duration": 1200,
  "dim": 0.72,
  "dimColor": "#1e1b4b",
  "lit": 0.18,
  "litColor": "#fde68a",
  "shape": "bbox",
  "padding": 12,
  "fadeIn": 200
}]
```

- **`elementIds`가 복수**인 유일한 효과다. 나머지 셋은 요소 하나를 꾸미지만 spotlight는 그 바깥을 꾸민다. 이 때문에 `elementId` 단수를 가정하던 코드는 `effectTargets(effect)`를 쓴다.
- `shape`: `bbox`(대상들의 합집합 사각형, 기본) · `circle`(그 외접원) · `elements`(대상의 실루엣 그대로). `elements`에서는 `padding`이 검은 stroke 두께로 변환되어 실루엣을 정확히 그만큼 부풀린다.
- `fadeIn`은 양 끝에 모두 적용된다. `pulse`의 `sin(πt)`와 같은 이유로 — 효과가 끝난 뒤 무대를 되돌리는 코드가 없으므로 스스로 잔여를 남기지 않아야 한다. 두 램프가 겹칠 만큼 `duration`이 짧으면 각각 절반으로 제한된다.
- 동시에 활성인 spotlight가 여럿이면 **하나의 scrim을 공유**한다. 각자 scrim을 깔면 겹치는 곳이 두 번 어두워지고, 더 나쁘게는 한쪽의 scrim이 다른 쪽의 대상을 덮는다. 구멍은 합집합, 불투명도는 최댓값이다.
- 대상이 그 시각에 하나도 무대에 없으면 그 프레임을 건너뛰고 `spotlight-target` diagnostic을 남긴다. 전부 어둡게 하는 것은 아무것도 하지 않는 것보다 말이 안 된다.
- **가려지는 쪽의 색은 `dimColor`**, **비추는 쪽의 색은 `litColor` + `lit`**이다. `dimColor`를 생략하면 테마 토큰을 쓴다. `lit`은 기본 0이라, 요청하지 않으면 spotlight는 대상에 아무것도 하지 않는다 — 대상이 자기 색을 지키는 것이 이 효과가 `highlight` 대신 존재하는 이유이기 때문이다. `lit`을 올리면 실제 조명의 젤처럼 비추는 영역 위에 색이 얹힌다.
- 여러 spotlight가 겹칠 때 **scrim 색은 가장 강한 것**이 정한다. 색이 다른 scrim 둘은 사각형 하나가 될 수 없고, 따로 깔면 겹치는 곳이 두 번 어두워지기 때문이다. 반면 **wash는 각자 하나씩** 나온다 — 젤이 둘이면 색도 둘이고, scrim과 달리 램프 둘이 겹치는 것은 보는 사람이 예상하는 결과다.
- `dim: 0`에 `lit`만 올린 문서도 정상이다. 그래서 램프 곡선은 scrim 불투명도가 아니라 `spotlightProgress`가 따로 계산한다 — scrim이 0이면 거기서 곡선을 얻을 수 없다.

`shape: "elements"`에서 대상의 실루엣은 **root 좌표계로 옮겨진 뒤** 마스크에 들어간다. 마스크의 자식은 대상이 속한 group이 아니라 마스크에 매달리므로, 그러지 않으면 `<g transform="translate(300 200)">` 안의 요소는 group의 원점에 구멍이 뚫린다 — 빈 캔버스가 밝아지고 정작 대상은 어두운 채로 남는다. 같은 이유로 전환 중인 요소는 `${id}-phase` 래퍼째 가져온다. 안쪽 노드만 쓰면 구멍이 *도착 예정 위치*에 뚫린다.

렌더는 마스크를 쓴다. scrim 사각형 하나에 `<mask>`를 물려 대상 영역을 검게 뚫으므로, 무대에 요소가 몇 개든 노드는 둘이다(`lit`을 쓰면 wash 하나당 둘씩 더). `SceneDef`에 `kind: 'mask'`가 추가되었고 어댑터 4종은 `def.kind`를 태그로 렌더한다. resvg(GIF 래스터라이저)가 중첩 transform 안에서도 마스크를 브라우저와 같게 처리하는 것을 픽셀 테스트로 고정했다.

scrim 색의 기본값은 `--cloth-scrim` 토큰이며 라이트·다크 모두 near-black이다. 어둡게 한다는 것은 두 테마 모두에서 어둡게 하는 것이고, 다크 테마에 밝은 scrim을 깔면 바닥이 올라가 버린다. `dimColor`로 지정한 값은 토큰을 거치지 않고 그대로 쓰인다 — 정적 출력에서도 같다.

wash는 scrim의 역마스크다. 덮개가 검고 대상이 흰 마스크를 물린 사각형이라 비추는 영역에만 색이 칠해진다.

### 2.13 Motion trail 효과

`trail`은 움직이는 요소가 지나온 경로를 남긴다. 움직임 자체가 정보인 문서 — 배열을 훑는 커서, 노드를 방문하는 탐색, 서로를 향해 좁혀오는 포인터 — 에서 정지 프레임은 그 정보를 전부 잃는다. GIF 썸네일과 문서 캡처가 특히 그렇다.

```jsonc
"effects": [{
  "type": "trail",
  "id": "tr-1",
  "elementId": "cursor",
  "time": 0,
  "duration": 6000,
  "window": 1200,
  "samples": 12,
  "mode": "auto",
  "fade": true,
  "color": "#94a3b8",
  "width": 2
}]
```

- **누적하지 않는다.** 시각 `t`에서 `[t-window, t]`를 `samples`개로 나눠 **각 시점의 위치를 문서로부터 다시 계산한다.** `(문서, t) → 화면`이 유지되므로 뒤로 감아도, 정지 프레임을 뽑아도, 900번째 프레임부터 렌더해도 같은 트레일이 나온다. 버퍼에 쌓는 구현이라면 seek할 때마다 어긋난다.
- `mode: "auto"`는 요소의 위치 트랙이 **이산 보간이면 `dots`**, 아니면 `path`를 고른다. 순간이동하는 요소의 샘플을 선으로 이으면 지나지 않은 경로를 그리게 된다.
- 창은 요소(와 조상 group)가 무대에 오른 시각까지만 거슬러 간다. 등장 이전으로 이어지는 꼬리는 없던 사실을 지어내는 것이고, 그렇다고 그 샘플들을 버리기만 하면 갓 등장한 요소는 창이 다 지나갈 때까지 꼬리가 없다 — 그래서 버리는 대신 남은 구간에 샘플을 다시 배분한다.
- **같은 자리에 겹치는 샘플은 하나로 합친다.** 샘플링 간격은 시간이지 거리가 아니라서, 요소가 천천히 움직이거나 멈춰 있으면 여러 샘플이 한 점에 쌓인다. 반투명한 조각이 겹치면 합성되어 진해지므로 — 0.08부터 1까지 흐려지는 점 11개가 한 자리에 쌓이면 꽉 찬 점 하나가 된다 — `fade`가 그려지긴 해도 보이지는 않고, 멈춘 커서 밑에는 창이 다 지나갈 때까지 진한 얼룩이 남는다. 그래서 `dots`는 요소의 현재 위치에서부터 거슬러 올라가며 **직전에 남긴 점에서 반지름만큼 벗어난 샘플만** 찍고, `path`는 **연속으로 같은 자리인 샘플을 접는다**(길이 0인 선분에 둥근 끝을 붙이면 그것도 점이다).
- 위 규칙의 결과로, **움직이지 않는 요소는 트레일을 남기지 않는다.** 멈춘 뒤에는 창이 지나가는 동안 꼬리가 흐려지며 사라진다. 불투명도는 살아남은 조각의 순번이 아니라 **원래 창에서의 시점**으로 계산하므로, 멈춘 요소의 꼬리가 다시 진해지지 않는다.
- 중심점이 없는 요소(group 등)를 대상으로 하면 `trail-target` diagnostic을 남긴다.
- 트레일은 대상 요소 **아래**에 그려진다. 위에 그리면 추적하려던 대상을 가린다.

비용은 과거 시점 재평가다. 전체 스냅샷을 `samples`번 계산하면 요소 40개 문서에서 프레임당 480회가 되므로, 요소와 그 조상 체인만 평가하는 `computeElementState` · `elementRootCenterAt`를 쓴다. `computeSnapshot`도 같은 요소 단위 평가를 호출하므로 둘이 어긋날 수 없다.

### 2.14 math 요소

`math`는 TeX 식을 담는다. 지금까지는 `text`에 유니코드로 우겨넣거나(분수·시그마·아래첨자를 못 쓴다) 수식 이미지를 붙였는데(테마를 못 따르고, 확대하면 깨지고, 식의 한 항을 `pulse`로 지목할 수 없다) 둘 다 잃는 것이 있었다.

```jsonc
{
  "type": "math", "id": "recur", "x": 120, "y": 80,
  "tex": "T(n) = 2T(n/2) + O(n)",
  "display": "block", "fontSize": 18, "color": "#0f172a",
  "textAnchor": "start",
  "alt": "T of n equals two T of n over two plus O of n"
}
```

**조판기는 번들에 들어가지 않는다.** KaTeX는 이 코어 전체보다 몇 배 크고, 검증기(zod)조차 렌더 어댑터에서 빼낸 패키지가 조판기를 안고 갈 수는 없다. 대신 host가 주입한다.

```ts
buildScene(doc, t, { mathRenderer: { name: 'katex', render: (tex, opts) => SceneNode } });
```

`highlighter`(코드 하이라이팅)와 정확히 같은 패턴이며, 반환하는 서브트리는 **요소의 자기 좌표계**(원점이 앵커)에 있으므로 조판기는 식이 캔버스 어디에 놓이는지 알 필요가 없다.

훅이 없거나 조판에 실패하면 `tex` 원문을 monospace로 그리고 `unresolved-math` diagnostic을 남긴다. 미해결 에셋을 자리표시자로 그리는 처리와 같은 태도다 — 조용히 사라지면 저작자는 요소가 어디 갔는지 알 수 없다. 진단 메시지는 "조판기가 없다"와 "조판기가 이 식을 처리하지 못했다"를 구분한다. 앞은 host 설정 문제고 뒤는 문서 문제다.

`tex`는 조판 후에도 문서에 남는다. 재편집할 수 있어야 하고, `alt`와 함께 읽어줄 수 있어야 한다. `alt`는 `aria-label`로 나간다.

레이아웃 컴파일러(§2.8)의 `math` 박스는 원문 기준 **추정치**다. 조판된 실제 크기는 조판기만 아는데 컴파일러에는 조판기가 없다.

### 2.15 chart

`charts`는 **저작 시간 스펙**이며 `compileCharts`가 평범한 v1 요소로 낮춘다. `layouts`와 같은 계층이고, 그래서 **런타임은 차트를 전혀 모른다** — 어댑터 4종·GIF·에디터의 요소 switch 어디에도 12번째 타입이 생기지 않고 렌더 경로의 번들 비용이 0이다.

```jsonc
"charts": [{
  "id": "bench", "x": 60, "y": 40, "width": 520, "height": 300,
  "kind": "bar",
  "data": [{ "name": "naive", "ms": 120 }, { "name": "memo", "ms": 45 }],
  "encode": { "x": "name", "y": "ms", "series": "impl" },
  "scale": { "y": { "type": "linear", "domain": [0, "auto"], "nice": true } },
  "axes": { "x": { "label": "구현" }, "y": { "label": "ms", "grid": true } },
  "reveal": { "mode": "grow", "start": 500, "duration": 2500, "stagger": 120 },
  "legend": true
}]
```

#### id 규약이 진짜 계약이다

차트는 새 렌더러가 아니라 **예측 가능한 id를 가진 프리미티브 생성기**다. 이것이 이 기능의 설계 전부다.

```
bench__plot                    프레임
bench__grid-y__line-0          격자
bench__axis-x                  축 선
bench__axis-x__tick-2__label   눈금 라벨
bench__series-quick            시리즈 (line의 경우 path 하나)
bench__series-quick__point-3   막대 하나
bench__legend__quick           범례 항목
```

그래서 차트를 위한 특별한 강조 문법이 필요 없다. 기존 문법이 그대로 통한다.

```json
{ "type": "pulse", "elementId": "bench__series-quick__point-3", "time": 4000 }
{ "type": "spotlight", "elementIds": ["bench__series-quick"], "time": 5000 }
{ "camera": { "focus": [{ "time": 6000, "elementIds": ["bench__axis-y"] }] } }
```

구분자가 `/`가 아니라 `__`인 이유는 단순하다 — id 정규식이 `^[a-z0-9][a-z0-9_-]*$`이고, 이 규칙은 383개 문서와 마이그레이션에 걸려 있어 차트 때문에 넓힐 것이 아니다. 시리즈 이름은 `slugify`를 거치며, `__`는 `_`로 접혀 생성된 이름이 경로 구분자를 위조할 수 없다.

#### reveal

`reveal`은 컴파일러가 만드는 **평범한 트랙과 등장 구간**의 단축 표기다. 컴파일 후 저작자가 그대로 덮어쓸 수 있다.

| mode | 생성물 |
| --- | --- |
| `none` | 없음. 처음부터 완성된 차트 |
| `grow` | 막대의 `height` 0→값과 `y`를 함께 움직인다(rect는 좌상단 기준이라 둘 다 필요하다) |
| `sweep` | 경로 길이만 한 `strokeDasharray` + `strokeDashoffset` 트랙 |
| `series` | 시리즈별 `appearances.start`를 `stagger`만큼 민다 |

`stagger`가 `grow`에서는 항목마다, `series`에서는 시리즈마다 적용된다.

#### 스케일

`linear`과 `band`만 있고 `d3-scale`을 쓰지 않는다. 필요한 것이 200줄 남짓의 산술(`nice`·`ticks`·선형 매핑)인데 그것 때문에 보간기·시간 스케일·색 공간을 함께 들여올 이유가 없다. 눈금 간격은 1/2/5×10ⁿ 계열에서 고르며, 경계는 산술 중앙값이 아니라 **기하 평균**(√50·√10·√2)이다 — 2와 5 중 고르는 것은 비율의 문제이기 때문이고, 그래야 `nice`한 도메인과 `ticks`가 서로 어긋나지 않는다.

막대 차트의 값 축은 **0에서 시작한다.** 막대 길이가 곧 인코딩이므로 잘린 축은 길이로 거짓말을 한다.

x축 눈금 라벨은 겹치면 **솎아낸다**(`label-crowding` finding과 함께). 겹친 축은 두 칸 걸러 하나만 이름을 붙인 축보다 읽기 어렵다.

#### 범위

설명용 차트이며 분석용 차트 도구가 아니다. `kind`는 `bar`와 `line` 둘뿐이고, 이 목록은 좁게 유지한다. 외부 차트 라이브러리를 런타임에 임베드하지 않는 이유는 기획서에 있다 — Canvas가 필요하거나 React 전용이고, 자체 애니메이션 상태를 가지므로 `(문서, t) → 화면`이 성립하지 않는다.

### 2.16 Render style

`style`은 **무엇을 그리는지가 아니라 어떻게 그리는지**를 정한다. 같은 문서가 블로그·강의 슬라이드·논문 도판으로 각각 어울리게 나와야 하는데, 그러자고 문서를 복제해 색을 고치는 것은 답이 아니다.

```jsonc
"style": { "preset": "sketch", "seed": "bellman-ford", "roughness": 1.2 }
```

| preset | 내용 |
| --- | --- |
| `clean` | 지금까지의 렌더. 기본값이며 **출력이 바이트 단위로 동일하다** |
| `sketch` | 결정적 지터. `rect`·`circle`·`polygon`은 흔들린 `path`가 되고 `line`은 끝점만 움직인다 |
| `mono` | luma 기준 그레이스케일. 인쇄·논문용 |

#### 구현 위치가 설계다

`buildScene` 이후, 어댑터 이전의 **순수 Scene → Scene 변환**이다. 이 자리라서 가능한 것이 셋이다.

- 요소 빌더 11종을 건드리지 않는다. 프리셋은 원이 무엇인지에 대한 규칙이 아니라 그리는 방식에 대한 규칙이다.
- 어댑터 4종과 GIF가 전부 공짜로 따라온다.
- **노드의 종류를 바꿔도 안전하다.** `key`만 보존하면 DOM 패처와 React 재조정이 그대로 동작하고, 그 아래로는 아무도 rect였는지 신경 쓰지 않는다.

#### 결정성 — 시각을 시드에 넣지 않는다

지터는 난수처럼 보이되 난수여서는 안 된다. GIF를 두 번 구우면 같은 파일이어야 하고, seek해서 온 프레임이 재생해서 온 프레임과 같아야 한다. 시드는 `hash(style.seed ?? doc.id, node.key, node.kind)`이고 PRNG는 mulberry32다.

**시각 `t`는 시드에 들어가지 않는다.** 넣으면 스케치가 살아 있어 보이게 만드는 가장 쉬운 방법이자 화면을 끓게 만드는 가장 확실한 방법이 된다 — 매 프레임 선이 다시 섞여 그림 전체가 어른거린다. 무대를 가로질러 움직이는 요소는 자기 지터를 그대로 갖고 다닌다.

#### 손대지 않는 것

- `text`와 `image`: 글자를 흔들면 편안해지는 게 아니라 안 읽힌다.
- `path`: 임의의 path data를 다시 그리려면 완전한 파서가 필요하다.
- 스포트라이트 scrim과 마스크: 가장자리가 흔들리면 무대 둘레에 밝은 틈이 생긴다.
- `mono`에서 `var(--cloth-*)` 토큰: 값을 정하는 것은 페이지이고, 이미 중요한 의미에서 단색이다.
- `mono`는 화살촉(marker)까지 회색조로 바꾸고 **그 marker에 새 id를 준다.** marker id는 문서 전역이고 색이 id에 박혀 있어서 지금까지는 같은 id면 내용도 같았는데, 프리셋이 그 전제를 깬다 — 회색 marker와 컬러 marker가 같은 id를 주장하면 `url(#…)`은 페이지에 먼저 로드된 쪽으로 해석된다. 한 페이지에 스타일이 다른 플레이어를 나란히 두면 둘 다 먼저 그려진 화살촉을 쓰게 된다.
- 노드 수가 임계값(400)을 넘으면 `sketch`는 `clean`으로 강등된다. 그만큼 빽빽한 그림에서 손그림 선은 멋이 아니라 잡음이고, path 데이터도 두 배로 늘어난다.

### 2.17 source-linked code

`code.source`는 `content`가 **어디서 왔는지**를 기록한다. 실제 소스에서 복사해 넣는 순간 사본이 둘이 되고 거기서부터 갈라지는데, 함수 이름이 바뀌고 줄이 밀려도 애니메이션은 옛 코드를 계속 보여주며 그 사실을 알려주는 장치가 없었다.

```jsonc
{
  "type": "code", "id": "snap", "x": 40, "y": 60, "width": 480, "height": 220,
  "language": "typescript",
  "content": "export function computeSnapshot(doc, time) {\n  …\n}",
  "source": {
    "file": "src/core/runtime/snapshot.ts",
    "region": "compute",
    "hash": "sha256:9f2c…"
  }
}
```

- **`content`는 항상 인라인으로 남고 런타임은 파일을 읽지 않는다.** 브라우저가 `src/core/...`를 읽을 수 없고, 파일시스템에 의존하는 문서는 SVG로 내보내거나 GIF로 굽거나 임베드할 수 없다. `source`는 출처 메타데이터이지 렌더 입력이 아니다.
- 범위 지정은 둘 중 하나다. `region: "compute"`는 소스의 `// #region compute` … `// #endregion`을 찾으므로 **위에 줄이 추가돼도 살아남는다.** `lines: [40, 58]`은 간단하지만 줄이 밀리는 순간 조용히 틀린 곳을 가리킨다 — region이 권장 기본값인 이유다.
- region 마커의 주석 기호는 `//` · `#` · `--` · `/*` · `<!--` · `;`를 모두 받는다. 어느 주석 문법을 쓰는지는 문서가 선언할 일이 아니다.
- 추출한 텍스트는 **공통 들여쓰기를 걷어낸다.** 함수 안의 region은 주변 때문에 들여쓰기가 있고, 그대로 두면 코드 요소 폭의 3분의 1이 공백에 낭비된다.
- 이름이 같은 region이 둘이면 앞의 것을 조용히 고르지 않고 **거부한다.** 모호한 선택을 말없이 하는 것이 이 기능이 막으려는 실패 그 자체다.

```bash
clotho sync animations/            # content와 hash를 갱신
clotho sync animations/ --check    # 쓰지 않고, 낡았으면 종료 코드 1
clotho validate animations/        # 낡은 문서를 stale-code 경고로 보고
```

`hash`는 줄바꿈 방식을 정규화한 뒤 계산하므로 Windows에서 sync한 문서가 Linux에서 낡은 것으로 보이지 않는다. 신선도 검사는 `validateDocument`가 아니라 node 계층에 있다 — core는 파일을 읽지 않으며, 문서는 최신이 아니어도 **유효하다.** 둘을 구분할 수 있는 것은 파일시스템을 가진 호출자뿐이다.

CI에 `clotho validate --strict`가 있다면 **코드를 바꾸고 애니메이션을 안 고친 PR이 자동으로 실패한다.**

### 2.18 발표자 노트

챕터가 있는 문서는 이미 슬라이드의 구조를 갖고 있다 — 순서가 있고, 각 단계에 제목과 부제가 있고, 넘어가는 지점이 정해져 있다. 부족한 것은 **말하는 속도로 넘기는 방법**뿐이었고, 그래서 발표에 쓰려면 슬라이드를 다시 만들어야 했다.

```jsonc
"chapters": [{
  "id": "c2", "time": 2000,
  "label": "Round 1",
  "subtitle": "간선 완화",
  "notes": "여기서 왜 |V|-1번인지 질문을 던진다"
}]
```

추가된 필드는 `notes` 하나뿐이다. `subtitle`은 **청중이 읽는 자막**이라 발표자 메모로 겸용할 수 없다 — 공유 화면에 나오는 필드가 "내가 무슨 말을 하려 했더라"를 적어두는 자리가 될 수는 없다.

`mountPresenter`는 챕터를 **구간**으로 다룬다. 다음을 누르면 다음 챕터 시각으로 점프하는 것이 아니라 **그 구간을 재생하고 멈춘다** — 애니메이션이 설명의 일부이므로 건너뛰면 청중은 과정 없는 결과만 보게 된다.

## 3. 계승하는 부분 (변경 없음)

- **요소**: `rect · circle · line · arrow · text · image · path · polygon · group · code` (v1에서 `math` 추가 — §2.14)
- **`appearances[]`**: `{ start, end, entryMode?, entryDuration, exitMode?, exitDuration }` entry/exit 8종 `instant · fade · slide-{left,right,up,down} · zoom · pop`
- **`tracks[]`**: `{ property, keyframes: [{ time, value, ease? }] }`, ease 4종
- **이펙트**: `highlight · pulse · flow` (v1에서 `spotlight` §2.12, `trail` §2.13 추가)
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
