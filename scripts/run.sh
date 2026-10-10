#!/usr/bin/env bash
# Starts the desktop app. Extra arguments are passed through (e.g. --no-window, --data-dir PATH).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d .venv ]; then
  echo "Run ./scripts/setup.sh first." >&2
  exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate
exec python -m app "$@"
