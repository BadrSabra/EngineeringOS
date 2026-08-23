---
name: AI release quality gate
description: Release validation must aggregate deterministic AI contract and operational checks while keeping live providers and Preview opt-in.
---

The AI release decision is a bounded, machine-readable summary: blocking checks fail closed, command output is never persisted, and live-provider observations remain informational unless a separate policy changes them.

**Why:** Provider output and test diagnostics can contain prompts, source text, or credentials, while environment availability must not be mistaken for agent quality.

**How to apply:** Add new AI guarantees to the release matrix with an explicit blocking policy and safe failure code; keep benchmark baseline comparison separate from deterministic contract replay.