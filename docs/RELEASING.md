# 배포 절차

`@kokoa/clotho`와 `@kokoa/clotho-editor`는 서로 독립된 npm package다. 처음 배포할 때는 clotho를 먼저 올리고 editor를 나중에 올린다. 아래 검증 명령은 npm registry를 변경하지 않으며 실제 상태를 바꾸는 명령은 `npm publish`뿐이다.

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

마지막 검사는 새 임시 project를 만든 뒤 완성된 tarball을 npm, Yarn, Bun으로 각각 설치하고 ES module을 import한다. pnpm도 같은 npm tarball을 사용하므로 필요하면 `pnpm add "$TARBALL"`로 확인할 수 있다.

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

editor는 `@kokoa/clotho`, React, React DOM을 peer dependency로 선언한다. 따라서 배포용 tarball에는 로컬 `file:` 경로가 들어가지 않으며 사용하는 project에서 React 버전을 선택할 수 있다.

## 3. GitHub Actions trusted publishing 설정

npm 패키지 설정의 **Trusted Publisher**에 다음 값을 한 번 등록한다.

- Provider: GitHub Actions
- Organization/user: `shinkeonkim`
- Repository: `clotho`
- Workflow: `publish.yml`
- Environment: `npm-production`
- Allowed action: `npm publish`

GitHub 저장소에도 `npm-production` environment를 만들고 필수 승인자를 지정한다. GitHub Release를 공개하면 workflow가 시작되지만 승인자가 허용하기 전에는 npm 업로드 단계로 넘어가지 않는다. 오랫동안 유지해야 하는 `NPM_TOKEN` 대신 OIDC를 사용하며 배포 출처를 확인할 수 있는 provenance도 함께 생성한다.

## 4. 실제 업로드

```bash
git tag v0.1.2
git push origin v0.1.2
# GitHub에서 v0.1.2 Release를 작성하고 Publish → environment 승인
```

tag와 `package.json`의 버전이 다르면 npm에 올리기 전에 workflow가 실패한다. npm에는 같은 버전을 다시 올릴 수 없으므로 수정 사항이 생기면 SemVer 규칙에 맞춰 버전을 올린다.

## 5. 브랜치 전략

현재 저장소 규모에는 Git Flow보다 trunk-based development가 알맞다.

- `main`: 언제든 배포할 수 있는 상태로 유지한다. 직접 push하지 못하도록 보호하고 CI 통과를 필수 조건으로 둔다.
- `feature/*`, `fix/*`: 작업 기간을 짧게 유지하고 Pull Request를 검토한 뒤 squash merge한다.
- 배포: `main`에서 검증을 마친 commit에 `vX.Y.Z` tag를 붙이고 GitHub Release를 공개한다.
- 오랫동안 유지하는 `develop` 또는 `release` branch는 만들지 않는다. 두 package가 함께 바뀌는 경우에만 Pull Request와 배포 순서를 맞춘다.

branch protection에는 한 명 이상의 승인, CI 통과, force push 금지, branch 삭제 금지를 설정하는 것이 좋다.

## 6. 공개 레지스트리 확인

```bash
npm view @kokoa/clotho version exports
npm view @kokoa/clotho-editor version peerDependencies
```

그 뒤 빈 프로젝트에서 README의 npm/yarn/pnpm/bun 설치 명령과 React·Vue·DOM 예제를 한 번씩 실행한다.
