---
name: Testing and codegen drift-check gotchas
description: Pitfalls hit when adding integration tests and an OpenAPI/orval drift check to the EngineeringOS monorepo.
---

- `git diff --exit-code` does not catch newly created (untracked) generated files after running codegen — use `git status --porcelain` on the generated dirs instead so new files count as drift too.
- Integration tests that hit a real Postgres DB (no test DB configured here) must track per-test IDs and clean up in `afterEach`, not just `afterAll` — otherwise failures mid-suite leak rows and later tests can cross-contaminate.
- To prove atomic-claim/race protection (e.g. discovery import's ready→imported transition), assert DB state after concurrent requests (exactly one row, session status), not just the HTTP status codes — status codes alone can pass for the wrong reason.
- To test a route's error-safety (status reset on failure), you must force a real throw (e.g. `vi.spyOn` on a scanner function) — asserting behavior on a path that doesn't actually throw (like a missing rootPath that scanner tolerates) only tests the happy path.
