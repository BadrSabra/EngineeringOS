---
name: AI release quality gate
description: Release validation must aggregate deterministic AI contract and operational checks while keeping live providers opt-in and Preview blocking by default.
---

The AI release decision is a bounded, machine-readable summary: blocking checks fail closed, command output is never persisted, and live-provider observations remain informational unless a separate policy changes them. The deterministic dashboard Preview contract is provider-free and blocking by default; callers must explicitly disable it for narrow local checks. If a command fails, retain only bounded safe test-file/assertion identifiers plus a fixed assertion-versus-harness code. A stream suite that mocks the orchestrator/provider boundary proves route wiring only; release confidence also needs a provider/orchestrator-real path or an explicitly scoped live/recovery check.

**Why:** Provider output and test diagnostics can contain prompts, source text, or credentials, while environment availability must not be mistaken for agent quality.

**How to apply:** Add new AI guarantees to the release matrix with an explicit blocking policy and safe failure code; keep benchmark baseline comparison separate from deterministic contract replay, keep live-provider checks opt-in, and use `enablePreview: false` only for intentionally narrow local runs.

The Preview gate's `diagnostic.testFiles` is not guaranteed to identify the failing browser tests: it can include test paths extracted from the configured command, and empty `testIds` do not identify a failing case. Use Playwright's own result artifacts for browser attribution.

**Why:** A full release run listed contract-test paths while the saved Playwright artifacts identified different dashboard journey failures.

**How to apply:** When `dashboard-preview-contract` blocks, inspect `.last-run.json`, each failing `error-context.md`, and its trace timeline before changing product behavior. A filtered pass does not replace full-suite acceptance.