#!/usr/bin/env bash
set -euo pipefail

node scripts/api-only-smoke-container-preflight.mjs
mkdir -p "$HOME" /tmp/npm-cache
pnpm install --offline --frozen-lockfile
ENGINEERINGOS_API_ONLY_SMOKE_DISPOSABLE_CHECKOUT=1 pnpm run validate:api-only-smoke
