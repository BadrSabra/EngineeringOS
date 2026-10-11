---
name: Request wait policy
description: Product decision on project-wide request caps, provider request timeouts, and retry delays.
---

Disable the project-wide 20-requests-per-minute cap and the API-wide 300-requests-per-five-minutes IP cap. Remove locally imposed provider request timeouts and delays before retrying network errors. Product routes should not cap OpenRouter candidates to a fixed count. Query planning and answer synthesis should not add local default deadlines or attempt ceilings; use the request's execution budget and cancellation instead. Job-queue slots remain occupied until the underlying job settles. Keep caller cancellation, execution budgets, and positive provider-supplied Retry-After handling.

**Why:** The user identified these as internal policies that can limit valid work or misrepresent capacity and explicitly asked to remove them while continuing the E2 evaluation.

**How to apply:** Do not reintroduce project/IP request caps, product-path candidate-count caps, local query/synthesis deadlines, or early queue-slot release without an explicit product decision. Preserve caller cancellation, request-scoped execution budgets, provider-directed cooldowns, and safety controls unrelated to these policies.
