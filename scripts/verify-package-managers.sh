#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$ROOT"
bun run build
npm pack --pack-destination "$WORK" >/dev/null
TARBALL="$(find "$WORK" -maxdepth 1 -name 'kokoa-clotho-*.tgz' -print -quit)"

for manager in npm yarn bun; do
  PROJECT="$WORK/$manager"
  mkdir -p "$PROJECT"
  cd "$PROJECT"
  case "$manager" in
    npm) npm init -y >/dev/null; npm install --ignore-scripts "$TARBALL" >/dev/null ;;
    yarn) yarn init -y >/dev/null; yarn add --ignore-scripts "$TARBALL" >/dev/null ;;
    bun) bun init -y >/dev/null; bun add --ignore-scripts "$TARBALL" >/dev/null ;;
  esac
  node --input-type=module -e "import('@kokoa/clotho').then(m => { if (typeof m.parseDocument !== 'function') process.exit(1) })"
  echo "$manager install OK"
done
