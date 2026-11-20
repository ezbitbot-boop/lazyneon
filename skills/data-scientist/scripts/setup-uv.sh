#!/usr/bin/env bash
set -euo pipefail
# Setup only verifies. Installation and updates are explicit package-manager actions.
if command -v uv >/dev/null 2>&1; then
  uv --version
  exit 0
fi
if [[ "${LAZYNEON_OFFLINE:-0}" == "1" ]]; then
  printf '%s\n' '[setup-uv] offline: uv missing; no download attempted.'
else
  printf '%s\n' '[setup-uv] uv missing. Install with your package manager (brew install uv / pipx install uv), then rerun.'
fi
exit 1
