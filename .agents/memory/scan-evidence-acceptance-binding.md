---
name: Analysis scan-source acceptance binding
description: Keep the durable analysis acceptance tied to the scan result and exact scan summary supplied to the model.
---

For structured analysis, persist a bounded source reference in the existing execution acceptance. Bind the scan job identity and status, scan revision and workspace revision, a digest of the raw scan result, and a separate digest of the exact model-facing summary. Preserve completeness and verification state. This reference establishes provenance only; it is not Canonical Proof and must not satisfy analysis acceptance by itself.

**Why:** An analysis result or failure can otherwise outlive the context that produced it, leaving later review unable to determine which scan and revision the model received.

**How to apply:** Derive the reference from the same loaded scan object used to build the prompt summary, carry it unchanged into successful and failed acceptance, and validate it through the strict context schema. Avoid a separate provenance table or schema migration when the existing acceptance disposition can hold this bounded metadata.
