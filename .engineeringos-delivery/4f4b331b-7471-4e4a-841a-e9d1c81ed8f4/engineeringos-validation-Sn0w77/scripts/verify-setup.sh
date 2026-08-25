#!/usr/bin/env bash
# verify-setup.sh — smoke-checks that the post-import setup is complete.
# Run after: pnpm install, Clerk secrets provisioned, pnpm --filter @workspace/db run push
# Usage: bash scripts/verify-setup.sh

set -euo pipefail

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [ "$result" = "ok" ]; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label — $result"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "EngineeringOS — Setup Verification"
echo "==================================="

# 1. node_modules present (pnpm install ran)
if [ -d "node_modules" ]; then
  check "node_modules installed" "ok"
else
  check "node_modules installed" "missing — run: pnpm install"
fi

# 2. Clerk secrets set
for var in CLERK_SECRET_KEY CLERK_PUBLISHABLE_KEY VITE_CLERK_PUBLISHABLE_KEY; do
  if [ -n "${!var:-}" ]; then
    check "Secret: $var" "ok"
  else
    check "Secret: $var" "not set — provision via setupClerkWhitelabelAuth()"
  fi
done

# 3. DATABASE_URL set
if [ -n "${DATABASE_URL:-}" ]; then
  check "DATABASE_URL" "ok"
else
  check "DATABASE_URL" "not set — Replit PostgreSQL module must be enabled"
fi

# 4. API server reachable
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/healthz 2>/dev/null || echo "000")
if [ "$API_STATUS" = "200" ]; then
  check "API server /api/healthz → 200" "ok"
else
  check "API server /api/healthz → 200" "got HTTP $API_STATUS — start: pnpm --filter @workspace/api-server run dev"
fi

# 5. Dashboard reachable
DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:23183/dashboard/ 2>/dev/null || echo "000")
if [ "$DASH_STATUS" = "200" ]; then
  check "Dashboard /dashboard/ → 200" "ok"
else
  check "Dashboard /dashboard/ → 200" "got HTTP $DASH_STATUS — start: pnpm --filter @workspace/dashboard run dev"
fi

# 6. DB schema pushed (projects table exists)
if command -v psql &>/dev/null && [ -n "${DATABASE_URL:-}" ]; then
  TABLE_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='projects';" 2>/dev/null || echo "0")
  if [ "$TABLE_COUNT" = "1" ]; then
    check "DB schema pushed (projects table)" "ok"
  else
    check "DB schema pushed (projects table)" "missing — run: pnpm --filter @workspace/db run push"
  fi
else
  check "DB schema pushed (projects table)" "ok (skipped — psql not in PATH or DATABASE_URL unset)"
fi

echo ""
echo "Result: $PASS passed, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "See replit.md → 'Post-import setup' for fix instructions."
  exit 1
fi

echo "All checks passed. EngineeringOS is ready."
