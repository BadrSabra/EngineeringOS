---
name: Session memory lifecycle
description: Durable retention, deduplication, retrieval, prompt-boundary, and write-delivery rules for cross-session navigation memory.
---

Session memory is stale, untrusted navigation context: retain it for a bounded TTL, decay each row at most once per 24-hour period, deduplicate project-relative paths, and never use it as evidence or authorization. Response-derived summaries and file hints must not become source claims merely because a CHAT turn succeeded; semantic records must come only from explicit user statements or server-validated typed outcomes, with source revision and provenance retained when available.

**Why:** A six-hour maintenance scheduler must not apply a daily decay repeatedly, and model/provider or process failures must not turn a best-effort memory hint into lost or authoritative state. A successful ordinary-chat acceptance can coexist with unsupported model citations, so memory writes need the same provenance boundary as answer publication.

**How to apply:** Queue successful-turn memory writes durably before returning only after applying the turn's public acceptance/provenance policy, materialize them idempotently in the background, scope retrieval to the project and active execution plan, downgrade revision-mismatched records to stale, and inject one explicitly marked prompt section. Never let a memory row satisfy an evidence gate or authorize a source citation.