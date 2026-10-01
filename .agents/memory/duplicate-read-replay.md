---
name: Duplicate source-read replay
description: Cached forensic source reads remain usable evidence and must not force a no-tool synthesis turn.
---

Repeated reads of a successfully acquired source file should replay the cached result and keep the forensic tool loop available. Duplicate protection should prevent unbounded repetition without discarding usable evidence or triggering a provider fallback that cannot use tools.

**Why:** Free/provider models commonly repeat a read after receiving a valid tool result; treating that safe replay as terminal caused otherwise recoverable analyses to fail.

**How to apply:** Escalate repeated exploratory searches or listings separately, but keep cached read replay non-terminal and preserve its source/evidence telemetry.

Evidence status for a path must be monotonic across retries and duplicate reads: a later truncated or failed replay must not downgrade an already retained complete or targeted evidence window.

**Why:** The terminal snapshot currently collapses per-path statuses to the latest value, so a harmless full-file locator read can overwrite a previously accepted bounded window and make a valid objective look incomplete.

**How to apply:** Aggregate statuses by evidence strength when building retry handoffs and terminal snapshots; retain every raw read event for telemetry, but project the strongest retained window for acceptance.

Shared tool-result cache entries must be bound to the project root, revision, complete authorized manifest, and effective read/execution scope. Every cache consumer that derives evidence or target paths must honor that same context; a cache hit from another context is not usable evidence.

**Why:** A stale cached body can influence evidence scheduling or a repair handoff even when a fresh dispatcher call would reject the same path. Reading only cache keys without their context can therefore bypass the current scope boundary.

**How to apply:** Use one canonical contextual key for cache lookup, prefetch seeding, and derived read-path projections. Migrate legacy keys only when their tool is authorized by the current manifest and their arguments can be validated.