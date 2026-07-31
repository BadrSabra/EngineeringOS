---
name: Project bootstrap checklist
description: Two mandatory steps to run after importing this project into a fresh Replit environment.
---

# Post-import bootstrap (EngineeringOS)

**Why:** The repo ships no DB snapshot and no Clerk secrets. Both are needed before the server starts cleanly.

## Steps (in order)

1. **Push the DB schema**
   ```
   pnpm --filter @workspace/db run push
   ```
   Fixes: `relation "scan_jobs" does not exist` on startup.

2. **Provision Clerk** (in CodeExecution sandbox)
   ```js
   const result = await setupClerkWhitelabelAuth();
   ```
   Sets `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`.
   Fixes: `Missing Clerk Secret Key` crash on every request.

**How to apply:** Run these immediately after `pnpm install` and before starting workflows. The codebase already has all Clerk integration code — no code changes needed.
