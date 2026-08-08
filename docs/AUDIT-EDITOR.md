# 에디터 커버리지 감사

**질문:** 기존 애니메이션 에디터로 만들 수 있던 것이 clotho에서 전부 되는가?
**답:** 된다. 반대 방향에 구멍이 있다 — **clotho가 렌더하는 것 중 에디터가 만들 수 없는 것**이 상당수다.

조사 대상은 `clotho-editor/src/`(아이콘 데이터 2,016줄 제외) 전체와 clotho v1 스키마.
근거는 `properties.ts`의 `renderBaseFields`(속성 패널이 그리는 필드의 유일한 출처),
`element-list.ts`의 `makeDefaultElement`(생성 시 기본값), `canvas.ts`/`canvas-handles.ts`
(캔버스 조작으로 바뀌는 값)다.

---

## 1. 결론 세 줄

1. **에디터 → clotho 방향은 100%다.** 에디터가 쓰는 심볼 전부에 대응이 있고,
   383개 실문서가 `check:legacy-equivalence`에서 프레임 단위로 일치한다. 회귀는 없다.
2. **clotho → 에디터 방향에 37개 필드가 비어 있다.** 렌더러는 지원하는데 UI가 없어서
   에디터만으로는 그 값을 넣을 수 없다(§3에 목록). 여기에 `ease`, `interpolate`, `tags`가
   더해진다. 대부분 legacy 시절부터 있던 구멍이고, v1이 만든 구멍은 `interpolate` 하나다.
3. **가장 큰 단일 항목은 `code` 요소다.** 스키마에 있고 렌더되는데 추가 메뉴에 없다.
   실데이터 383개 중 19개가 `code`를 쓰는데, 그것들은 손으로 JSON을 쓴 것이다.

---

## 2. 요소 타입

| 타입      | clotho 렌더 | 에디터 생성                | 비고                            |
| --------- | ----------- | -------------------------- | ------------------------------- |
| `rect`    | O           | O `□ Rect`                 |                                 |
| `circle`  | O           | O `○ Circle`               |                                 |
| `line`    | O           | O `／ Line`                |                                 |
| `arrow`   | O           | O `↗ Arrow`                |                                 |
| `text`    | O           | O `T Text`                 |                                 |
| `image`   | O           | O (+ 아이콘 라이브러리)    | v1에서 처음 실동작              |
| `path`    | O           | O                          | `d`는 편집 수단이 없다 (§3)     |
| `polygon` | O           | O                          | 정점은 캔버스 핸들로 편집       |
| `group`   | O           | O (선택 → 그룹화)          | v1에서 처음 실동작              |
| `code`    | O           | **X**                      | **추가 메뉴에 항목이 없다**     |

`group`이 추가 메뉴에 없는 것은 정상이다 — 빈 그룹은 의미가 없고 선택 후 그룹화가 맞다.
`code`가 없는 것은 정상이 아니다.

---

## 3. 속성 패널이 노출하지 않는 필드

`renderBaseFields`가 그리는 필드가 전부다. 아래는 스키마에 있으나 그 목록에 없는 것들.
"캔버스"는 속성 패널 대신 캔버스 조작으로 바꿀 수 있다는 뜻이고,
"없음"은 **에디터 안에서 값을 바꿀 방법이 전혀 없다**는 뜻이다.

| 요소      | 패널에 없는 필드                                                                                       | 실제 수단 |
| --------- | ------------------------------------------------------------------------------------------------------ | --------- |
| `rect`    | `cornerRadius`, `labelSize`, `subtitle`, `subtitleSize`                                                  | 없음      |
| `circle`  | `labelSize`                                                                                              | 없음      |
| `text`    | `fontWeight`, `textAnchor`                                                                               | 없음      |
| `line`    | `strokeDasharray`, `headStart`, `headEnd`                                                                | 없음      |
| `line`    | `fromId`, `toId`, `fromAnchor`, `toAnchor`                                                               | 캔버스    |
| `arrow`   | `strokeDasharray`, `headStart`, `headEnd`, `label`, `labelColor`, `labelOffsetX`, `labelOffsetY`         | 없음\*    |
| `arrow`   | `fromId`, `toId`, `fromAnchor`, `toAnchor`, `curvature`                                                  | 캔버스    |
| `image`   | `alt`, `preserveAspectRatio`, `opacity`                                                                  | 없음      |
| `image`   | `assetId`                                                                                                | 첨부 UI   |
| `path`    | `d`, `strokeDasharray`, `opacity`                                                                        | 없음      |
| `path`    | `x`, `y`                                                                                                 | 캔버스    |
| `polygon` | `opacity`                                                                                                | 없음      |
| `polygon` | `points`                                                                                                 | 캔버스    |
| `group`   | `x`, `y`                                                                                                 | 캔버스    |
| `code`    | 전부 (`content` 포함)                                                                                    | 없음      |

\* `label`/`labelColor` 입력칸은 `rect`와 `circle`에만 붙는다. `arrow`도 라벨을
렌더하는데 패널에는 나타나지 않는다.

`path`가 특히 나쁘다. 패널이 그리는 것은 `fill`/`stroke`/`strokeWidth` 셋뿐이다.
위치는 드래그로 옮길 수 있지만 **`d`를 바꿀 수단이 없어** 기본 모양에서 벗어날 수 없다.
`polygon`은 정점 핸들이 있어서 같은 처지가 아니다.

`opacity`가 네 요소에서 반복해 비는 것은 우연이 아니다 — `renderBaseFields`가
불투명도를 아예 다루지 않는다. 요소별 문제가 아니라 패널의 구조적 누락이다.

`code`의 `showLineNumbers`와 `textColor`는 에디터 소스 전체에서 단 한 번도
등장하지 않는다. 나머지 "없음" 항목들은 이름은 등장하되 렌더·기본값 경로일 뿐이다.

---

## 4. 트랙 · 키프레임

| 기능                     | clotho              | 에디터                                    |
| ------------------------ | ------------------- | ----------------------------------------- |
| 트랙 생성                | —                   | O 자동 (t>0에서 base 속성을 바꾸면 생김)  |
| 키프레임 추가/삭제       | —                   | O                                         |
| 키프레임 시각으로 점프   | —                   | O                                         |
| 트랙 삭제                | —                   | O                                         |
| 키프레임 **`ease`** 선택 | 4종 지원            | **X — 소스 전체에 등장하지 않는다**       |
| 트랙 **`interpolate`**   | `auto`/`number`/`color`/`discrete` | **X — v1 신규, UI 미구현** |

`ease`가 없는 것은 legacy부터 이어진 구멍이다. 스키마 기본값이 `easeInOut`이므로
에디터로 만든 모든 키프레임은 `easeInOut`이다. `linear`가 필요한 등속 이동(스캔선,
진행 표시줄)은 에디터로 만들 수 없다.

`interpolate`는 v1이 새로 연 표면이고, 아직 UI가 없다. 지금은 `auto`로 동작하므로
결과가 틀리지는 않지만, 문자열 속성을 계단식으로 바꾸는 연출은 지정할 수 없다.

---

## 5. 출현 · 전이 · 효과

| 항목            | clotho                                                              | 에디터 |
| --------------- | ------------------------------------------------------------------- | ------ |
| `start`/`end`   | O                                                                   | O      |
| `entryMode`     | `instant fade slide-left slide-right slide-up slide-down zoom pop` | O 8종 전부 |
| `exitMode`      | 위와 동일                                                            | O 8종 전부 |
| `entryDuration` | O                                                                   | O      |
| `exitDuration`  | O                                                                   | O      |
| 효과 `highlight`| O                                                                   | O      |
| 효과 `pulse`    | O                                                                   | O      |
| 효과 `flow`     | O                                                                   | O      |
| 챕터            | O                                                                   | O 추가/수정/삭제 |

**이 영역은 빈틈이 없다.** 전이 모드 8종과 효과 3종이 전부 UI에 있다.

---

## 6. 문서 수준

| 필드                            | 에디터 |
| ------------------------------- | ------ |
| `title`, `description`, `duration` | O   |
| `category`                      | O      |
| `canvas.background`             | O      |
| `settings.loop` / `autoplay`    | O      |
| `settings.showCaption` / `showChapterList` | O |
| `tags`                          | X      |
| `assets` 레지스트리 직접 관리   | X (이미지 첨부 시 자동 생성만) |

`assets`가 직접 관리되지 않는 점은 지금은 문제가 아니다. `inline` 자산은 첨부 UI가
만들고, `external`/`ref`는 호스트가 주입한다. 다만 **쓰지 않는 자산을 지우는 수단이
없어** 문서가 단조증가한다. base64 인라인이면 파일 크기에 바로 나타난다.

---

## 7. clotho가 에디터보다 앞선 것

감사의 반대 방향. v1이 만들었지만 아직 에디터가 쓰지 못하는 능력.

- **중첩 그룹.** `parentId`는 임의 깊이를 표현하는데 그룹화 UI는 1단계만 만든다.
- **`validateDocument`.** 저장 전 미지의 속성까지 잡아낸다(실데이터에서 367개 발견).
  에디터 패널에 표시되지 않는다.
- **`assets`의 `external`/`ref`.** 스키마에 있고 `AssetResolver`가 처리하는데
  첨부 UI는 `inline`만 만든다.

---

## 8. 조치 목록

우선순위는 "에디터만 쓰는 사람이 만들 수 없는 것"의 크기 순.

| #  | 항목                                   | 크기 | 근거                                        |
| -- | -------------------------------------- | ---- | ------------------------------------------- |
| A1 | `code` 요소 추가 메뉴 + 속성 필드      | 중   | 요소 하나가 통째로 막혀 있다                |
| A2 | 키프레임 `ease` 선택                   | 소   | 등속 연출이 불가능하다                      |
| A3 | `path.d` 편집 (최소한 텍스트 입력)     | 소   | 추가는 되는데 모양을 못 만든다              |
| A4 | `opacity` 공통 필드                    | 소   | 4개 요소에서 동시에 빈다                    |
| A5 | `arrow`의 `label`/`headStart`/`dash`   | 소   | 렌더되는데 패널에 없다                      |
| A6 | `interpolate` 선택                     | 소   | v1 신규 표면                                |
| A7 | `cornerRadius`/`labelSize`/`subtitle`  | 소   | `rect` 기본값에만 의존 중                   |
| A8 | 미사용 자산 정리                       | 중   | 인라인 base64가 쌓인다                      |
| A9 | `validateDocument` 결과 패널           | 중   | 이미 계산되는 정보를 버리고 있다            |
| A10| 중첩 그룹 UI                           | 대   | 모델은 준비됐고 UI만 없다                   |

A2~A7은 전부 `renderBaseFields`와 `renderTracks` 안의 작업이다. 한 번에 처리하는 것이
파일을 여러 번 여는 것보다 싸다.

---

## 9. 이 감사를 다시 돌리는 법

수작업 대조가 아니라 스크립트다. clotho 쪽에서:

```
bun run audit:editor ../clotho-editor
```

스키마에서 요소별 필드를 뽑고 에디터 소스에서 편집 표면을 찾아 표를 다시 만든다.
에디터가 필드를 추가하면 표가 줄어든다. 표가 늘어나면 clotho가 스키마를 넓혔는데
에디터가 따라오지 않았다는 뜻이다.
