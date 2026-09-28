---
name: P7.5 collection readiness boundary
description: Authority limits for the read-only pre-collection readiness report.
---

Keep P7.5 readiness reports diagnostic only. A clean machine report must not start a cohort or authorize collection. Mission IDs and the fixed held-out partition are metadata, not proof of independent sampling or an unused holdout. Require auditable human-reviewed reset, independence, held-out provenance, and forecast/policy-freeze evidence before any future route can grant collection authority. Do not accept arbitrary caller booleans or unverified strings as those reviews.

**Why:** Current P7.5 records prove technical scope and result integrity but do not prove operator-controlled reset, independence, or whether outcome data were previously used for tuning. Accepting unchecked attestations could turn self-asserted values into collection authority.

**How to apply:** A future endpoint or UI may surface blockers and evidence, but must remain read-only until a separate reviewable authority contract exists. Keep `fixed_safe_probe` and calibration v1 unchanged; continuation receipts remain excluded.