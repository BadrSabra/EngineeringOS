---
name: Imported project missing Clerk secrets
description: Symptom pattern when an imported/forked project's code already wires Clerk but CLERK_SECRET_KEY etc. were never provisioned in this environment.
---

Symptom: nearly every API test/route 500s with `Error: Missing Clerk Secret Key`, thrown from `clerkMiddleware` itself (mounted before any route/auth-bypass logic) — not from `requireAuth`. The existing test-mode bypass in `requireAuth` (gated on `NODE_ENV=test`) cannot help because the crash happens one middleware earlier, unconditionally, for every request.

**Why:** Replit-managed Clerk secrets (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`) are not committed/copied on import — `replit.md` for this project explicitly documents this. The app code (proxy middleware, app.ts wiring) was already fully set up; only the secrets were missing.

**How to apply:** before assuming a test/auth failure is a real bug, run `checkClerkManagementStatus()` — if `not_configured`, call `setupClerkWhitelabelAuth()` to provision the three env vars, then restart the affected workflow(s) and re-run. Don't try to work around it by mocking Clerk in tests or adding NODE_ENV gates to `clerkMiddleware` — that would diverge dev/test behavior from prod for no reason.
