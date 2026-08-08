# @shinkeonkim/clotho

JSON으로 정의하는 시각화 애니메이션 패키지.

애니메이션을 명령형 코드가 아니라 **선언적 JSON 문서**로 기술한다. 시각 상태는 오직
`(문서, 시각 t)`의 순수 함수이므로 임의 시점 seek, 정지 프레임 렌더, 서버 사이드 출력,
에디터 스크럽이 모두 같은 경로로 처리된다.

렌더 결과는 프레임워크 중립 **씬 그래프**로 만들어지고, 얇은 어댑터가 이를 React
elements · Vue vnodes · 실 DOM · SVG 문자열로 옮긴다. 렌더 로직은 한 곳에만 있다.

```jsonc
{
  "clothoVersion": 1,
  "id": "bellman-ford",
  "title": "벨만-포드",
  "duration": 12000,
  "canvas": { "width": 800, "height": 460, "background": "transparent" },
  "elements": [
    {
      "type": "circle", "id": "n-a", "cx": 150, "cy": 230, "r": 32,
      "fill": "#fef3c7", "label": "A",
      "appearances": [{ "start": 0, "end": 12000 }],
      "tracks": [
        { "property": "fill", "interpolate": "color", "keyframes": [
          { "time": 0, "value": "#fef3c7" },
          { "time": 2000, "value": "#dcfce7" }
        ]}
      ]
    }
  ],
  "chapters": [{ "id": "c1", "time": 2000, "label": "Round 1" }],
  "effects": [{ "type": "pulse", "id": "p1", "elementId": "n-a", "time": 2000 }]
}
```

## 상태

**개발 초기.** 현재 저장소에는 조사 결과·설계·포맷 초안·작업 계획과 프로젝트 골격만 있다.
코어 구현은 진행 중이다.

- 조사: [`docs/RESEARCH.md`](./docs/RESEARCH.md) — 기존 두 구현체 실측 비교
- 설계: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 씬 그래프, 어댑터, 재생 컨트롤러
- 포맷: [`docs/SCHEMA-V1.md`](./docs/SCHEMA-V1.md) — v1 문서 스펙 초안
- 계획: [`TASKS.md`](./TASKS.md)

## 예정 구조

| 진입점 | 내용 | peer 의존 |
| --- | --- | --- |
| `@shinkeonkim/clotho` | 스키마, 런타임, 씬 그래프, 재생 컨트롤러, 검증, 마이그레이션 | 없음 |
| `…/svg` | SVG 문자열 직렬화 (SSR·정적 내보내기) | 없음 |
| `…/dom` | 바닐라 JS 어댑터 | 없음 |
| `…/react` | React 어댑터 + 플레이어 UI | react, react-dom |
| `…/vue` | Vue 3 어댑터 + 플레이어 UI | vue |
| `…/node` | 파일시스템 로더 | 없음 |
| `…/styles.css` | 스타일시트 | 없음 |
| `clotho` (CLI) | `clotho validate`, `clotho migrate` | 없음 |

코어는 프레임워크와 DOM에 의존하지 않는다. 이 불변식은 `bun run check:core-purity`로
CI에서 강제한다.

에디터는 별도 패키지 `clotho-editor`로 분리된다.

## 개발

```bash
bun install
bun test                    # 유닛 + 코퍼스 회귀
bun run typecheck
bun run lint
bun run check:core-purity   # 코어에 프레임워크/DOM 의존 유입 차단
bun run build
```

회귀 테스트는 실제 애니메이션 문서 383개를 픽스처로 쓴다. 저장소에 포함되지 않으므로
없으면 자동으로 건너뛴다. 위치는 `CLOTHO_CORPUS_DIR`로 지정한다.

## 라이선스

MIT
