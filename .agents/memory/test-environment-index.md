---
name: Test environment contracts
description: Pointers for reliable database, process, package-root, workflow, and UI validation.
---

- [Disposable PostgreSQL tests](disposable-postgres-tests.md) — use a loopback-only temporary cluster and explicit database URL for integration tests.
- [Package test root](package-test-root.md) — run Vitest from its owning package and align optional Vite peers.
- [Nested pnpm project isolation](pnpm-project-isolation.md) — generated roots under the monorepo need workspace isolation.
- [Benchmark smoke environment](benchmark-smoke-database-env.md) — an unset database URL can look like provider failure during import.
- [Process-level AI worker fixtures](process-level-ai-worker-fixtures.md) — use real worker writes and close stdin after race barriers.
- [Delivery test cleanup](delivery-test-cleanup.md) — cleanup must remove only generated operation roots.
- [Validation workflow accumulation](validation-workflow-accumulation.md) — keep standalone validations out of project startup workflows.
- [Repair-validator fixture scope](repair-validator-fixtures.md) — fixtures must use paths accepted by the selected validation profile.
- [Generated query-key tests](generated-query-key-tests.md) — assert against exact generated URL and parameter shapes.
- [Vitest cold-import timeouts](vitest-import-cost.md) — distinguish module cold-start from test-body time.
- [Runtime restart validation](runtime-restart-validation.md) — restarts also trigger catalog refresh and a session-memory sweep.
- [Node CLI entrypoint paths](node-cli-entrypoint-paths.md) — normalize relative entrypoint paths before comparing them.
