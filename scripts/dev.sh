#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -s)" == "Darwin" ]]; then
  export ELECTRON_EXEC_PATH
  ELECTRON_EXEC_PATH="$(node "$ROOT_DIR/scripts/prepare-dev-electron.mjs")"
fi

unset ELECTRON_RUN_AS_NODE
exec "$ROOT_DIR/node_modules/.bin/electron-vite" dev "$@"
