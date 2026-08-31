---
name: Duplicate source-read replay
description: Cached forensic source reads remain usable evidence and must not force a no-tool synthesis turn.
---

Repeated reads of a successfully acquired source file should replay the cached result and keep the forensic tool loop available. Duplicate protection should prevent unbounded repetition without discarding usable evidence or triggering a provider fallback that cannot use tools.

**Why:** Free/provider models commonly repeat a read after receiving a valid tool result; treating that safe replay as terminal caused otherwise recoverable analyses to fail.

**How to apply:** Escalate repeated exploratory searches or listings separately, but keep cached read replay non-terminal and preserve its source/evidence telemetry.