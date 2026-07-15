#!/usr/bin/env bash
# CCLink Studio dev process controller.
#
# Usage:
#   ./scripts/restart.sh start     # start in background
#   ./scripts/restart.sh restart   # stop then start (default)
#   ./scripts/restart.sh stop      # stop background dev process
#   ./scripts/restart.sh status    # show process and recent logs
#   ./scripts/restart.sh logs      # follow logs

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${CCLINK_STUDIO_RUN_DIR:-${DEEPINK_RUN_DIR:-/tmp/cclink-studio-dev}}"
PID_FILE="$RUN_DIR/cclink-studio-dev.pid"
LOG_FILE="$RUN_DIR/cclink-studio-dev.log"
SCREEN_NAME="${CCLINK_STUDIO_SCREEN_NAME:-${DEEPINK_SCREEN_NAME:-cclink-studio-dev}}"
PORTS="${CCLINK_STUDIO_DEV_PORTS:-${DEEPINK_DEV_PORTS:-5173 5174}}"
START_TIMEOUT="${CCLINK_STUDIO_START_TIMEOUT:-${DEEPINK_START_TIMEOUT:-12}}"

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

mkdir -p "$RUN_DIR"

read_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$pid"
}

is_running() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

screen_session_exists() {
  command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -Eq "[0-9]+\\.${SCREEN_NAME}[[:space:]]"
}

find_project_electron_pids() {
  local pid args
  ps ax -o pid= -o command= | while read -r pid args; do
    [[ -n "${pid:-}" && -n "${args:-}" ]] || continue
    case "$args" in
      *"$ROOT_DIR"/node_modules/*/electron*/dist/Electron.app/Contents/MacOS/Electron\ .*)
        printf '%s\n' "$pid"
        ;;
    esac
  done
}

first_project_electron_pid() {
  find_project_electron_pids | head -n 1
}

kill_tree() {
  local pid="$1"
  local child

  while IFS= read -r child; do
    [[ -n "$child" ]] || continue
    kill_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)

  kill "$pid" 2>/dev/null || true
}

kill_tree_force() {
  local pid="$1"
  local child

  while IFS= read -r child; do
    [[ -n "$child" ]] || continue
    kill_tree_force "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)

  kill -9 "$pid" 2>/dev/null || true
}

cleanup_stale_project_processes() {
  local killed=0
  local pid args

  while IFS= read -r pid; do
    [[ -n "$pid" && "$pid" != "$$" ]] || continue
    kill_tree "$pid"
    killed=$((killed + 1))
  done < <(find_project_electron_pids)

  while IFS= read -r pid; do
    [[ -n "$pid" && "$pid" != "$$" ]] || continue
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    case "$args" in
      *"$ROOT_DIR"*electron-vite*dev*|*"$ROOT_DIR"*pnpm*dev*|*electron-vite*dev*CCLink\ Studio*)
        kill_tree "$pid"
        killed=$((killed + 1))
        ;;
    esac
  done < <(pgrep -f "electron-vite dev|pnpm dev" 2>/dev/null || true)

  if command -v lsof >/dev/null 2>&1; then
    local port
    for port in $PORTS; do
      while IFS= read -r pid; do
        [[ -n "$pid" && "$pid" != "$$" ]] || continue
        args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
        case "$args" in
          *"$ROOT_DIR"*|*electron-vite*|*vite*)
            kill_tree "$pid"
            killed=$((killed + 1))
            ;;
          *)
            warn "Port $port is occupied by non-CCLink Studio process PID $pid, skip"
            ;;
        esac
      done < <(lsof -ti :"$port" 2>/dev/null || true)
    done
  fi

  if [[ "$killed" -gt 0 ]]; then
    sleep 1
    ok "Cleaned $killed stale process(es)"
  fi
}

stop_app() {
  local pid
  if screen_session_exists; then
    info "Stopping screen session $SCREEN_NAME"
    screen -S "$SCREEN_NAME" -X quit 2>/dev/null || true
    sleep 1
  fi

  if pid="$(read_pid)"; then
    if is_running "$pid"; then
      info "Stopping CCLink Studio dev process PID $pid"
      kill_tree "$pid"
      sleep 1
      if is_running "$pid"; then
        warn "Process still alive, forcing PID $pid"
        kill_tree_force "$pid"
      fi
      ok "Stopped"
    else
      warn "PID file exists but process is gone"
    fi
    rm -f "$PID_FILE"
  else
    warn "No recorded CCLink Studio dev process"
  fi

  cleanup_stale_project_processes
}

start_app() {
  local pid
  if pid="$(read_pid)" && is_running "$pid"; then
    ok "CCLink Studio is already running, PID $pid"
    printf "Log: %s\n" "$LOG_FILE"
    return 0
  fi

  if pid="$(first_project_electron_pid)" && [[ -n "$pid" ]] && is_running "$pid"; then
    printf '%s\n' "$pid" > "$PID_FILE"
    ok "CCLink Studio is already running, PID $pid"
    printf "Log: %s\n" "$LOG_FILE"
    return 0
  fi

  rm -f "$PID_FILE"
  : > "$LOG_FILE"

  info "Starting CCLink Studio dev server in background"
  if command -v screen >/dev/null 2>&1; then
    screen -dmS "$SCREEN_NAME" bash -lc '
      cd "$1"
      printf "%s\n" "$$" > "$2"
      exec >>"$3" 2>&1
      unset ELECTRON_RUN_AS_NODE
      exec pnpm dev
    ' _ "$ROOT_DIR" "$PID_FILE" "$LOG_FILE"
    sleep 1
    pid="$(read_pid || true)"
  else
    nohup bash -c '
      cd "$1"
      printf "%s\n" "$$" > "$2"
      unset ELECTRON_RUN_AS_NODE
      exec pnpm dev
    ' _ "$ROOT_DIR" "$PID_FILE" >>"$LOG_FILE" 2>&1 &
    pid="$!"
    printf '%s\n' "$pid" > "$PID_FILE"
  fi

  [[ -n "${pid:-}" ]] || die "Failed to create launcher PID file"

  local waited=0
  while [[ "$waited" -lt "$START_TIMEOUT" ]]; do
    local electron_pid
    electron_pid="$(first_project_electron_pid || true)"
    if [[ -n "$electron_pid" ]] && is_running "$electron_pid"; then
      printf '%s\n' "$electron_pid" > "$PID_FILE"
      ok "CCLink Studio started, PID $electron_pid"
      printf "Log: %s\n" "$LOG_FILE"
      return 0
    fi

    if grep -qE "built in|Local:" "$LOG_FILE" 2>/dev/null; then
      if is_running "$pid"; then
        ok "CCLink Studio launcher is running, PID $pid"
        printf "Log: %s\n" "$LOG_FILE"
        return 0
      fi
    fi

    sleep 1
    waited=$((waited + 1))
  done

  if is_running "$pid"; then
    ok "CCLink Studio launcher is running, PID $pid"
    printf "Log: %s\n" "$LOG_FILE"
    return 0
  fi

  rm -f "$PID_FILE"
  warn "CCLink Studio did not stay running"
  tail -40 "$LOG_FILE" || true
  return 1
}

restart_app() {
  stop_app
  start_app
}

show_status() {
  local pid
  if pid="$(read_pid)" && is_running "$pid"; then
    ok "CCLink Studio is running, PID $pid"
  elif pid="$(first_project_electron_pid)" && [[ -n "$pid" ]] && is_running "$pid"; then
    printf '%s\n' "$pid" > "$PID_FILE"
    ok "CCLink Studio is running, PID $pid"
  else
    warn "CCLink Studio is not running"
    rm -f "$PID_FILE"
  fi

  printf "Run dir: %s\n" "$RUN_DIR"
  printf "Screen: %s\n" "$SCREEN_NAME"
  printf "Log: %s\n" "$LOG_FILE"
  if [[ -f "$LOG_FILE" ]]; then
    printf "\nRecent logs:\n"
    tail -20 "$LOG_FILE" || true
  fi
}

follow_logs() {
  touch "$LOG_FILE"
  info "Following $LOG_FILE"
  tail -f "$LOG_FILE"
}

print_usage() {
  cat <<EOF
Usage: ./scripts/restart.sh [start|restart|stop|status|logs]

Environment:
  CCLINK_STUDIO_RUN_DIR        Runtime dir. Default: /tmp/cclink-studio-dev
  CCLINK_STUDIO_SCREEN_NAME    screen session name. Default: cclink-studio-dev
  CCLINK_STUDIO_DEV_PORTS      Ports to clean on stop. Default: 5173 5174
  CCLINK_STUDIO_START_TIMEOUT  Startup wait seconds. Default: 12

Legacy DEEPINK_RUN_DIR / DEEPINK_SCREEN_NAME / DEEPINK_DEV_PORTS / DEEPINK_START_TIMEOUT are still accepted.
EOF
}

case "${1:-restart}" in
  start) start_app ;;
  restart) restart_app ;;
  stop) stop_app ;;
  status) show_status ;;
  log | logs) follow_logs ;;
  -h | --help | help) print_usage ;;
  *) print_usage; die "Unknown command: $1" ;;
esac
