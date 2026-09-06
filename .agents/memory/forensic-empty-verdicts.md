---
name: Forensic empty verdicts
description: The stable distinction between an evidence-complete empty audit and an incomplete forensic analysis.
---

An empty forensic report must distinguish `NO_VERIFIED_FINDING` from `ANALYSIS_INCOMPLETE`: the former means the retained source reads and answer/evidence validation completed without proving a Finding, while the latter includes incomplete reads and runs whose model output or recovery failed before accepted claims were closed. Complete source bodies alone do not justify `NO_VERIFIED_FINDING`.

**Why:** Treating both outcomes as a generic NOT PROVEN result obscures whether the audit actually completed and makes user-facing recovery output ambiguous.

**How to apply:** Use the evidence-read state when constructing deterministic reports and fallbacks; capability-probe claim closure must feed the same terminal classifier as generic required-claim closure, or complete reads can be mislabeled as `NO_EVIDENCE_FOUND`. Keep recovery details and telemetry out of the user-facing six-section report.