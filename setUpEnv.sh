#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

log "Bootstrapping DeepAgentTemplate from: $ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  fail "bun is not installed or not on PATH. Install bun first, then rerun this script."
fi

TMP_DIR="$(mktemp -d /private/tmp/deep-agent-template-bun.XXXXXX)"
CACHE_DIR="$TMP_DIR/cache"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
mkdir -p "$CACHE_DIR"
export TMPDIR="$TMP_DIR"
export TMP="$TMP_DIR"
export TEMP="$TMP_DIR"
export BUN_TMPDIR="$TMP_DIR"
export BUN_INSTALL_CACHE_DIR="$CACHE_DIR"

log "Installing dependencies with bun..."
bun install --ignore-scripts --cache-dir="$CACHE_DIR"

if [ -f ".env" ]; then
  log ".env already exists; leaving it unchanged."
else
  if [ ! -f ".env.example" ]; then
    fail ".env.example is missing, so .env cannot be seeded."
  fi

  cp ".env.example" ".env"
  log "Created .env from .env.example."
fi

if [ -f ".git/config" ] && [ -w ".git/config" ]; then
  log "Configuring Git hooks with Husky..."
  if bun run prepare; then
    log "Husky hooks configured."
  else
    log "Warning: Husky setup failed; continuing without Git hooks."
  fi
else
  log "Skipping Husky setup because .git/config is not writable here."
fi

log "Bootstrap complete."
log "Next step: add your local secrets before running live agent flows."
log "Live usage options:"
log "  - OpenAI-compatible endpoint: set LLM_BASE_URL and LLM_API_KEY"
log "  - Or OpenRouter: set LLM_API_KEY (without LLM_BASE_URL)"
log "Optional tracing: set LANGSMITH_API_KEY and LANGSMITH_TRACING=true."
