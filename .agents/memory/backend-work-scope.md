---
name: Backend work scope
description: EngineeringOS backend work must stay coordinated with the separate frontend owner and existing trust contracts.
---

For EngineeringOS backend work, treat `artifacts/dashboard/**` as owned by the separate frontend agent. Start from the current code, avoid speculative APIs or duplicate orchestration/state, and coordinate any contract change with its frontend impact, tests, and compatibility plan.

**Why:** The user assigned backend and frontend work to separate agents and requires capabilities to be supported by real contracts and evidence.

**How to apply:** Keep backend edits outside the dashboard artifact unless the user changes this boundary. Preserve identity, authorization, evidence, revision, and qualification gates; report confirmed, likely, and unresolved findings with concrete verification.
