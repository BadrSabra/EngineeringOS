---
name: Forensic Recovery deadline
description: Recovery formatting must remain bounded independently of provider fallback behavior.
---

Forensic Recovery is a formatting and verification pass, not a second open-ended analysis loop; it needs both a per-attempt timeout and a run-level deadline.

**Why:** Provider-owned fallback chains and multiple evidence packets can multiply a nominal request timeout until a live audit remains open for several minutes without producing a usable report.

**How to apply:** Let the orchestrator own the ordered recovery candidates, cap provider fallback within each attempt, abort or race each call against the remaining deadline, and return one sanitized `ANALYSIS_INCOMPLETE` report when no accepted report exists.