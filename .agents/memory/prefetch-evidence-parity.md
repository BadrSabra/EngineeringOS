---
name: Prefetch evidence parity
description: Keep speculative or forensic prefetch read telemetry aligned with the server-owned evidence snapshot.
---

**Rule:** A prefetched source body that exceeds the persisted read-size limit must be classified as incomplete everywhere: trace, retained-read status, evidence snapshot, recovery cursor, and acceptance projection. Never emit `READ_COMPLETE` for a body that persistence will discard.

**Why:** If telemetry reports a complete read while normalization drops the oversized body, provider-failure recovery sees source progress but acceptance sees an incomplete snapshot. This produces misleading read counts and can prevent reuse of otherwise valid evidence.

**How to apply:** Centralize size-aware classification at the prefetch boundary, retain the original path/byte metadata, and add a regression that compares trace read status with persisted `complete/truncated/body` flags for an oversized file plus other complete reads.