#!/usr/bin/env bash
set -Eeuo pipefail

cd /workspace
mkdir -p "$HOME" /tmp/npm-cache

chromium_path="$(
  pnpm --filter @workspace/dashboard exec node -e \
    'process.stdout.write(require("@playwright/test").chromium.executablePath())'
)"
if [[ ! -x "$chromium_path" ]]; then
  echo "The pinned Playwright Chromium executable is unavailable." >&2
  exit 1
fi

export CI=true
export DASHBOARD_E2E_GREP=UXW-01
export DASHBOARD_E2E_BROWSER=chromium
export DASHBOARD_E2E_EXECUTABLE_PATH="$chromium_path"
pnpm run validate:dashboard-protected-visual
