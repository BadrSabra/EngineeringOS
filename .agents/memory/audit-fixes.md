---
name: Audit Fixes
description: Graph dual-map identity, rate-limit proxy trust, metrics alignment, codegen gate, scanner test suite behavioral facts, audit_logs wiring decisions.
---

- Graph entity identity uses a dual key: `type::path::name` for the primary insert-dedup key, and `type::name` → [ids] as a secondary index for relationship resolution, because multiple entities can share a name across files.
- Rate limiting trusts `X-Forwarded-For` (`trust proxy = 1`) — correct for the Replit proxy setup, but would need reconsideration behind a different reverse-proxy topology.
- `pnpm run codegen:check` (root) is the CI gate for OpenAPI/orval drift — must use `git status --porcelain`, not `git diff --exit-code`, since untracked new generated files don't show in `git diff`.
- `audit_logs` table existed in schema but was completely unwired (zero inserts) until wired into all sensitive routes (project/task/rule/workflow/plugin/discovery CRUD + state-transition actions) via a shared `recordAudit` helper in `artifacts/api-server/src/lib/audit.ts`.
- Decision: `recordAudit` is intentionally best-effort — it catches and logs its own errors rather than propagating, because the primary mutation has already committed by the time it's called and an audit-write hiccup should not turn a successful user action into a 500. Revisit this if audit_logs ever becomes compliance-critical (would need same-transaction write or an outbox pattern).
