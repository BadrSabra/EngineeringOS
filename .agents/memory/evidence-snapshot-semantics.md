---
name: Evidence snapshot semantics
description: Distinguishes unavailable provider evidence from successful turns that do not require source evidence.
---

An explicit `UNAVAILABLE` evidence verdict must never normalize to `complete=true`, even when the request did not require proof. A successful ordinary turn with no evidence input must retain the historical complete projection, and artifact-only success may remain complete without source reads.

**Why:** Treating every `required=false` snapshot as complete made a provider failure with zero reads appear complete, while treating every missing or non-proven verdict as incomplete broke ordinary chat acceptance.

**How to apply:** Make provider-failure tests assert `UNAVAILABLE` plus `evidenceComplete=0`; preserve the existing no-evidence-success and artifact-only tests when changing normalization.