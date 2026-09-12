---
name: Session objective parity
description: Keeps dynamic project-query claims consistent across session state, execution requests, resume, and acceptance.
---

Dynamic project-query objectives must be materialized once and used consistently for the resumable session contract, durable execution request, evidence scheduler, and acceptance gate. A target's static claim list is not sufficient when the user's wording adds deliverables such as weakness analysis.

**Why:** A live Arabic project-query turn carried four claims in its execution request and acceptance trace but only three in the persisted session state. The run then failed for provider/evidence reasons, but any continuation would inherit a weaker contract and could omit the user-requested deliverable.

**How to apply:** Derive the effective objective before constructing or updating session state. On fresh turns, resumes, JSON, and SSE paths, compare claim IDs and required evidence paths across session state and execution request; reject or repair mismatches before provider work.