#!/usr/bin/env bash
# Fast iOS build from repo root (skip git pull).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/app"
exec npm run ios:fast
