# EngineeringOS — Deepest Analysis Report

## 1) Core conclusion
EngineeringOS is not a single application with a few pages. It is a **multi-layer engineering platform** whose live code already implements four distinct planes:

1. **Truth and governance plane** — fact record, completion plan, PR backlog, truth-flow validation, codegen drift checks.
2. **Execution plane** — Express API, ownership middleware, audit logging, job queue, scan runner, discovery pipeline.
3. **Intelligence plane** — scanner, graph extraction, knowledge-engine traversal/inference, AI orchestration, per-user Groq key management.
4. **Presentation plane** — dashboard, project discovery wizard, task/workflow/graph/AI screens, plus a sandbox/mockup area.

The deepest finding is not that the project is incomplete; it is that the project is **already architected as a proof-oriented system**, but a few critical seams still need hardening so the architecture stays true under real load, restarts, and multi-user growth.

---

## 2) Hard inventory from the current archive

- Total files in the extracted archive: **603**
- OpenAPI operations: **62** across **49** paths
- Route declarations in `artifacts/api-server/src/routes`: **62**
- DB tables discovered: **17**
- Dashboard pages: **15**
- Test files: **29**
- Generated Zod source files: **117**
- Generated React client source files: **2**

That 62/62 match between OpenAPI operations and live route declarations is the strongest structural signal in the repo: the contract layer and runtime layer are aligned at the surface level.

---

## 3) What the codebase actually is

### A. Governance / truth layer
The repo does not rely on documentation as passive prose. It already has enforcement surfaces:

- `docs/fact-record.md`
- `docs/completion-plan.md`
- `docs/PR_BACKLOG.md`
- `docs/RUNTIME_EXECUTION_MATRIX.md`
- `scripts/validate-truth-flow.ts`
- `scripts/check-codegen-drift.ts`

This means the project’s “source of truth” is partly encoded as executable policy, not just markdown. That is a major maturity signal.

### B. Contract / generation layer
The stack is contract-first:

- `lib/api-spec/openapi.yaml`
- generated Zod schemas in `lib/api-zod/src/generated/*`
- generated React client in `lib/api-client-react/src/generated/*`
- drift checks wired into scripts

This is not ornamental codegen. The codebase has explicit drift detection, so the generation path is intended to stay authoritative.

### C. Runtime / execution layer
The API server is hardened and ownership-aware:

- ETag disabled for dynamic per-user JSON
- `helmet`
- rate limiting
- `trust proxy = 1`
- `no-store` for `/api`
- Clerk auth middleware
- per-project access middleware
- audit logging
- job queue and reconciliation

This is the behavior of a production-minded internal platform, not a demo skeleton.

### D. Intelligence layer
The intelligence layer is real and layered:

- `lib/scanner` does file walking, rule matching, Python AST extraction, graph extraction, and metrics calculation.
- `lib/knowledge-engine` does pure graph traversal and inference.
- `lib/ai-orchestrator` does provider access, typed parsing, fallback handling, context building, and agent-specific prompts/schemas.

This combination is the most distinctive part of the repo. The system is trying to understand engineering systems, not just store records.

---

## 4) Deeper architectural findings

### 4.1 Contract ↔ runtime alignment is strong
The live route set and the OpenAPI surface match in count: 62 operations and 62 route declarations. That is a rare and meaningful signal. It means the repository is past the stage where API documentation is merely aspirational.

### 4.2 Ownership scoping is now a first-class platform concept
The API server makes a distinction between:

- **authentication**: who is calling?
- **authorization / ownership**: which project may they touch?

That distinction is implemented in middleware and route-level checks, not left to the frontend. This is good architecture.

### 4.3 The scanner is a genuine analysis engine
`lib/scanner` is not a placeholder parser. It has:

- file walking with ignore lists and hard caps
- safe regex compilation
- AST-based Python extraction
- TypeScript graph extraction
- metric computation from real scan results

This means the project has an actual source-analysis engine under the hood.

### 4.4 The knowledge engine is separated correctly
The knowledge engine is pure and read-only. It fetches graph data and computes traversal and inference without writes. That separation is important: it keeps the semantic layer reusable and testable.

### 4.5 The AI layer is designed defensively
The AI orchestrator is not “call model, trust output.” It uses:

- provider error classification
- JSON extraction
- schema validation
- fallback outputs
- bounded history/context building
- per-user API keys

That is a serious reliability posture for LLM integration.

---

## 5) The deepest unresolved risk

### Dashboard aggregation is the clearest semantic inconsistency
`artifacts/api-server/src/routes/dashboard.ts` reads directly from `projectsTable`, `tasksTable`, `eventsTable`, `rulesTable`, and `metricsTable` without applying an explicit owner filter.

Because the rest of the platform is already scoped around `req.userId` and per-project ownership, this route is the main place where the ownership model becomes ambiguous.

Why this matters:
- If the database ever contains multiple users’ data, the dashboard can become a cross-user aggregate view.
- Even if the current deployment is effectively single-user or pre-production, this route is architecturally inconsistent with the rest of the security model.
- The existing dashboard tests validate summary behavior, but they do not prove row-level ownership isolation.

This is the most important deep-seam issue I found.

### In-process job durability is still the main operational risk
`job-queue.ts` and `job-reconciliation.ts` solve concurrency and crash cleanup for the current process model, but they do not make jobs durable across restarts.

That means:
- queued/running work is still memory-bound
- a crash can orphan work in the DB until startup reconciliation marks it failed
- recovery is “detect and fail,” not “resume”

That is acceptable for a bounded internal phase, but it remains the main durability gap.

---

## 6) What is real vs what is still heuristic

### Real production surfaces
- OpenAPI contract
- generated client and schemas
- Express routes
- ownership middleware
- audit logging
- scanner engine
- graph knowledge engine
- AI orchestration
- dashboard pages
- test coverage
- truth validation scripts

### Heuristic or partial surfaces
- `plugin-runtime` docs coverage uses a heuristic placeholder until doc extraction exists
- `DiscoverProjectWizard` still contains example placeholder values in inputs
- some UI surfaces still use fallback text that should be polished for production-level onboarding

These are not the same kind of gap. The first category is core architecture. The second category is polish or metric fidelity.

---

## 7) Strongest evidence that the project is already mature

- `app.ts` has meaningful security hardening.
- `requireAuth` and project access middleware are explicit.
- `scan-runner` is separated from the HTTP route to avoid blocking requests.
- `plugin-runtime` is best-effort and non-fatal by design.
- `validate-truth-flow.ts` and `check-codegen-drift.ts` turn correctness into a gate.
- The repo has a large amount of evidence material, but the live runtime surface is still coherent.

This is not a prototype architecture that needs invention from scratch. It is a partially completed platform that now needs disciplined closure of the remaining seams.

---

## 8) Deepest-priority next moves

1. **Normalize ownership scoping everywhere**, starting with `dashboard.ts`.
2. **Make job execution durable**, or explicitly document the in-process limitation as temporary.
3. **Remove the last functional heuristics/placeholder metrics**, especially the docs coverage placeholder in plugin runtime.
4. **Clean the client surface drift smell**, including duplicate exports in `lib/api-client-react/src/index.ts`.
5. **Polish onboarding placeholder copy** so the UX matches the maturity of the backend.
6. **Keep truth drift gates mandatory in CI** so docs, spec, generated code, and runtime stay synchronized.

---

## 9) Final read
EngineeringOS already behaves like a governed engineering operating system for projects: it can discover, scan, analyze, infer, audit, and present truth.

The remaining work is not to invent the platform. It is to **close the last inconsistencies between the platform’s declared truth model and its few remaining runtime shortcuts**.
