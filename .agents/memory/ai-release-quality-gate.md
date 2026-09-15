---
name: AI release quality gate
description: Release validation must aggregate deterministic AI contract and operational checks while keeping live providers and Preview opt-in.
---

The AI release decision is a bounded, machine-readable summary: blocking checks fail closed, command output is never persisted, and live-provider observations remain informational unless a separate policy changes them. If a command fails, retain only bounded safe test-file/assertion identifiers plus a fixed assertion-versus-harness code. A stream suite that mocks the orchestrator/provider boundary proves route wiring only; release confidence also needs a provider/orchestrator-real path or an explicitly scoped live/recovery check.

**Why:** Provider output and test diagnostics can contain prompts, source text, or credentials, while environment availability must not be mistaken for agent quality.

**How to apply:** Add new AI guarantees to the release matrix with an explicit blocking policy and safe failure code; keep benchmark baseline comparison separate from deterministic contract replay, and label boundary-mocked stream coverage as wiring/transport coverage rather than end-to-end provider coverage.