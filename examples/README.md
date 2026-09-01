# 예제

예제는 사용 방법을 보여 주는 integration 예제와 지원 기능을 한눈에 확인하는 gallery 예제로 나뉜다.

## 화면에 animation을 넣는 방법

아래 파일은 각각 독립적으로 실행할 수 있으며 모두 같은 문서인 [`shared/document.json`](./shared/document.json)을 렌더링한다. 달라지는 것은 framework와 연결하는 방식뿐이며, 사용하는 framework가 달라져도 animation 문서는 바뀌지 않는다.

| 파일 | 실행 방법 |
| --- | --- |
| [`vanilla.html`](./vanilla.html) | `bun examples/vanilla.html` |
| [`static-svg.ts`](./static-svg.ts) | `bun examples/static-svg.ts`를 실행하면 frame을 파일로 저장한다. |
| [`react.tsx`](./react.tsx) | React application에 붙여 넣어 사용한다. |
| [`vue.vue`](./vue.vue) | Vue 3 application에 붙여 넣어 사용한다. |

## 지원 기능을 확인하는 gallery

```bash
bun examples/gallery/index.html
```

gallery에는 기능별 문서가 아홉 개 있으며 각 문서에는 확인할 내용을 설명하는 안내가 붙어 있다. 모든 요소 유형, transition 방식, easing 곡선, 화살표 머리, anchor를 확인할 수 있다. 별도의 loop 문법 없이 반복을 표현하는 다섯 가지 방법도 `iteration` 예제에서 보여 준다.

각 문서 아래의 **frames** 버튼을 누르면 전체 timeline을 여러 frame으로 펼쳐 볼 수 있다. 재생 중에는 놓치기 쉬운 중간 시점의 시간 설정 오류도 연속된 frame으로 보면 쉽게 찾을 수 있다.

`bun examples/gallery/build.ts`를 실행하면 같은 내용을 JSON 문서와 SVG frame으로 저장한다. JSON은 문서 구조를 살펴보는 데 사용할 수 있고 SVG는 변경 전후의 렌더링 결과를 비교하는 데 사용할 수 있다.

[`tests/gallery-coverage.test.ts`](../tests/gallery-coverage.test.ts)는 gallery가 schema의 모든 기능을 다루는지 검사한다. 문서 형식에 새 mode를 추가하면 해당 기능을 보여 주는 gallery 예제를 추가하기 전까지 test가 실패하므로 예제가 실제 기능보다 뒤처지는 일을 방지할 수 있다.

| 문서 | 확인할 수 있는 내용 |
| --- | --- |
| `elements` | group과 두 가지 asset 방식을 포함한 요소 유형 10개 |
| `transitions` | 같은 표시 구간에 적용한 등장·퇴장 방식 8개 |
| `easing` | 같은 거리를 움직이는 easing 곡선 4개 |
| `interpolation` | `auto` · `number` · `color` · `discrete` |
| `iteration` | 이동하는 cursor, 펼쳐 쓴 반복 본문, counter, 반복 표시, effect를 이용한 반복 표현 |
| `effects` | `highlight` · `pulse` · `flow` |
| `connectors` | anchor 10개, 화살표 머리 9개, 곡률 |
| `groups` | 중첩 transform과 서로 다른 좌표 공간을 잇는 connector |
| `chapters` | 현재 단계를 나타내는 caption과 전체 단계 목록 |

문서 형식을 처음 사용한다면 이 예제와 함께 [`docs/AUTHORING.md`](../docs/AUTHORING.md)를 읽는 것이 좋다.
