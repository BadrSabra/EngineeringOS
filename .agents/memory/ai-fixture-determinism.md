---
name: AI fixture determinism
description: Rules for preventing test fixtures from silently running real validators or masking missing AI turns.
---

AI integration fixtures must consume injected validation results and provider turns explicitly; an exhausted fixture queue should throw immediately rather than run a real command, call a live provider, or synthesize an untracked success.

**Why:** Silent fallbacks make deterministic route tests pass while exercising the workspace or external AI unexpectedly, and they hide missing tool/validation steps in the scenario.

**How to apply:** Keep real validation behind an explicit opt-in flag, use mutable hoisted state when tests reset it, and fail with a fixture-specific error whenever a required injected result is absent.