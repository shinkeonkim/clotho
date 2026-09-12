# 변경 기록

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 따르고 버전은 [Semantic Versioning](https://semver.org/) 규칙에 맞춘다.

## [배포 예정]

## [0.4.2] - 2026-09-13

### 추가

- **`math` 요소**: TeX 수식을 요소로 배치한다. 열한 번째 요소 타입이다.
  - **조판기는 주입받는다.** TeX 엔진은 이 코어 전체보다 크다 — KaTeX만 해도 몇 배다. zod를 렌더링 어댑터 밖으로 밀어낸 패키지가 조판기를 번들에 넣을 수는 없다. 호스트가 `mathRenderer`를 넘기면 그 결과 서브트리를 요소의 앵커에 놓고, 없으면 **TeX 원문을 monospace로 그리고 진단을 남긴다.** 해결되지 않은 asset과 같은 규칙이다 — 빈자리를 남기고 작성자가 요소를 잃어버렸다고 생각하게 만들지 않는다.
  - 필드: `x`, `y`, `tex`, `display block|inline`, `fontSize 18`, `color #18181b`, `textAnchor start`, `alt?`. `alt`는 조판 결과를 볼 수 없는 독자를 위한 낭독 문구이며 `role="img"`와 `aria-label`로 나간다.
  - 조판기에는 `fontSize` · `color` · `display` · **`textAnchor`** 를 넘긴다. 코어는 돌려받은 서브트리를 재지 않으므로 앵커를 맞출 수 없고, 자기 출력 폭을 아는 쪽은 조판기뿐이다.
  - 색은 **테마가 해석된 값**으로 넘어간다. 기본값 `#18181b`가 "전경색"이라는 사실을 호스트 조판기가 알 방법이 없고, 매 호스트가 그 규칙을 다시 구현하면 누군가는 틀린다.

### 수정

- `math`가 **bounds에 없어서** 위치를 묻는 기능이 전부 거부하던 문제를 고쳤다. `elementLocalBounds`와 `elementCenter` 둘 다 `math` 케이스가 없어 `null`로 떨어졌고, camera focus는 `no visible target`, spotlight는 `not on stage`, trail은 `has no position`이라고 — **화면에 멀쩡히 있는 수식에 대해** 말했다. connector도 겨눌 곳이 없었다. layout 컴파일러에는 `math` 케이스가 있어 잘 동작했던 탓에 눈에 띄지 않았다: 작성 시점 측정과 렌더 시점 bounds는 별개 경로이고 한쪽만 가르쳐져 있었다.
  - bounds는 **원문 fallback**을 잰다. 코어가 예측할 수 있는 유일한 렌더링이기 때문이다 — 조판된 식은 보통 이보다 좁다(`\frac{-b}{2a}`는 원문 폭의 1/3쯤). 넉넉한 상자라도 식을 담고 camera·spotlight 모두 자기 `padding`이 있으니, 아무 답도 없는 것보다 낫다.
- `textAnchor`가 조판기가 있으면 **아무 일도 하지 않던** 문제를 고쳤다. fallback은 적용하고 bounds도 그만큼 상자를 옮기는데 조판된 서브트리만 원점에 놓여, `middle`을 쓰면 식이 자기 상자 밖에 있었다.
- 빈 `tex`가 **부르지도 않은 조판기를 탓하던** 진단을 고쳤다. 이제 수식이 비어 있다고 말한다.

### 호환성

**완전 하위호환.** element union에 타입 하나가 늘었을 뿐이며, 기존 문서의 출력은 visual baseline이 증명하듯 바이트 단위로 동일하다.

## [0.4.1] - 2026-09-10

### 추가

- **Motion trail 효과**: 움직이는 요소가 **지나온 경로를 꼬리로 남긴다.** 배열을 훑는 커서, 노드를 방문하는 탐색, 서로를 향해 좁혀오는 포인터 — 움직임 자체가 정보인 문서에서 정지 프레임은 그 정보를 전부 잃는다. GIF 썸네일과 문서 캡처가 특히 그렇다.
  - **누적하지 않는다.** 시각 `t`에서 `[t-window, t]`를 `samples`개로 나눠 각 시점의 위치를 **문서로부터 다시 계산한다.** `(문서, t) → 화면`이 유지되므로 뒤로 감아도, 정지 프레임을 뽑아도, 900번째 프레임부터 렌더해도 같은 트레일이 나온다. 재생 중 버퍼에 쌓는 구현이라면 시청자가 그 시각에 어떻게 도달했는지에 따라 답이 달라지고, seek할 때마다 얼룩이 남는다.
  - `mode: "auto"`(기본)는 위치 track이 **이산 보간이면 점**, 아니면 선을 고른다. 순간이동하는 요소의 샘플을 선으로 이으면 지나지 않은 경로를 그리는 거짓말이 된다. `path`·`dots`로 직접 지정할 수 있다.
  - `window`가 꼬리의 길이, `samples`는 해상도다. `samples`를 올린다고 꼬리가 길어지지 않는다.
  - **같은 자리에 겹치는 샘플은 하나로 합친다.** 샘플 간격은 시간이지 거리가 아니라서, 요소가 느리게 움직이거나 멈춰 있으면 여러 샘플이 한 점에 떨어진다. 반투명한 조각이 겹치면 합성되므로 — 0.08부터 1까지 흐려지는 점 11개가 한 자리에 쌓이면 꽉 찬 점 하나가 된다 — 그대로 두면 `fade`가 그려져도 보이지 않는다. 그래서 **움직이지 않는 요소는 꼬리를 남기지 않고**, 멈춘 뒤에는 창이 지나가는 동안 꼬리가 흐려지며 사라진다.
  - 창은 요소(와 조상 group)가 **무대에 오른 시각까지만** 거슬러 간다. 등장 이전으로 이어지는 꼬리는 없던 사실을 지어내는 것이고, 그렇다고 그 샘플들을 버리기만 하면 갓 등장한 요소는 창이 다 지나갈 때까지 꼬리가 없다 — 버리는 대신 남은 구간에 다시 배분한다.
  - 트레일은 대상 **아래**에 그려진다. 위에 그리면 추적하려던 대상을 가린다.
  - 중심점이 없는 요소(group 등)를 대상으로 하면 `trail-target` diagnostic을 남긴다.
- `elementStateAt` · `computeElementState` · `elementRootCenterAt` · `ancestorChain`을 공개한다. 샘플 12개를 위해 `computeSnapshot`을 12번 부르면 요소 40개 문서에서 프레임당 480회 평가가 되므로, 요소와 그 조상 체인만 평가하는 경로를 갈라냈다. `computeSnapshot`도 같은 요소 단위 평가를 호출하므로 둘이 어긋날 수 없다.

### 수정

- `check:size`의 `cli`·`plugins` 예산이 측정값의 **0.1% 안쪽**에 걸려 있어 CI에서만 실패하고 로컬에서는 통과하던 문제를 고쳤다. gzip 출력은 zlib 빌드마다 바이트 단위로 같지 않아 같은 번들이 macOS보다 CI에서 200B 남짓 크게 잡힌다. 그 정도 여유는 번들이 아니라 플랫폼을 재는 것이라, 나머지 항목과 같은 폭으로 맞췄다.

### 호환성

**완전 하위호환.** effect union에 타입 하나가 늘었을 뿐이며, 기존 문서의 출력은 visual baseline이 증명하듯 바이트 단위로 동일하다. `computeSnapshot`의 공개 동작도 그대로다.

## [0.4.0] - 2026-09-09

### 추가

- **Spotlight 효과**: 대상을 바꾸지 않고 **나머지를 어둡게 해서** 시선을 모은다. `highlight`가 대상의 fill을 갈아끼우느라 요소의 원래 색을 잃는 반면, spotlight는 대상을 그대로 두고 무대에서 대비를 걷어낸다. 색 자체가 정보인 문서에서 강조와 정보가 충돌하지 않는다.
  - `elementIds`가 복수인 유일한 효과다. 나머지 셋은 요소 하나를 꾸미고, 이것은 그 바깥을 꾸민다.
  - `shape`: `bbox`(대상들의 합집합 사각형, 기본) · `circle`(외접원) · `elements`(실루엣 그대로). 대상이 흩어져 있으면 `elements`를 쓴다 — `bbox`는 그 사이의 관계없는 요소까지 밝힌다.
  - **`dimColor`로 가려지는 쪽의 색**, **`lit` + `litColor`로 비추는 쪽에 얹는 색**을 정한다. `dimColor`를 생략하면 테마 토큰(라이트·다크 모두 near-black)이고, `lit`은 기본 0이라 요청하지 않으면 대상은 자기 색 그대로다.
  - 여러 spotlight가 동시에 활성이면 scrim 하나를 공유한다. 각자 깔면 겹치는 곳이 두 번 어두워지고 한쪽의 scrim이 다른 쪽 대상을 덮는다. 색은 가장 강한 것이 정하고, wash는 각자 하나씩 나온다.
  - 렌더는 마스크 하나에 사각형 하나다. 무대에 요소가 몇 개든 노드는 둘이다.
  - 대상이 그 시각에 하나도 무대에 없으면 그 프레임을 건너뛰고 `spotlight-target` diagnostic을 남긴다.

### 수정

- `shape: "elements"`에서 **connector의 화살촉이 실제의 몇 배 크기로** 밝아지던 문제를 고쳤다. SVG 마커는 기본이 `markerUnits="strokeWidth"`인데 마스크의 stroke는 `padding * 2`이므로, padding 8·선 두께 2인 화살표의 머리가 8배로 그려졌다. 마스크는 이제 마커를 가져가지 않는다 — 굵어진 선이 머리가 놓인 자리를 이미 덮고, 마커 def는 색이 있어서 luminance 마스크에서는 어차피 구멍을 반만 뚫는다.
- `shape: "elements"`에서 **채우지 않는 도형이 마스크에서 채워지던** 문제를 고쳤다. 곡선 connector가 호와 현 사이 전체를 밝히고 있었다.
- `shape: "elements"`에서 **group 안의 대상**이 group 원점에 구멍을 뚫던 문제를 고쳤다. 마스크의 자식은 대상이 속한 group이 아니라 마스크에 매달리므로, 실루엣을 root 좌표계로 옮긴다. 빈 캔버스가 밝아지고 정작 대상은 어두운 채로 남던 증상이다.
- `shape: "elements"`에서 **등장·퇴장 전환 중인 대상**이 도착 예정 위치에서 밝아지던 문제를 고쳤다. 그런 요소는 `${id}-phase` 래퍼 안에 그려지므로 래퍼째 가져온다.
- 두 수정으로 **비추는 중에 움직이는 대상**이 모두 따라간다 — 자기 track이든, 부모 group이 옮기든, 전환 중이든.
- 렌더 어댑터(svg · dom · react · vue · gif · testing)에 zod가 들어오던 회귀를 고쳤다. `check:size`가 bare specifier를 검사하도록 바꿔 같은 회귀를 다시 잡는다.


## [0.3.0] - 2026-09-09

### 추가

- **Camera track**: 어느 부분을 보여줄지를 문서가 정한다. `camera.tracks`로 `zoom`·`x`·`y`를 직접 쓰거나, `camera.focus`로 요소를 지정하면 그 요소가 화면에 담기도록 카메라를 계산한다. focus는 매 프레임 실제 요소 위치로 다시 계산하므로 움직이는 대상을 따라간다.
  - 카메라는 `Scene.viewBox` 하나로 나온다. `Scene`이 이미 가지고 있던 필드라서 **adapter는 바뀌지 않았다** — React, Vue, DOM, SVG 문자열, GIF가 그 값을 그대로 통과시킨다.
  - `camera.strokeScaling`: `scale`(기본, 확대하면 선도 굵어진다)과 `fixed`(배율로 나누어 선 두께를 유지한다). `vector-effect`가 아니라 계산된 숫자로 적용하므로 resvg 기반 GIF까지 같은 결과를 낸다.
  - `prefers-reduced-motion`에서는 보간 대신 이전 값을 유지하다가 한 번에 바뀐다 — 이동이 컷이 된다. 움직이는 화면은 읽는 사람을 멀미하게 만드는 가장 확실한 방법이기 때문이다.
  - `computeCamera(doc, time)`는 그 시각에 보이는 사각형과 그것을 만든 값을 함께 돌려준다. 카메라가 없는 문서에서는 `null`이다.
  - 해결되지 않은 focus는 직전 화면을 유지하고 `focus-unresolved`를 보고한다. 화면이 엉뚱한 곳으로 튀는 대신 무엇이 잘못됐는지 알린다.
  - `camera`는 선택 필드다. 없는 문서는 이전과 완전히 동일하게 렌더된다.

### 수정

- checkpoint 상호작용을 네 adapter에서 모두 완성했다.


## [0.1.2] - 2026-09-01

### 추가

- React, Vue, DOM player에 `auto | light | dark` 테마 선택 API와 테마별 CSS token 재정의 방법을 추가했다.
- gallery의 animation 아홉 개를 각각 독립된 README GIF로 제공한다.
- `renderDocumentToGif`, `writeDocumentGif` Node API와 `clotho gif` CLI를 추가했다.
- `defineAnimation`, `appear`, `track`, `repeatAppearances`, `stagger`, `effects.*`처럼 type을 검사하는 작성 도우미를 추가했다.
- 단계 목록을 좌·우·상·하에 배치하는 `settings.chapterListPosition`을 추가했다.
- npm OIDC trusted publishing을 사용하는 GitHub Actions 배포 workflow를 추가했다.

### 수정

- `auto` connector anchor가 중심이 아니라 상대 endpoint를 향하는 외곽점을 선택하도록 수정했다.
- 원형 요소의 대각선 anchor가 중심에 겹치지 않고 원주 위에 놓이도록 수정했다.
- chapter가 없는 DOM player에 빈 하단 막대가 나타나던 문제를 해결했다.
- 현재 단계 표시는 기존 형식인 `Chapter n / total, label`로 복원했다.
- Bun gallery의 라이트·다크 색상 대비와 anchor 예제 배치를 개선했다.
- anchor 예제의 시작점은 고정하고 움직이는 hub의 경계를 connector가 추적하도록 수정했다.
- GIF에서 animation 영역만 나오거나 글꼴과 CSS 색상이 빠지던 문제를 해결했다. 기본 GIF에는 제목, 조작 버튼, animation 영역, 현재 단계 설명, 전체 단계 목록이 모두 나온다.

## [0.1.0] - 2026-09-01

두 블로그 안에서 사용하던 animation engine을 독립 package로 분리한 첫 배포다. framework에 종속되지 않는 렌더링 구조를 새로 구성했다.

### 추가

- **문서 형식 v1**(`clothoVersion: 1`): 요소 유형 10개, 표시 구간과 속성 track, effect 3개, chapter를 지원한다. 자세한 내용은 `docs/SCHEMA-V1.md`에서 확인할 수 있다.
- **framework 독립 scene graph**: `buildScene(doc, t)`는 순수한 data를 반환하며 각 adapter가 이를 자신의 출력 형식으로 변환한다.
- **adapter 4개**: 같은 scene을 SVG 문자열, DOM, React, Vue 3에서 동일하게 렌더링한다.
- **독립된 재생 제어기**: `createPlayer`는 scheduler를 주입받으므로 단위 테스트가 가능하고 SSR 환경에서도 안전하다.
- **실제로 동작하는 group**: 기존 `group` 요소는 선언만 되어 있고 렌더링되지 않았다. v1은 `parentId`를 이용해 transform과 표시 여부가 자식에게 적용되는 중첩 구조를 만든다.
- **문서 단위 image asset**: base64 data, 외부 URL, host가 해석하는 reference를 지원하며 editor에서 사용할 수 있는 `encodeImageAsset`도 제공한다.
- **의미 검증**: schema 검사 외에도 중복 ID, 잘못된 참조, 시간 범위, parent 순환, 찾을 수 없는 asset, schema에 없는 속성을 검사한다.
- **legacy v3/v4 migration**: 실제 문서 383개를 대상으로 손실 없이 변환되는지 검증했다.
- **CLI**: `clotho validate`, `clotho migrate` 명령을 제공한다.
- **stylesheet**: `--cloth-*` token을 이용한 라이트·다크 기본 테마를 제공한다.
- **JSON Schema**: editor 자동 완성에 사용할 수 있도록 zod schema에서 생성한다.
- UI 기본 문구는 영어이며 일부 문구만 바꿀 수도 있다. 한국어 문구는 `koreanStrings`로 제공한다.

### 수정

- CJK 문자가 들어 있는 code block의 줄 번호 여백을 잘못 계산하던 문제를 해결했다. 기존 계산은 모든 문자를 같은 폭으로 취급했지만 한글과 CJK 문자는 monospace 환경에서 두 칸을 차지한다.
- `flow` effect가 `line`을 대상으로 할 때 아무것도 그리지 않던 문제를 해결했다.
- 문서 parsing에 실패했을 때 원인 없이 "not found"로 표시되던 문제를 해결하고 구체적인 오류를 반환하도록 수정했다.
- 모든 marker 정의를 매번 HTML 문자열로 넣던 방식을 없애고 실제로 사용하는 marker만 data로 생성하도록 수정했다.
- `group` 요소가 아무것도 렌더링하지 않던 문제를 해결했다.
