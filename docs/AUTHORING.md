# 애니메이션 저작 문서

clotho 문서를 직접 쓰는 사람을 위한 공식 문서. 스키마의 필드별 정의는 [`SCHEMA-V1.md`](./SCHEMA-V1.md)에 있고, 여기서는 **어떻게 구성하는가**를 다룬다.

읽으면서 [`examples/gallery`](../examples/README.md)를 함께 열어두면 좋다. 이 문서의 모든 절에 대응하는 실행 가능한 문서가 갤러리에 있다.

```
bun run gallery
```

---

## 1. 시간 모델

**애니메이션은 시간의 함수다.** 상태를 누적하지 않는다.

```
frame(t) = f(document, t)
```

`t = 3200`에서의 화면은 0부터 3200까지 재생해야 나오는 것이 아니라, 그 자리에서 바로 계산된다. 이 성질이 저작에 주는 함의가 세 가지 있다.

- **어느 시각으로든 즉시 이동할 수 있다.** 타임라인 스크럽이 특별한 기능이 아니라 그냥 `seek(t)`다.
- **재생 순서에 의존하는 표현은 쓸 수 없다.** "이전 프레임보다 10px 오른쪽" 같은 것은 표현 자체가 불가능하다. 항상 절대 시각과 절대 값으로 쓴다.
- **서버에서 렌더할 수 있다.** 썸네일은 `renderDocumentToSvg(doc, t)` 한 줄이다.

시간 단위는 **밀리초 정수**다. 문서 전체 길이는 `duration`이고, 그 밖의 시각은 전부 0 이상 정수다.

```json
{ "clothoVersion": 1, "id": "demo", "duration": 4000 }
```

`duration`을 넘는 시각에 놓인 키프레임은 오류가 아니라 **도달하지 않는 값**이다. `bunx clotho validate`가 경고한다.

---

## 2. 문서의 뼈대

```json
{
  "clothoVersion": 1,
  "id": "tcp-handshake",
  "title": "TCP 3-way handshake",
  "description": "클라이언트와 서버가 연결을 맺는 과정",
  "category": "protocol",
  "tags": ["tcp", "network"],
  "duration": 6000,
  "canvas": { "width": 640, "height": 260, "background": "transparent" },
  "assets": {},
  "elements": [],
  "chapters": [],
  "effects": [],
  "settings": {
    "loop": true,
    "autoplay": true,
    "showCaption": true,
    "showChapterList": false,
    "chapterListPosition": "right"
  }
}
```

| 필드            | 뜻                                                                  |
| --------------- | ------------------------------------------------------------------- |
| `clothoVersion` | 항상 `1`. 이게 없으면 clotho 문서가 아니다.                         |
| `id`            | `^[a-z0-9][a-z0-9_-]*$`. 파일명과 맞추는 것을 권한다.               |
| `canvas`        | 좌표계의 크기. 픽셀이 아니라 **뷰박스**이므로 화면 크기와 무관하다. |
| `settings`      | 저자의 의도. 호스트가 재생 옵션으로 덮어쓸 수 있다.                 |

`category`는 자유 문자열이다. legacy는 7개 열거값으로 고정돼 있었지만, 범용 패키지가 사용자의 분류 체계를 정할 이유가 없어서 v1에서 풀었다.

### 좌표계

원점은 좌상단, y는 아래로 증가한다(SVG 관례). `canvas.width`/`height`는 뷰박스이므로 `640×260`으로 쓴 문서가 1280px 폭에서도 비율을 지키며 커진다. **큰 화면을 위해 좌표를 크게 잡을 필요가 없다.**

---

## 3. 요소

요소는 `elements` 배열에 **평평하게** 들어간다. 중첩은 배열 구조가 아니라 `parentId`로 표현한다(§8).

열 가지 타입이 있다.

| 타입      | 쓰는 곳                      | 필수 필드                          |
| --------- | ---------------------------- | ---------------------------------- |
| `rect`    | 박스, 노드, 배열 칸          | `x` `y` `width` `height`           |
| `circle`  | 노드, 상태, 점               | `cx` `cy` `r`                      |
| `line`    | 연결선                       | 양 끝 (§7)                         |
| `arrow`   | 방향 있는 연결, 메시지       | 양 끝 (§7)                         |
| `text`    | 라벨, 수식, 설명             | `x` `y` `content`                  |
| `image`   | 아이콘, 다이어그램, 스크린샷 | `x` `y` `width` `height` `assetId` |
| `path`    | 곡선, 임의 도형              | `d`                                |
| `polygon` | 삼각형, 다각형               | `points`                           |
| `group`   | 함께 움직이는 묶음           | —                                  |
| `code`    | 코드 블록                    | `x` `y` `width` `height` `content` |

모든 요소가 공통으로 갖는 것:

```json
{
  "id": "node-a",
  "name": "왼쪽 서버",
  "parentId": "cluster",
  "rotation": 0,
  "appearances": [{ "start": 0, "end": 4000 }],
  "tracks": []
}
```

`name`은 사람이 읽는 별칭이고 렌더에 영향이 없다. 요소가 30개를 넘어가면 `id`만으로는 편집이 어려워진다.

### `rect`가 라벨을 갖는다

박스 안의 글자를 위해 `text`를 따로 만들 필요가 없다. `rect`와 `circle`은 `label`을 직접 갖고, 중앙에 정렬된다.

```json
{
  "type": "rect",
  "id": "srv",
  "x": 40,
  "y": 90,
  "width": 130,
  "height": 70,
  "label": "Server",
  "labelSize": 16,
  "subtitle": ":443"
}
```

박스를 움직이면 라벨이 따라온다. 별도 `text` 요소로 만들면 두 개를 각각 움직여야 한다.

---

## 4. 출현 — 언제 무대에 있는가

`appearances`는 요소가 **화면에 존재하는 구간의 목록**이다. 비어 있으면 한 번도 보이지 않는다.

```json
"appearances": [
  { "start": 1200, "end": 4000, "entryMode": "fade", "entryDuration": 300 }
]
```

| 필드            | 뜻                                      |
| --------------- | --------------------------------------- |
| `start` / `end` | 구간. `end`는 `duration`과 같아도 된다. |
| `entryMode`     | 등장 방식. 기본 `instant`.              |
| `entryDuration` | 등장에 걸리는 시간(ms). 기본 300.       |
| `exitMode`      | 퇴장 방식.                              |
| `exitDuration`  | 퇴장에 걸리는 시간(ms).                 |

### 전이 모드 8종

`instant` `fade` `slide-left` `slide-right` `slide-up` `slide-down` `zoom` `pop`

`slide-*`의 방향은 **요소가 오는 방향**이다. `slide-up`은 아래에서 위로 올라온다.

전이는 `start`부터 `start + entryDuration` 사이에 일어난다. **`start` 이전에 미리 나와 있지 않다.** 등장 시간을 벌고 싶으면 `start`를 앞당긴다.

### 반복 출현

한 요소가 여러 번 나타났다 사라질 수 있다. 깜빡이는 커서, 주기적으로 도착하는 패킷처럼 **매번 같은 모양**인 것에 알맞다.

```json
"appearances": [
  { "start": 0,    "end": 200,  "entryMode": "pop", "exitMode": "fade" },
  { "start": 420,  "end": 620,  "entryMode": "pop", "exitMode": "fade" },
  { "start": 840,  "end": 1040, "entryMode": "pop", "exitMode": "fade" }
]
```

구간이 겹치면 **배열에서 먼저 나온 구간**이 이긴다(시각 순이 아니라 기술 순이다). 겹치도록 쓰지 않는 편이 좋다.

> **`entryDuration`만 쓰면 아무 일도 안 일어난다.** 전이는 `entryMode`가 있고 `instant`가 아닐 때만 발생한다. `entryMode` 없이 `entryDuration: 300`을 준 요소는 300ms를 기다리는 게 아니라 그냥 즉시 나타난다.

---

## 5. 트랙 — 시간에 따라 변하는 속성

`tracks`는 요소의 속성 하나를 시간축에 올린다.

```json
"tracks": [
  {
    "property": "x",
    "keyframes": [
      { "time": 0,    "value": 40 },
      { "time": 2000, "value": 400, "ease": "easeInOut" }
    ]
  }
]
```

읽는 법:

- `property`는 그 요소가 가진 필드 이름이다. `rect`면 `x`, `width`, `fill` 등.
- 첫 키프레임 **이전**에는 첫 값으로 고정된다.
- 마지막 키프레임 **이후**에는 마지막 값으로 고정된다.
- 트랙이 없는 속성은 요소에 쓴 값(base 값)이 그대로 쓰인다.

### `ease`는 "들어가는" 키프레임에 붙는다

이게 가장 자주 틀리는 지점이다. `ease`는 **직전 키프레임에서 이 키프레임으로 오는 구간**의 곡선이다. 첫 키프레임에 붙인 `ease`는 아무 효과가 없다.

```json
{ "time": 0,    "value": 40 },
{ "time": 2000, "value": 400, "ease": "easeOut" }
```

곡선은 `linear` `easeIn` `easeOut` `easeInOut` 넷이고 기본값은 `easeInOut`이다.

- **`linear`** — 등속. 스캔선, 진행 표시줄, 회전처럼 **일정해야 하는 것**.
- **`easeOut`** — 빠르게 출발해 부드럽게 멈춤. 등장·도착에 가장 자연스럽다.
- **`easeIn`** — 천천히 출발해 가속. 퇴장·낙하.
- **`easeInOut`** — 양쪽 다 부드럽게. 이동의 기본값.

`easing` 갤러리 문서가 넷을 나란히 달리게 해 둔 것이 이 차이를 보는 가장 빠른 방법이다.

### `interpolate` — 값을 어떻게 섞는가

```json
{ "property": "content", "interpolate": "discrete", "keyframes": [...] }
```

| 값         | 동작                                                |
| ---------- | --------------------------------------------------- |
| `auto`     | 속성 이름으로 판단한다. 기본값.                     |
| `number`   | 숫자로 보간.                                        |
| `color`    | 색으로 보간 (`#rgb` `#rrggbb` `rgb()` 지원).        |
| `discrete` | 보간하지 않고 다음 키프레임 시각까지 값을 유지한다. |

`auto`는 legacy 엔진의 동작을 그대로 재현한다 — 속성 이름이 내장 목록에 있으면 숫자나 색으로 보간하고, 없으면 계단식으로 넘어간다. **기존 문서가 그대로 동작하는 이유가 이것** 이지만, 목록에 없는 이름을 쓰면 의도와 다르게 계단이 된다. 그럴 때 명시한다.

`discrete`가 옳은 대표적인 경우는 **글자**다. `"one"`과 `"two"`의 중간값은 존재하지 않는다.

```json
{
  "property": "content",
  "interpolate": "discrete",
  "keyframes": [
    { "time": 0, "value": "i = 0" },
    { "time": 420, "value": "i = 1" },
    { "time": 840, "value": "i = 2" }
  ]
}
```

---

## 6. 반복 — 루프 구문 없이 루프 쓰기

**이 형식에는 `repeat`이 없다.** 반복은 펼쳐서 쓴다. 알고리즘 시각화가 대부분 반복이므로 실제로 가장 자주 쓰는 패턴이고, 방법이 다섯 가지다. 전부 `iteration` 갤러리 문서에 한꺼번에 들어 있다.

### (a) 커서를 한 칸씩 옮긴다

한 요소의 위치를 **반복 횟수만큼의 키프레임 쌍**으로 계단처럼 만든다. 쌍으로 쓰는 게 핵심이다 — "도착"과 "머무름"이 있어야 연속 이동이 아니라 개별 방문으로 읽힌다.

```json
{
  "property": "x",
  "keyframes": [
    { "time": 0, "value": 26, "ease": "easeOut" },
    { "time": 300, "value": 26 },
    { "time": 420, "value": 96, "ease": "easeOut" },
    { "time": 720, "value": 96 }
  ]
}
```

### (b) 루프 몸통을 펼친다

각 반복 대상이 **자기 요소**를 갖고, 자기 차례에 색이 바뀐다. `i`번째 요소의 키프레임 시각은 `i * STEP`이다. 손으로 쓰면 지치므로 생성해서 쓰는 편이 낫다 — 갤러리 문서가 TypeScript로 쓰여 있는 이유다.

### (c) 카운터를 `discrete`로 돌린다

§5의 `i = 0 / 1 / 2`가 그것이다.

### (d) 출현을 반복한다

§4의 반복 출현. **매 회차가 동일할 때** 가장 싸다.

### (e) 효과를 일정 간격으로 쏜다

요소는 가만히 두고 강조만 옮긴다.

```json
"effects": [
  { "type": "pulse", "id": "p0", "elementId": "cell-0", "time": 60,  "duration": 260 },
  { "type": "pulse", "id": "p1", "elementId": "cell-1", "time": 480, "duration": 260 }
]
```

### 어느 것을 고르나

| 상황                               | 방법 |
| ---------------------------------- | ---- |
| 회차마다 대상이 다르다 (배열 순회) | (b)  |
| 하나가 여러 위치를 방문한다        | (a)  |
| 숫자·상태 표시                     | (c)  |
| 같은 것이 주기적으로 나타난다      | (d)  |
| 모양은 그대로고 주목만 옮긴다      | (e)  |

`settings.loop`은 전혀 다른 것이다. **문서 전체를 처음부터 다시** 재생할 뿐, 문서 안의 반복과는 무관하다.

---

## 7. 연결선 — 좌표 대신 앵커

`line`과 `arrow`는 양 끝을 두 가지 방법으로 정할 수 있다.

**직접 좌표:**

```json
{ "type": "arrow", "id": "a1", "x1": 100, "y1": 50, "x2": 300, "y2": 50 }
```

**요소에 붙이기 (권장):**

```json
{
  "type": "arrow",
  "id": "a1",
  "fromId": "client",
  "toId": "server",
  "fromAnchor": "right",
  "toAnchor": "left"
}
```

붙여 두면 **양쪽 요소가 움직여도 선이 따라온다.** 좌표로 쓰면 요소를 옮길 때마다 선도 같이 고쳐야 하고, 실제로 이것이 문서가 깨지는 가장 흔한 원인이다.

앵커는 10종: `auto` `top` `right` `bottom` `left` `center` `top-left` `top-right` `bottom-left` `bottom-right`.

`auto`는 **상대편을 향한 면**을 고른다. 요소가 움직이면 붙는 면도 바뀐다. 대부분의 경우 `auto`가 옳고, 특정 면에 고정하고 싶을 때만 명시한다.

### 곡률과 화살촉

```json
{ "curvature": -30, "headEnd": "arrow", "headStart": "circle-open" }
```

`curvature`는 이차 베지어의 휨 정도다. 부호가 방향이므로, 왕복하는 두 화살표를 `-30`과 `+30`으로 주면 서로 겹치지 않는다. TCP 핸드셰이크 예제가 그 형태다.

화살촉 9종: `none` `arrow` `triangle` `triangle-open` `circle` `circle-open` `diamond` `diamond-open` `bar`.

색은 선의 `stroke`를 따라간다.

---

## 8. 그룹 — 함께 움직이는 것

`parentId`로 부모를 가리킨다. 배열은 평평한 채로 둔다.

```json
{ "type": "group", "id": "cluster", "x": 60, "y": 80, "appearances": [...] },
{ "type": "rect",  "id": "n1", "parentId": "cluster", "x": 0,  "y": 0, ... },
{ "type": "rect",  "id": "n2", "parentId": "cluster", "x": 70, "y": 0, ... }
```

핵심 두 가지:

1. **자식 좌표는 그룹 원점 기준의 상대 좌표다.** 위의 `n1`은 절대 좌표 `(60, 80)`에 있다.
2. **변환은 트리를 타고 내려가며 합성된다.** 그룹을 움직이거나 회전시키면 자손 전체가 따라간다. 그룹 안에 그룹을 넣으면 두 변환이 곱해진다.

그룹 자체도 `appearances`와 `tracks`를 가진다. 그룹을 숨기면 자손이 전부 사라지고, 그룹의 `x`에 트랙을 걸면 묶음 전체가 이동한다.

앵커는 좌표계를 넘어서도 동작한다. 그룹 안의 요소에서 바깥의 요소로 화살표를 걸면 양쪽의 누적 변환을 각각 풀어서 이어 준다.

> legacy에는 `group`이 스키마에만 있고 렌더된 적이 없다. **v1에서 처음 실제로 동작한다.**

---

## 9. 이미지 — 자산 레지스트리

이미지는 URL을 요소에 직접 쓰지 않는다. 문서 수준 `assets`에 등록하고 `assetId`로 가리킨다.

```json
"assets": {
  "diagram": { "kind": "inline", "mime": "image/png", "data": "iVBORw0KGgo..." },
  "cdn-logo": { "kind": "external", "url": "https://example.com/logo.svg" },
  "avatar":   { "kind": "ref", "key": "user/avatar" }
}
```

| 종류       | 언제                                                                 |
| ---------- | -------------------------------------------------------------------- |
| `inline`   | 문서 하나로 완결돼야 할 때. base64 원문(`data:` 접두사 없이).        |
| `external` | 안정적인 공개 URL이 있을 때.                                         |
| `ref`      | 호스트가 결정할 때. 호스트가 `AssetResolver`로 `key`를 URL로 바꾼다. |

```json
{
  "type": "image",
  "id": "fig",
  "x": 40,
  "y": 40,
  "width": 200,
  "height": 120,
  "assetId": "diagram",
  "alt": "요청 흐름도"
}
```

`alt`를 쓴다. legacy에는 이미지 대체 텍스트 경로가 아예 없었다.

`ref`가 아직 풀리지 않았거나 풀 수 없을 때는 **자리표시자가 그려진다.** 요소의 박스가 사라지지 않으므로 레이아웃이 흔들리지 않는다. 이 상태도 갤러리에서 볼 수 있다.

**inline은 문서 크기에 그대로 얹힌다.** base64는 원본의 약 1.33배다. 200KB짜리 PNG를 넣으면 문서가 266KB 커지고, 그 문서는 페이지마다 내려받아진다. 크면 `external`이나 `ref`를 쓴다.

---

## 10. 챕터와 효과

### 챕터

시각에 이름을 붙인다. 재생에는 영향이 없고, 캡션 표시와 목차에 쓰인다.

```json
"chapters": [
  { "id": "c1", "time": 0,    "label": "요청", "subtitle": "클라이언트가 SYN을 보낸다" },
  { "id": "c2", "time": 2000, "label": "응답", "subtitle": "서버가 SYN-ACK로 답한다" }
]
```

`settings.showCaption`을 켜면 현재 챕터가 무대 아래에 나온다. `settings.showChapterList`를 켜면 전체 단계 목록이 나오며, `chapterListPosition`을 `left | right | top | bottom` 중 하나로 지정할 수 있다. 챕터가 비어 있으면 두 표시 모두 렌더링되지 않는다.

### 효과

요소를 잠깐 강조한다. **요소의 타임라인을 건드리지 않는다** — 덧그리는 장식이다.

| 타입        | 모양                  | 고유 필드                    |
| ----------- | --------------------- | ---------------------------- |
| `highlight` | 테두리 발광           | `color`                      |
| `pulse`     | 커졌다 돌아옴         | `scale`                      |
| `flow`      | 선을 따라 흐르는 입자 | `color` `particles` `radius` |

```json
{ "type": "pulse", "id": "fx1", "elementId": "srv", "time": 1500, "scale": 1.2, "duration": 500 }
```

같은 요소에 두 번 쏘려면 **항목을 두 개** 쓴다. 효과에는 반복 개념이 없다.

`flow`는 `line`과 `arrow`에만 걸린다. 다른 요소에 걸면 아무것도 그려지지 않고 검증이 경고한다(기존 383개 문서에서 8건 나왔다). 입자는 **직선 현(chord)을 따라** 흐르므로 `curvature`가 큰 화살표에서는 선과 입자가 갈라져 보인다.

효과에 `easing`이나 `interpolate`는 없다. 곡선을 바꾸고 싶으면 효과가 아니라 트랙을 쓴다.

---

## 11. 텍스트와 인코딩

문서는 UTF-8이다. 한글·CJK·이모지가 모두 그대로 들어간다.

폭 계산이 East Asian Width를 따르므로 **한글 한 글자는 라틴 문자 두 개 폭**으로 잡힌다. `code` 요소의 줄바꿈과 `text`의 정렬이 이 계산을 쓴다. 한글이 섞인 라벨의 폭이 맞는 이유이자, legacy에서 어긋났던 지점이다.

`text`의 `textAnchor`는 `start` `middle` `end` 셋이고, `x`가 무엇을 기준으로 하는지를 바꾼다. 가운데 정렬 라벨은 `middle`을 쓰고 `x`에 중심을 준다.

---

## 12. 검증

쓰는 도중과 저장 전에 돌린다.

```
bunx clotho validate public/animations
```

스키마 위반뿐 아니라 **조용히 잘못된 것들**을 잡는다.

- `duration`을 넘는 키프레임 — 도달하지 않는다
- 존재하지 않는 `elementId`를 가리키는 효과
- 존재하지 않는 `assetId`
- 끊어진 `parentId`, 순환 참조
- 풀리는 끝점이 없는 연결선
- **스키마에 없는 속성** — 오타이거나 죽은 필드다. 실제 383개 문서에서 367개가 나왔다

마지막 항목이 실무에서 제일 유용하다. `strokeWith` 같은 오타는 조용히 무시될 뿐 오류를 내지 않으므로, 검증이 없으면 "왜 두께가 안 바뀌지"로 시간을 쓴다.

---

## 13. 작성 순서 (권장)

1. **`canvas`와 `duration`부터 정한다.** 나중에 바꾸면 모든 좌표와 시각을 고쳐야 한다.
2. **정적인 배치를 먼저 완성한다.** `appearances`를 전부 `0 ~ duration`으로 두고 그림이 맞을 때까지 좌표만 만진다.
3. **연결선은 앵커로 건다.** 이 단계에서 좌표로 걸면 4번에서 전부 다시 해야 한다.
4. **출현 순서를 넣는다.** `start`를 어긋나게 해서 이야기 순서를 만든다.
5. **움직임을 넣는다.** 트랙은 마지막이다. 가장 손이 많이 가고 가장 자주 버려진다.
6. **효과는 그다음이다.** 강조는 이야기가 완성된 뒤에 얹는다.
7. **검증하고, 필름스트립으로 확인한다.** 재생만으로는 중간의 타이밍 실수가 잘 안 보인다.

---

## 14. 자주 겪는 문제

| 증상 | 원인 |
| --- | --- |
| 요소가 전혀 안 보인다 | `appearances`가 비었다. 기본값은 "안 보임"이다. |
| 이징이 안 먹는다 | 첫 키프레임에 붙였다. **도착하는** 키프레임에 붙인다. |
| 글자가 부드럽게 안 바뀌고 튄다 | 그게 맞다. 글자는 `discrete`다. |
| 속성을 바꿨는데 아무 일도 없다 | 오타이거나 그 타입에 없는 필드다. `validate`가 잡는다. |
| 요소를 옮겼더니 선이 안 따라온다 | 좌표로 그렸다. `fromId`/`toId`로 바꾼다. |
| 그룹을 옮겼더니 자식이 두 배 움직임 | 자식 좌표를 절대 좌표로 썼다. 자식은 **상대 좌표**다. |
| 문서가 너무 크다 | `inline` 자산. `external`이나 `ref`로 옮긴다. |
| 화살표 머리가 검게 나온다 | clotho에서는 안 생긴다. 색을 마커에 구워 넣는다. |
| 애니메이션이 멈춰 있다 | 화면 밖이거나 `prefers-reduced-motion`이 켜져 있다. 의도된 동작이다. |

---

## 관련 문서

- [`SCHEMA-V1.md`](./SCHEMA-V1.md) — 필드별 정의와 v1 변경점
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — 렌더 파이프라인
- [`MIGRATION.md`](./MIGRATION.md) — legacy 문서·코드 이전
- [`AUDIT-EDITOR.md`](./AUDIT-EDITOR.md) — 에디터로 만들 수 있는 것의 범위
- [`PROPOSALS.md`](./PROPOSALS.md) — 앞으로 넓힐 방향
- [`examples/README.md`](../examples/README.md) — 실행 가능한 예제
