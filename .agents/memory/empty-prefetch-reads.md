---
name: Empty prefetch reads
description: How empty source-tool output can become failed evidence telemetry without a corresponding persisted read event.
---

Prefetch must treat an empty string from the file tool as a failed read before it becomes a cache entry or synthetic tool exchange. If it is allowed through the prefetch hit path, later evidence normalization can add the path from `READ_FAILED` status with an empty body even though no prefetched tool result was emitted.

**Why:** A forensic execution showed a zero-byte failed source row for a planner-selected file, while the persisted trace contained no read event for that file. The path came from an empty prefetch cache entry: `readPrefetchFile` returned `""`, `prefetchFileList` classified it as a hit, and `recordPrefetchEvidence` later marked it failed.

**How to apply:** Keep empty/error bodies out of `hits`, `cacheEntries`, injected messages, and retained evidence. If failed paths must be retained for diagnostics, record them in an explicit failed-attempt structure with a matching trace event; never let status-only paths look like retained source bodies.