---
name: Clerk auth + vitest supertest bypass
description: How this project reconciles Clerk-gated Express routes with vitest/supertest route tests that have no browser session.
---

Vitest sets `process.env.NODE_ENV = "test"` by default when nothing else sets it first (confirmed empirically: a plain `process.env.NODE_ENV` read inside a vitest test returns `"test"` even with no config). This project's `config.ts` already had `"test"` as a valid `NODE_ENV` enum value before auth was added, which is a strong signal test-mode branching was anticipated.

**Decision:** `requireAuth` (Clerk session guard) short-circuits with a fixed synthetic `userId` when `config.nodeEnv === "test"`, instead of trying to mint real Clerk session cookies/tokens for supertest.

**Why:** supertest calls the Express app directly with no browser, so there is no Clerk session cookie to send. Route tests exist to exercise handler business logic (scan pipeline error safety, workflow phase transitions, etc.), not Clerk's own session verification — minting fake Clerk tokens would add complexity without testing anything Clerk doesn't already test itself.

**How to apply:** When adding Clerk (or any cookie-session auth) to an Express API that already has supertest route tests, check whether the test runner sets `NODE_ENV=test` (vitest does, by default) before reaching for a token-mocking library. If a project's `config.ts` treats `NODE_ENV` as a closed enum, gating the bypass on that value is safe — dev/prod never set it to `"test"`.

**Testing the real (non-bypass) branch anyway:** the bypass means no supertest-based route test can ever exercise the actual `getAuth()`-based 401/authenticated logic — `config.nodeEnv` is fixed to `"test"` for the whole vitest run. To cover that logic, write a unit test that mocks `../config.js` (return a non-`"test"` `nodeEnv`) and `@clerk/express`'s `getAuth` with `vi.doMock`, then `await import()` the middleware fresh after `vi.resetModules()` in `beforeEach`. If a later test in the same file needs the *real*, unmocked modules again (e.g. to confirm the bypass itself), call `vi.resetModules()` again first — otherwise it reuses the previously-mocked cached module instance and silently gets the wrong branch.
