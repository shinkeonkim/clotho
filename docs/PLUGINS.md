# Clotho compiler plugin

> 상태: experimental. Plugin API는 `0.x` 동안 호환성 검증을 거친다.

Clotho plugin은 새 runtime element나 renderer를 추가하는 수단이 아니다. 외부 형식 가져오기, 작성 데이터 정규화, Clotho v1 JSON compile, 추가 검증과 별도 출력 형식을 담당한다. Constraint Layout처럼 Clotho의 근본 기능은 core에 내장하되 같은 순수 데이터 pipeline을 내부적으로 활용한다.

## 안전 경계

- hook 입력과 출력은 JSON-compatible 데이터여야 한다.
- 입력은 복제한 뒤 freeze하여 plugin이 원본을 수정하지 못하게 한다.
- 기본 pipeline은 network, filesystem, DOM과 clock을 제공하지 않는다.
- `seed`는 host가 정하며 plugin은 wall-clock 대신 이를 사용한다.
- `verifyDeterminism`은 같은 입력을 두 번 실행해 결과가 달라지면 실패한다.
- core runner는 신뢰된 plugin용이다. 신뢰되지 않은 plugin은 Editor나 host가 Worker sandbox에서 실행해야 한다.

## Plugin 정의

```ts
import { definePlugin } from '@kokoa/clotho/plugins';

export const graphTracePlugin = definePlugin({
  manifest: {
    id: 'example.graph-trace',
    name: 'Graph trace compiler',
    version: '1.0.0',
    clotho: '^0.1.8',
    capabilities: ['parse', 'compile', 'validate'],
  },
  parse(input) {
    if (!input || typeof input !== 'object' || input.kind !== 'graph-trace') {
      return { handled: false };
    }
    return { handled: true, value: input };
  },
  compile(input, context) {
    return compileGraphTrace(input, context.seed);
  },
  validate(document) {
    return validateGraphSemantics(document);
  },
});
```

manifest의 `capabilities`와 실제 hook은 정확히 일치해야 한다. `requires`, `before`, `after`로 plugin 순서를 선언할 수 있으며 ID가 같은 plugin, 누락된 필수 plugin과 순환 관계는 등록 단계에서 거부한다.

## Pipeline 실행

```ts
import { createPluginRegistry, runPluginPipeline } from '@kokoa/clotho/plugins';

const registry = createPluginRegistry([graphTracePlugin]);
const result = runPluginPipeline(source, registry, {
  seed: 'article-42',
  verifyDeterminism: true,
});

if (!result.ok) throw result.error;
console.log(result.document, result.findings, result.trace);
```

실행 순서는 다음과 같다.

1. `parse`: 입력 형식을 처리할 plugin 하나를 선택한다. 둘 이상이 처리하면 conflict다.
2. `normalize`: 등록 순서에 따라 순수 JSON을 정규화한다.
3. `compile`: 고수준 데이터를 Clotho v1 JSON으로 낮춘다.
4. built-in Schema와 의미 검증을 실행한다.
5. `validate`: plugin의 분야별 finding을 추가한다.

정렬은 dependency를 만족하는 범위에서 plugin ID 순으로 결정되므로 등록 순서에 의존하지 않는다.

## Export plugin

```ts
const artifacts = exportWithPlugins('mermaid', document, registry);
```

export hook은 `{ filename, mime, data }` 배열을 반환한다. SVG, GIF처럼 Clotho가 기본 제공하는 출력은 계속 built-in adapter가 담당하며 plugin export는 Mermaid, 분석 report 같은 추가 형식에 사용한다.

## Editor contribution

manifest의 `editor` capability는 panel, toolbar item과 inspector ID를 선언한다. 실제 UI code와 권한은 Editor host가 관리한다. manifest만으로 DOM code가 실행되지 않으며, network나 filesystem이 필요한 plugin은 host의 명시적 permission과 adapter가 있어야 한다.

```ts
manifest: {
  // ...
  capabilities: ['compile', 'editor'],
  editor: {
    panels: ['trace-input'],
    inspectors: ['graph-event'],
  },
}
```

## 기능 내재화 기준

다음 조건 중 하나에 해당하면 community plugin이 아니라 built-in 기능으로 구현한다.

- 모든 adapter가 동일하게 이해해야 하는 scene 의미
- 문서의 결정성, 접근성 또는 안전성을 보장하는 기능
- 공식 Schema와 validator가 장기간 책임져야 하는 기능
- 다른 built-in 기능의 기반이 되는 geometry·layout·timing 기능

특정 외부 형식, 조직별 규칙, 선택적 exporter와 분야별 Pattern은 plugin이 적합하다.
