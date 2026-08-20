---
name: Forensic empty verdicts
description: The stable distinction between an evidence-complete empty audit and an incomplete forensic analysis.
---

An empty forensic report must distinguish `NO_VERIFIED_FINDING` from `ANALYSIS_INCOMPLETE`: the former means the retained source reads completed without proving a Finding, while the latter means the evidence scope or source reads were incomplete.

**Why:** Treating both outcomes as a generic NOT PROVEN result obscures whether the audit actually completed and makes user-facing recovery output ambiguous.

**How to apply:** Use the evidence-read state when constructing deterministic reports and fallbacks; keep recovery details and telemetry out of the user-facing six-section report.