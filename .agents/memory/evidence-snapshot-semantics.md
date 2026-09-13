---
name: Evidence snapshot semantics
description: Distinguishes unavailable provider evidence from successful turns that do not require source evidence.
---

An explicit `UNAVAILABLE` evidence verdict must never normalize to `complete=true`, even when the request did not require proof. Source-required evidence with a non-`PROVEN` verdict (including `PARTIAL`) is also incomplete; artifact-only success may remain complete without source reads, and ordinary no-evidence success retains its historical projection.

**Why:** Treating every `required=false` snapshot as complete made a provider failure with zero reads appear complete; treating retained reads with a `PARTIAL` source verdict as complete made targeted objective failures look accepted; treating every missing or non-proven verdict as incomplete would break ordinary chat and artifact-only acceptance.

**How to apply:** Make provider-failure tests assert `UNAVAILABLE` or source-required `PARTIAL` plus `evidenceComplete=0`; preserve the existing no-evidence-success and artifact-only tests when changing normalization.