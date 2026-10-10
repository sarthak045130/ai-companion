#!/usr/bin/env bash
# One-time setup: creates .venv, installs dependencies, checks Ollama.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Python 3 was not found. Install it from https://www.python.org/downloads/ or with: brew install python" >&2
  exit 1
fi
"$PY" - <<'EOF' || { echo "Python 3.10 or newer is required." >&2; exit 1; }
import sys
sys.exit(0 if sys.version_info >= (3, 10) else 1)
EOF

echo "==> Creating virtual environment (.venv)"
"$PY" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null

echo "==> Installing dependencies (this can take a few minutes the first time)"
python -m pip install numpy
for pkg in pywebview sounddevice faster-whisper; do
  python -m pip install "$pkg" || echo "   (!) Couldn't install $pkg. The app still runs; the related feature will be disabled."
done

echo "==> Checking Ollama"
if command -v ollama >/dev/null 2>&1; then
  echo "   Ollama found: $(ollama --version 2>/dev/null | head -n1)"
else
  echo "   (!) Ollama isn't installed. Get it from https://ollama.com/download"
fi
if curl -fsS -m 3 http://localhost:11434/api/version >/dev/null 2>&1; then
  echo "   Ollama is running. Installed models:"
  curl -fsS -m 5 http://localhost:11434/api/tags | python -c "import sys,json; [print('    -', m['name']) for m in json.load(sys.stdin).get('models', [])]"
else
  echo "   (!) Ollama isn't running. Open the Ollama app or run: ollama serve"
fi
echo "   For meaning-based memory recall, also run once: ollama pull nomic-embed-text"

echo
echo "Setup done. Verify against your real Ollama:  ./scripts/smoke_test.py"
echo "Start the app:                                ./scripts/run.sh"
