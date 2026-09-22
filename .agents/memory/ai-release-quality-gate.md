---
name: AI release quality gate
description: Release validation must aggregate deterministic AI contract and operational checks while keeping live providers opt-in and Preview blocking by default.
---

The AI release decision is a bounded, machine-readable summary: blocking checks fail closed, command output is never persisted, and live-provider observations remain informational unless a separate policy changes them. The deterministic dashboard Preview contract is provider-free and blocking by default; callers must explicitly disable it for narrow local checks. If a command fails, retain only bounded safe test-file/assertion identifiers plus a fixed assertion-versus-harness code. A stream suite that mocks the orchestrator/provider boundary proves route wiring only; release confidence also needs a provider/orchestrator-real path or an explicitly scoped live/recovery check.

**Why:** Provider output and test diagnostics can contain prompts, source text, or credentials, while environment availability must not be mistaken for agent quality.

**How to apply:** Add new AI guarantees to the release matrix with an explicit blocking policy and safe failure code; keep benchmark baseline comparison separate from deterministic contract replay, keep live-provider checks opt-in, and use `enablePreview: false` only for intentionally narrow local runs.