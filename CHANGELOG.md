# 변경 기록

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 따르고 버전은 [Semantic Versioning](https://semver.org/) 규칙에 맞춘다.

## [배포 예정]

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
