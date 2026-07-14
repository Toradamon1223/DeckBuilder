#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export POKECA_BASE_PATH="${POKECA_BASE_PATH:-/DeckBuilder}"
export POKECA_COOKIE_SECURE="${POKECA_COOKIE_SECURE:-1}"
exec python3 web/server.py --host "${HOST:-127.0.0.1}" --port "${PORT:-8080}"
