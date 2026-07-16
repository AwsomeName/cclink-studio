#!/usr/bin/env bash
# CCLink Studio local test-drive entrypoint.
#
# Usage:
#   bash scripts/studio.sh start          # install deps if needed, restart dev app, show status
#   bash scripts/studio.sh status         # show background dev app status
#   bash scripts/studio.sh logs           # follow background dev app logs
#   bash scripts/studio.sh stop           # stop background dev app
#   bash scripts/studio.sh smoke          # run standalone smoke gate
#   bash scripts/studio.sh package        # build local mac package for current host arch
#   bash scripts/studio.sh package:arm64  # build Apple Silicon package
#   bash scripts/studio.sh package:x64    # build Intel package

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CYAN='\033[36m'
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
RESET='\033[0m'

info() { printf "${CYAN}[CCLink Studio]${RESET} %s\n" "$1"; }
ok() { printf "${GREEN}[CCLink Studio]${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}[CCLink Studio]${RESET} %s\n" "$1"; }
die() {
  printf "${RED}[CCLink Studio]${RESET} %s\n" "$1"
  exit 1
}

usage() {
  sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//'
}

ensure_pnpm() {
  command -v pnpm >/dev/null 2>&1 || die "pnpm is required. Install pnpm 9+ first."
}

ensure_deps() {
  ensure_pnpm
  if [[ ! -d node_modules ]]; then
    info "node_modules not found; running pnpm install"
    pnpm install
    ok "dependencies installed"
  fi
}

start_app() {
  ensure_deps
  info "starting local dev app"
  bash scripts/restart.sh restart
  echo ""
  bash scripts/restart.sh status
  echo ""
  ok "CCLink Studio is starting. Use: bash scripts/studio.sh logs"
}

case "${1:-start}" in
  start)
    start_app
    ;;
  status)
    bash scripts/restart.sh status
    ;;
  logs)
    bash scripts/restart.sh logs
    ;;
  stop)
    bash scripts/restart.sh stop
    ;;
  smoke)
    ensure_deps
    pnpm smoke:standalone
    ;;
  package)
    ensure_deps
    bash scripts/package.sh
    ;;
  package:arm64)
    ensure_deps
    bash scripts/package.sh --arm64
    ;;
  package:x64)
    ensure_deps
    bash scripts/package.sh --x64
    ;;
  package:universal)
    ensure_deps
    bash scripts/package.sh --universal
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage
    die "unknown command: $1"
    ;;
esac
