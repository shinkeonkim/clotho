# 배포 절차

`@kokoa/clotho`와 `@kokoa/clotho-editor`는 각각 독립 npm 패키지다. 첫 배포는
clotho를 먼저 올리고 editor를 뒤에 올린다. 실제 `npm publish`만 외부 상태를 변경하므로
아래 검증은 업로드 전까지 안전하게 실행할 수 있다.

## 1. clotho 검증

```bash
cd clotho
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run check:core-purity
bun run check:styles
bun run check:size
bun run schema:check
bun run release:check
bash scripts/verify-package-managers.sh
npm publish --dry-run --access public
```

마지막 설치 행렬은 만든 tarball을 npm, Yarn, Bun으로 각각 새 임시 프로젝트에 설치하고
ES module import까지 실행한다. pnpm도 표준 npm tarball을 사용하며 필요하면
`pnpm add "$TARBALL"`로 같은 방식으로 확인할 수 있다.

## 2. editor 검증

```bash
cd ../clotho-editor
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bun run release:check
npm publish --dry-run --access public
```

editor는 `@kokoa/clotho`, React, React DOM을 peer dependency로 선언한다. 따라서
배포 tarball에 로컬 `file:` 경로가 새지 않으며 소비 프로젝트가 사용할 React 버전을
고를 수 있다.

## 3. 실제 업로드

```bash
cd clotho
npm publish --access public
cd ../clotho-editor
npm publish --access public
```

업로드 전에 `npm whoami`, 2FA, 패키지 scope 권한을 확인한다. 같은 버전은 다시 올릴 수
없으므로 수정이 생기면 SemVer에 맞춰 두 패키지의 버전과 editor의 clotho peer 범위를
함께 갱신한다.

## 4. 공개 레지스트리 확인

```bash
npm view @kokoa/clotho version exports
npm view @kokoa/clotho-editor version peerDependencies
```

그 뒤 빈 프로젝트에서 README의 npm/yarn/pnpm/bun 설치 명령과 React·Vue·DOM 예제를
한 번씩 실행한다.
