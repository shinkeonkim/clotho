# clotho

JSON으로 정의하는 시각화 애니메이션 패키지.

애니메이션을 명령형 코드가 아니라 **선언적 JSON 문서**로 기술한다. 시각 상태는 오직
`(문서, 시각 t)`의 순수 함수이므로 임의 시점 seek, 정지 프레임 렌더, 에디터 스크럽이
모두 같은 경로로 처리된다.

```jsonc
{
  "version": 4,
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
        { "property": "fill", "keyframes": [
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

**개발 초기.** 현재 저장소에는 조사 결과·설계·작업 계획과 프로젝트 골격만 있다.
코어 구현은 진행 중이다.

- 조사: [`docs/RESEARCH.md`](./docs/RESEARCH.md)
- 설계: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- 계획: [`TASKS.md`](./TASKS.md)

## 예정 구조

| 진입점 | 내용 |
| --- | --- |
| `clotho` | 스키마, 런타임, 타이밍, 기하, 검증, 마이그레이션 (프레임워크 무관) |
| `clotho/react` | SVG 렌더러, 엔진, 플레이어 UI |
| `clotho/node` | 파일시스템 로더 |
| `clotho/styles.css` | 스타일시트 |
| `clotho` (CLI) | `clotho validate`, `clotho migrate` |

에디터는 별도 패키지 `clotho-editor`로 분리된다.

## 개발

```bash
bun install
bun test          # 유닛 + 코퍼스 회귀
bun run typecheck
bun run lint
bun run build
```

회귀 테스트는 실제 애니메이션 문서 383개를 픽스처로 쓴다. 저장소에 포함되지 않으므로
없으면 자동으로 건너뛴다. 위치는 `CLOTHO_CORPUS_DIR`로 지정한다.

## 라이선스

MIT
