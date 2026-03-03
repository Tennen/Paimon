#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS (Darwin)." >&2
  exit 1
fi

usage() {
  cat <<'EOF'
Usage:
  tools/llama-server-daemon-macos.sh <start|stop|restart|status|print-plist> [options]

Options (for start/restart):
  --model <path>         GGUF model path (required unless LLAMA_SERVER_MODEL_PATH is set)
  --host <host>          Bind host, default 127.0.0.1
  --port <port>          Bind port, default 8080
  --ctx-size <n>         Context size, default 32768
  --threads <n>          Threads, default 8
  --parallel <n>         Parallel requests, default 1
  --alias <name>         OpenAI-compatible model alias
  --bin <path>           llama-server executable path
  --label <name>         launchd label, default com.paimon.llama-server
  --stdout <path>        stdout log path, default /dev/null when silent=true
  --stderr <path>        stderr log path, default /dev/null when silent=true
  --silent <true|false>  whether to mute logs, default true
  --extra-arg <arg>      extra llama-server arg (repeatable)

Env equivalents:
  LLAMA_SERVER_MODEL_PATH, LLAMA_SERVER_HOST, LLAMA_SERVER_PORT, LLAMA_SERVER_CTX_SIZE
  LLAMA_SERVER_THREADS, LLAMA_SERVER_PARALLEL, LLAMA_SERVER_ALIAS, LLAMA_SERVER_BIN
  LLAMA_SERVER_LABEL, LLAMA_SERVER_STDOUT_PATH, LLAMA_SERVER_STDERR_PATH, LLAMA_SERVER_SILENT
  LLAMA_SERVER_EXTRA_ARGS (space-split)
EOF
}

expand_path() {
  local value="$1"
  if [[ "$value" == "~" ]]; then
    printf '%s\n' "$HOME"
    return
  fi
  if [[ "$value" == "~/"* ]]; then
    printf '%s/%s\n' "$HOME" "${value#~/}"
    return
  fi
  printf '%s\n' "$value"
}

xml_escape() {
  local value="$1"
  value=${value//&/&amp;}
  value=${value//</&lt;}
  value=${value//>/&gt;}
  value=${value//\"/&quot;}
  value=${value//\'/&apos;}
  printf '%s' "$value"
}

shell_join() {
  local out=""
  local token=""
  for token in "$@"; do
    local quoted
    quoted=$(printf '%q' "$token")
    if [[ -z "$out" ]]; then
      out="$quoted"
    else
      out="$out $quoted"
    fi
  done
  printf '%s' "$out"
}

resolve_binary() {
  if [[ -n "${LLAMA_SERVER_BIN:-}" ]]; then
    if [[ -x "$LLAMA_SERVER_BIN" ]]; then
      printf '%s\n' "$LLAMA_SERVER_BIN"
      return
    fi
    echo "llama-server binary is not executable: $LLAMA_SERVER_BIN" >&2
    exit 1
  fi

  local from_path
  from_path="$(command -v llama-server 2>/dev/null || true)"
  if [[ -n "$from_path" && -x "$from_path" ]]; then
    printf '%s\n' "$from_path"
    return
  fi
  if [[ -x "/opt/homebrew/bin/llama-server" ]]; then
    printf '%s\n' "/opt/homebrew/bin/llama-server"
    return
  fi
  if [[ -x "/usr/local/bin/llama-server" ]]; then
    printf '%s\n' "/usr/local/bin/llama-server"
    return
  fi

  echo "Cannot find llama-server binary. Set --bin or LLAMA_SERVER_BIN." >&2
  exit 1
}

ensure_parent_dir() {
  local file_path="$1"
  if [[ "$file_path" == "/dev/null" ]]; then
    return
  fi
  mkdir -p "$(dirname "$file_path")"
}

require_option_value() {
  local option_name="$1"
  if [[ $# -lt 2 || -z "${2:-}" ]]; then
    echo "Missing value for $option_name" >&2
    exit 1
  fi
}

ACTION="${1:-}"
if [[ -z "$ACTION" ]]; then
  usage
  exit 1
fi
shift || true

SERVICE_LABEL="${LLAMA_SERVER_LABEL:-com.paimon.llama-server}"
MODEL_PATH="${LLAMA_SERVER_MODEL_PATH:-}"
LLAMA_SERVER_HOST="${LLAMA_SERVER_HOST:-127.0.0.1}"
LLAMA_SERVER_PORT="${LLAMA_SERVER_PORT:-8080}"
LLAMA_SERVER_CTX_SIZE="${LLAMA_SERVER_CTX_SIZE:-32768}"
LLAMA_SERVER_THREADS="${LLAMA_SERVER_THREADS:-8}"
LLAMA_SERVER_PARALLEL="${LLAMA_SERVER_PARALLEL:-1}"
LLAMA_SERVER_ALIAS="${LLAMA_SERVER_ALIAS:-}"
LLAMA_SERVER_SILENT="${LLAMA_SERVER_SILENT:-true}"
LLAMA_SERVER_STDOUT_PATH="${LLAMA_SERVER_STDOUT_PATH:-}"
LLAMA_SERVER_STDERR_PATH="${LLAMA_SERVER_STDERR_PATH:-}"

declare -a EXTRA_ARGS=()
if [[ -n "${LLAMA_SERVER_EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS+=( ${LLAMA_SERVER_EXTRA_ARGS} )
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      require_option_value "$1" "${2:-}"
      MODEL_PATH="$2"
      shift 2
      ;;
    --host)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_HOST="$2"
      shift 2
      ;;
    --port)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_PORT="$2"
      shift 2
      ;;
    --ctx-size)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_CTX_SIZE="$2"
      shift 2
      ;;
    --threads)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_THREADS="$2"
      shift 2
      ;;
    --parallel)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_PARALLEL="$2"
      shift 2
      ;;
    --alias)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_ALIAS="$2"
      shift 2
      ;;
    --bin)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_BIN="$2"
      shift 2
      ;;
    --label)
      require_option_value "$1" "${2:-}"
      SERVICE_LABEL="$2"
      shift 2
      ;;
    --stdout)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_STDOUT_PATH="$2"
      shift 2
      ;;
    --stderr)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_STDERR_PATH="$2"
      shift 2
      ;;
    --silent)
      require_option_value "$1" "${2:-}"
      LLAMA_SERVER_SILENT="$2"
      shift 2
      ;;
    --extra-arg)
      require_option_value "$1" "${2:-}"
      EXTRA_ARGS+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$LLAMA_SERVER_STDOUT_PATH" ]]; then
  if [[ "$LLAMA_SERVER_SILENT" == "true" ]]; then
    LLAMA_SERVER_STDOUT_PATH="/dev/null"
  else
    LLAMA_SERVER_STDOUT_PATH="$HOME/.llm/logs/llama-server.stdout.log"
  fi
fi
if [[ -z "$LLAMA_SERVER_STDERR_PATH" ]]; then
  if [[ "$LLAMA_SERVER_SILENT" == "true" ]]; then
    LLAMA_SERVER_STDERR_PATH="/dev/null"
  else
    LLAMA_SERVER_STDERR_PATH="$HOME/.llm/logs/llama-server.stderr.log"
  fi
fi

WORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENT_DIR/$SERVICE_LABEL.plist"
BOOTSTRAP_TARGET="gui/$UID"
SERVICE_TARGET="$BOOTSTRAP_TARGET/$SERVICE_LABEL"

write_plist() {
  local bin_path="$1"
  mkdir -p "$LAUNCH_AGENT_DIR"
  ensure_parent_dir "$LLAMA_SERVER_STDOUT_PATH"
  ensure_parent_dir "$LLAMA_SERVER_STDERR_PATH"

  local launch_model_path
  launch_model_path="$(expand_path "$MODEL_PATH")"
  local -a cmd=(
    "$bin_path"
    "--model" "$launch_model_path"
    "--host" "$LLAMA_SERVER_HOST"
    "--port" "$LLAMA_SERVER_PORT"
    "--ctx-size" "$LLAMA_SERVER_CTX_SIZE"
    "--threads" "$LLAMA_SERVER_THREADS"
    "--parallel" "$LLAMA_SERVER_PARALLEL"
  )
  if [[ -n "$LLAMA_SERVER_ALIAS" ]]; then
    cmd+=("--alias" "$LLAMA_SERVER_ALIAS")
  fi
  if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
    cmd+=("${EXTRA_ARGS[@]}")
  fi

  local command_line
  command_line="$(shell_join "${cmd[@]}")"

  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$(xml_escape "$SERVICE_LABEL")</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>-lc</string>
      <string>$(xml_escape "$command_line")</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$(xml_escape "$WORK_DIR")</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>$(xml_escape "$(expand_path "$LLAMA_SERVER_STDOUT_PATH")")</string>
    <key>StandardErrorPath</key>
    <string>$(xml_escape "$(expand_path "$LLAMA_SERVER_STDERR_PATH")")</string>
  </dict>
</plist>
EOF
}

start_service() {
  if [[ -z "$MODEL_PATH" ]]; then
    echo "Missing model path. Use --model or LLAMA_SERVER_MODEL_PATH." >&2
    exit 1
  fi
  MODEL_PATH="$(expand_path "$MODEL_PATH")"
  if [[ ! -f "$MODEL_PATH" ]]; then
    echo "Model file does not exist: $MODEL_PATH" >&2
    exit 1
  fi

  local bin_path
  bin_path="$(resolve_binary)"
  write_plist "$bin_path"

  launchctl bootout "$SERVICE_TARGET" >/dev/null 2>&1 || true
  launchctl bootstrap "$BOOTSTRAP_TARGET" "$PLIST_PATH"
  launchctl enable "$SERVICE_TARGET" >/dev/null 2>&1 || true
  launchctl kickstart -k "$SERVICE_TARGET"

  echo "llama-server started via launchd: $SERVICE_TARGET"
  echo "plist: $PLIST_PATH"
  echo "base_url: http://$LLAMA_SERVER_HOST:$LLAMA_SERVER_PORT"
}

stop_service() {
  launchctl bootout "$SERVICE_TARGET" >/dev/null 2>&1 || true
  echo "llama-server stopped: $SERVICE_TARGET"
}

status_service() {
  if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    launchctl print "$SERVICE_TARGET" | sed -n '1,80p'
    return
  fi
  echo "llama-server is not loaded: $SERVICE_TARGET" >&2
  exit 1
}

print_plist() {
  if [[ ! -f "$PLIST_PATH" ]]; then
    echo "plist not found: $PLIST_PATH" >&2
    exit 1
  fi
  cat "$PLIST_PATH"
}

case "$ACTION" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    start_service
    ;;
  status)
    status_service
    ;;
  print-plist)
    print_plist
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    usage
    exit 1
    ;;
esac
