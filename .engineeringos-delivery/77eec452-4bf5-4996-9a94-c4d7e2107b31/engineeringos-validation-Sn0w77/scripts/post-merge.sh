#!/bin/bash
# post-merge.sh — runs automatically after task-agent merges (see [postMerge] in .replit)
# Also run manually after a fresh import or clone to bring the environment up.
#
# What this does NOT cover (one-time manual steps on a fresh Replit import):
#   1. Clerk auth secrets — provisioned via setupClerkWhitelabelAuth() in the
#      Replit Agent code-execution sandbox. Required secrets:
#        CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, VITE_CLERK_PUBLISHABLE_KEY
#   2. SESSION_SECRET — set once as a Replit Secret (any strong random string).
#      DATABASE_URL is runtime-managed by Replit; do not set it manually.
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
