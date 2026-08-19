# EngineeringOS — Gap Analysis Closure Report

> **Date:** 2026-07-24  
> **Source:** Four-phase analysis (phases 1–4 + unified final report) uploaded to `attached_assets/`.  
> **Status:** All P0 gaps closed or confirmed-resolved; P1 gap (dashboard tests) closed; P2 gaps deferred.

---

## Summary of Findings

The four-phase analysis identified six gaps across RBAC, job durability, documentation drift, UI test coverage, mockup sandbox, and binary asset searchability.

| Gap | Priority | Analysis Finding | Actual State | Resolution |
|---|---|---|---|---|
| Truth baseline drift | P0 | Multiple conflicting doc sources | `docs/architecture.md` is the authoritative baseline; historical docs are labeled as such in their banners and in `PR_BACKLOG.md` | Confirmed closed — no code change needed |
| RBAC / role model | P0 | `requireProjectWriteAccess` was an alias of `requireProjectAccess` | Confirmed — both checked ownership only, no write-gate | **Fixed:** write access now rejects mutations on archived projects (see below) |
| Durable background jobs | P0 | In-memory queue loses jobs on restart | Job queue is in-memory but backed by DB persistence + `reconcileStuckJobs()` on startup via `job-reconciliation.ts` | Confirmed closed — reconciliation re-enqueues queued jobs, fails interrupted ones cleanly, uses `enqueueWithId` for deduplication |
| UI regression coverage | P1 | No test files in `artifacts/dashboard/` | Confirmed — zero test files | **Fixed:** vitest + testing-library configured, critical component tests added |
| Mockup sandbox discovery | P2 | `mockup-components.ts` exports empty `modules` | Confirmed — manifest is empty | Deferred — sandbox is infrastructure-ready; content is added via the mockup workflow, not as a gap fix |
| Binary evidence searchability | P2 | Screenshots/PDFs hard to query | Confirmed — 35 PNG screenshots exist as opaque files | Deferred — low operational impact; images are visual evidence, not query targets |

---

## Changes Made

### 1. RBAC — Write-gate on archived projects

**File:** `artifacts/api-server/src/middlewares/requireProjectAccess.ts`

`requireProjectWriteAccess` now enforces the first real read/write distinction:
- Archived projects (`status = "archived"`) are rejected with **403** on any mutating route (PATCH, DELETE, POST /scan, workflow advances, etc.)
- Read routes using `requireProjectAccess` continue to work on archived projects
- The route-level call sites already used the correct middleware — no route changes needed

This closes the structural gap the analysis flagged: the two middleware exports were previously identical aliases. Future expansions (e.g. collaborator roles) only need to change `requireProjectWriteAccess`.

### 2. Dashboard tests — vitest + testing-library

**Files added:**
- `artifacts/dashboard/vitest.config.ts` — vitest config with jsdom environment
- `artifacts/dashboard/src/test/setup.ts` — jest-dom matchers
- `artifacts/dashboard/src/pages/Landing.test.tsx` — Landing page render tests
- `artifacts/dashboard/src/pages/Projects.test.tsx` — Projects search/filter tests

Covers the two most critical user-facing paths: the public landing page (sign-in/sign-up CTAs) and the authenticated projects list (search filtering, loading skeleton, empty state).

---

## Document Classification Reference

To avoid future drift confusion, the authoritative document for each topic:

| Topic | Authoritative source | Historical / archive |
|---|---|---|
| Architecture | `docs/architecture.md` | `docs/fact-record.md`, `docs/completion-plan.md` |
| PR backlog | `docs/PR_BACKLOG.md` | `attached_assets/EngineeringOS_Truth_Register*.xlsx` |
| Truth flow | `docs/truth-flow-pr-checklist.md` | `docs/EXECUTION_ALIGNMENT_REPORT.md` |
| Runtime matrix | `docs/RUNTIME_EXECUTION_MATRIX.md` | Phase analysis CSVs in `attached_assets/` |
| Agent decisions | `.agents/memory/MEMORY.md` (+ topic files) | Historical memory snapshots in `attached_assets/` |

The principle: if a document's banner says "historical" or "phase log", treat it as evidence, not truth. `docs/architecture.md` is the single current baseline.

---

## Remaining open items (not gaps, but worth tracking)

- **Multi-role RBAC**: The analysis flagged no collaborator roles beyond owner. The middleware is now structured to make this the next obvious step — adding a `project_members` table and checking role in `requireProjectWriteAccess` would be the implementation path.
- **Full RBAC schema**: No `roles` or `permissions` tables exist. Single-owner model is intentional for now.
- **End-to-end UI tests**: The new unit tests cover component behavior; browser-level E2E (Playwright) would provide deeper coverage for the discover-project wizard and scan workflow.
