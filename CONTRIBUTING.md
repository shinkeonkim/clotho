# clotho 기여 안내

## 개발 환경 준비

```bash
bun install
bun test
```

## 반드시 지켜야 하는 원칙

이 프로젝트의 구조를 지탱하는 원칙은 세 가지다. 각 원칙에는 자동 검사가 연결되어 있으며, 실수로 원칙을 어겨도 바로 알아차리기 어려운 문제를 검사 단계에서 발견하도록 구성했다.

### 1. core는 framework와 DOM에 의존하지 않는다

`src/core/`에서는 React, Vue, `node:*`를 import할 수 없다. `document`, `window`, `requestAnimationFrame`, `localStorage`, `navigator`, `btoa`, `atob` 같은 실행 환경 전용 API도 사용할 수 없다.

모든 adapter가 core를 기반으로 동작하므로 core에 특정 실행 환경의 의존성이 들어가면 모든 adapter에 그대로 전파된다. 실행 환경에 의존하는 코드는 해당 adapter(`src/react`, `src/vue`, `src/dom`, `src/node`)에 두거나 hook으로 전달해야 한다.

```bash
bun run check:core-purity
```

`requestAnimationFrame`이 대표적인 예다. 재생 제어기에는 시간을 갱신할 장치가 필요하지만 core는 특정 환경의 API를 직접 사용하지 않는다. 대신 core에서 `Scheduler` interface를 정의하고, 브라우저 구현은 `src/dom/scheduler.ts`에 둔 뒤 React와 Vue에서도 같은 구현을 사용한다.

### 2. 렌더링 로직은 adapter가 아니라 scene graph에 둔다

adapter의 역할은 `SceneNode`를 각 환경의 출력 형식으로 변환하는 데 그친다. adapter 안에서 요소가 `rect`인지 검사해야 한다면 해당 로직은 `src/core/scene/elements/`에 있어야 한다.

`tests/adapter-equivalence.test.ts`는 같은 scene을 SVG 문자열, React, Vue 경로로 렌더링한 뒤 결과가 같은지 검사한다. 이 테스트가 실패하면 adapter 사이의 동작이 달라졌다는 뜻이다.

### 3. 렌더링 결과가 달라졌다면 이유를 남긴다

`bun run check:legacy-equivalence`는 clotho가 대체하는 기존 engine과 현재 runtime을 실제 문서 383개, frame 27,690개에 걸쳐 비교한다. 의도적으로 렌더링 결과를 바꿨다면 검사 기준을 함께 수정하고 커밋에 이유를 적어야 한다. 검사를 삭제해서는 안 된다.

이 검사는 비교 대상 저장소가 들어 있는 `.private/`가 필요하다. 해당 디렉터리가 없으면 자동으로 건너뛰므로 CI에서는 실행하지 못한다. runtime을 수정했다면 로컬 환경에서 반드시 실행한다.

## 문서 형식 변경

문서 형식은 이미 작성된 animation 문서와 맺은 계약이다. `src/core/schema/`를 변경할 때는 다음 사항을 모두 확인한다.

1. 변경 내용뿐 아니라 변경 이유도 `docs/SCHEMA-V1.md`에 기록한다.
2. 기존 문서를 더 이상 읽을 수 없다면 migration 경로를 제공한다.
3. `bun run schema:generate`를 실행해 배포되는 JSON Schema를 최신 상태로 맞춘다.
4. `bun test`로 전체 문서 모음의 회귀 검사를 통과한다.

## 테스트 작성

- 단위 테스트는 대상 module 옆에 둔다. 예: `src/core/runtime/runtime.test.ts`
- 문서 모음 테스트와 adapter 간 비교 테스트는 `tests/`에 둔다.
- 참조 문서 모음이 필요한 테스트는 해당 자료가 없을 때 자동으로 건너뛴다. 다른 위치를 사용하려면 `CLOTHO_CORPUS_DIR`을 지정한다.

구현 내용을 그대로 반복하는 테스트보다 기대하는 동작과 그 이유를 설명하는 테스트를 작성한다. 이 저장소의 여러 테스트에는 어떤 버그의 재발을 막는지 설명하는 주석이 있으며, 새 테스트도 같은 수준을 목표로 한다.

## 커밋 작성

하나의 커밋에는 하나의 작업 단위만 담고 제목은 `[작업 유형] 변경 내용` 형식으로 작성한다. diff만 보고 이유를 파악하기 어렵다면 본문에 배경을 적는다. 특히 이식 작업에서는 동작이 바뀌었는지 나중에도 판단할 수 있어야 한다.

## Pull Request 전 확인 사항

```bash
bun run typecheck && bun run lint && bun run format:check
bun test
bun run build && bun run check:size && bun run check:styles && bun run check:core-purity
bun run schema:check
bun run check:legacy-equivalence   # runtime을 수정했고 .private/가 있을 때
```
