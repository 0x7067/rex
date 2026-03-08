#!/usr/bin/env bash
set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "rex preflight is currently documented for macOS only."
  exit 1
fi

REX_HOME_DIR="${REX_HOME:-$HOME/.rex}"
FAILURES=0

pass() {
  printf '[pass] %s\n' "$1"
}

note() {
  printf '[note] %s\n' "$1"
}

fail() {
  printf '[fail] %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

check_command() {
  local command_name="$1"
  local success_message="$2"
  local failure_message="$3"

  if command -v "$command_name" >/dev/null 2>&1; then
    pass "$success_message"
  else
    fail "$failure_message"
  fi
}

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$NODE_MAJOR" -ge 20 ]]; then
    pass "Node.js $(node --version) is supported."
  else
    fail "Node.js $(node --version) is too old. Install Node.js 20 or newer."
  fi
else
  fail "Node.js is not installed. Install Node.js 20 or newer."
fi

check_command "npm" "npm is available." "npm is missing from PATH."
check_command "claude" "Claude Code CLI is available." "Claude Code CLI is missing from PATH."

if command -v ollama >/dev/null 2>&1; then
  if ! OLLAMA_LIST="$(ollama list 2>/dev/null)"; then
    note "Ollama is installed, but the local service is unreachable. Start Ollama if you want the Ollama answer-provider path."
  elif printf '%s\n' "$OLLAMA_LIST" | grep -q 'nomic-embed-text'; then
    pass "Ollama has the nomic-embed-text model available for the Ollama answer-provider path."
  else
    note "Ollama is installed, but nomic-embed-text is missing. Run: ollama pull nomic-embed-text if you want the Ollama answer-provider path."
  fi
else
  note "Ollama is optional for the default onboarding path."
fi

if mkdir -p "$REX_HOME_DIR" && touch "$REX_HOME_DIR/.write-test"; then
  rm -f "$REX_HOME_DIR/.write-test"
  pass "REX_HOME is writable at $REX_HOME_DIR."
else
  fail "REX_HOME is not writable at $REX_HOME_DIR."
fi

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "Preflight passed."
  echo "Next steps:"
  echo "  npm install -g @denguinho/rex@alpha"
  echo "  rex add ./some-project"
  echo '  rex ask "How does the sync pipeline work?"'
else
  echo "Preflight found $FAILURES issue(s). Fix them before onboarding teammates."
  exit 1
fi
