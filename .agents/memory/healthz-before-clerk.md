---
name: Health route must precede Clerk middleware
description: Deployment healthcheck returns 500 if clerkMiddleware is registered before the health router, because Clerk throws "Missing Clerk Secret Key" on every request when CLERK_SECRET_KEY is absent.
---

**Rule:** Register `app.use("/api", healthRouter)` and the `Cache-Control` middleware for `/api` **before** the `clerkMiddleware` block in `app.ts`. The health route must respond 200 regardless of Clerk configuration state.

**Why:** `clerkMiddleware` calls `assertValidSecretKey()` synchronously on every request — including `/api/healthz`. In a fresh deployment that hasn't been provisioned with Clerk secrets yet, this throws and the Express error handler returns 500 before the health handler is ever reached. The deployment platform's health probe sees a 500 and marks the deployment as failed.

**How to apply:** In `app.ts`, the order must be:
1. Clerk proxy path (streaming, must be first)
2. Security middleware (helmet, rate-limit, pino-http, cors, body-parser)
3. **Cache-Control + healthRouter** ← before Clerk
4. `clerkMiddleware` (gated on `nodeEnv !== "test"`)
5. `requireAuth + router` (all other authenticated routes)

Also: always call `setupClerkWhitelabelAuth()` after deploying to a new environment to provision `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `VITE_CLERK_PUBLISHABLE_KEY`. Without those secrets, every non-health route will also 500.
