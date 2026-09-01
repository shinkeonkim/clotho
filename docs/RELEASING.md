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

## 3. GitHub Actions trusted publishing 설정

npm 패키지 설정의 **Trusted Publisher**에 다음 값을 한 번 등록한다.

- Provider: GitHub Actions
- Organization/user: `shinkeonkim`
- Repository: `clotho`
- Workflow: `publish.yml`
- Environment: `npm-production`
- Allowed action: `npm publish`

GitHub 저장소에도 `npm-production` environment를 만들고 required reviewer를 설정한다.
워크플로는 GitHub Release가 publish될 때 시작되지만, 승인 전에는 npm 업로드 단계로
진행하지 않는다. 장기 `NPM_TOKEN`은 사용하지 않으며 OIDC와 provenance를 사용한다.

## 4. 실제 업로드

```bash
git tag v0.1.2
git push origin v0.1.2
# GitHub에서 v0.1.2 Release를 작성하고 Publish → environment 승인
```

태그와 `package.json` 버전이 다르면 workflow가 publish 전에 실패한다. 같은 버전은 다시
올릴 수 없으므로 수정이 생기면 SemVer에 맞춰 버전을 갱신한다.

## 5. 브랜치 전략

이 규모에서는 Git Flow보다 trunk-based 흐름을 사용한다.

- `main`: 항상 릴리스 가능한 보호 브랜치. 직접 push를 막고 CI 필수화
- `feature/*`, `fix/*`: 짧게 유지하고 PR + squash merge
- 릴리스: `main`의 검증된 commit에 `vX.Y.Z` 태그와 GitHub Release
- 긴 `develop`/`release` 브랜치는 두지 않는다. 두 패키지 간 호환 변경만 PR과 릴리스
  순서로 조율한다.

권장 branch protection은 최소 1명 승인, CI check 필수, force push와 branch 삭제 금지다.

## 6. 공개 레지스트리 확인

```bash
npm view @kokoa/clotho version exports
npm view @kokoa/clotho-editor version peerDependencies
```

그 뒤 빈 프로젝트에서 README의 npm/yarn/pnpm/bun 설치 명령과 React·Vue·DOM 예제를
한 번씩 실행한다.
