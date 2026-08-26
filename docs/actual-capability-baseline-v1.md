# EngineeringOS Actual Capability Baseline

**Baseline version:** 2 (historical filename retained)
**Observed date:** 2026-08-26
**Scope:** repository source, merged provider-free release checks, and recorded
controlled-operation prerequisites available in this workspace
**Status:** evidence report; controlled authenticated browser/API checks were run
on 2026-08-26, but the complete live-provider delivery campaign remains blocked
and no production deployment was used

## 1. Reading this report

This is a code-and-test baseline, not a parity claim. A capability is marked:

- **Verified by code** — the implementation path and enforcement point are present,
  but no relevant automated behavior check was established here.
- **Verified by automated test** — a provider-free unit, route, contract, or
  component test passed.
- **Verified end-to-end** — a real browser/API journey passed against running
  services. No capability receives this label in this update; the preview/browser
  check is still disabled and live-provider checks were not run.
- **Partial** — some path is implemented and/or tested, but an important
  transition, prerequisite, or integration remains unverified or failed.
- **Blocked** — the path intentionally cannot run without a provider, credential,
  or other prerequisite.
- **Not implemented** — the source explicitly does not provide the capability.

“Proposed”, “validated”, “committed”, and “pushed” describe change state, not
capability state:

| Change state | Meaning in this baseline |
|---|---|
| Safe proposed | A future change could be suggested without applying it. |
| Validated | A change or candidate passed its applicable validation receipt/gate. |
| Committed | Git commit endpoint completed for the approved candidate. |
| Pushed | Git push endpoint completed with configured credentials/remotes. |

This update did not propose or apply a product change. The report records
capabilities already present in the merged source and the latest validation
receipts; its committed/pushed state is determined by the task merge process.

### Update ledger

The previous 2026-08-25 baseline remains the historical starting point. This
revision incorporates the merged work tracked by the repository task plans:

- source-revision binding and server-derived candidate integrity for release
  evidence (`.local/tasks/bind-releases-source-revision-v2.md`);
- provider fallback/health classification and safe recovery guidance
  (`.local/tasks/openrouter-fallback-root-cause.md` and provider diagnostics
  tests);
- bounded repair validation and dashboard-journey acceptance fixtures; and
- restoration of provider-free runtime-oracle coverage and AI release-contract
  checks.

These changes improve what can be proven; they do not turn skipped live checks
into passing evidence.

## 2. Executive result

EngineeringOS is an implemented engineering-operations console with a real
dashboard, API, persistence model, tool-using AI loop, evidence gates, durable
execution state, source-bound release evidence, and an approval-controlled
Git delivery path. The latest provider-free release decision is
`status: "passed"` with 9 passed checks, 0 blocking failures, and 1 skipped
preview check (2026-08-26, `ai-release-quality-decision.json`). It is not
operationally proven as a complete Agent replacement:

1. AI features still require a configured provider; live provider checks remain
   disabled and no credentials were added for this update.
2. The deterministic benchmark contract and release decision pass, but its
   approved baseline intentionally remains `qualityEligible: false` and
   `rolloutAllowed: false`; that artifact is not live quality evidence.
3. The controlled campaign proved Clerk authentication, origin enforcement,
   authenticated shell navigation, audit preview/download, and the isolated
   Git route's approved Apply → commit → push behavior. It did not complete the
   full discovery → provider-backed work → promotion → Git journey: discovery's
   real Git fixture is rejected by the credential-free GitHub URL policy, and
   the full browser campaign hit readiness/fixture failures before delivery.
   Preview validation and live-provider delivery remain explicitly blocked.
4. Provider-free contract, SSE/redaction, operational-safety, and deterministic
   benchmark checks now pass. This supersedes the earlier targeted failures for
   those gates, but does not prove every broad API suite or a live provider.

## 3. User-visible capability map

| Capability | Implementation path and persisted boundary | Status | Evidence/confidence |
|---|---|---|---|
| Authenticated console and project-scoped navigation | Clerk setup in `replit.md`; `artifacts/dashboard/src/App.tsx` protects project, AI, Flight Deck, Mission Control, task, workflow, Git-related views; API uses auth/project-access middleware | **Verified by automated test** | Dashboard auth/page and client-contract checks pass; authenticated browser journey remains skipped |
| Project discovery/import | `artifacts/api-server/src/routes/discovery.ts`: source listing, discovery start/session/summary, import; durable materialization and owner-scoped cleanup; `DiscoverProjectWizard.tsx` calls generated discovery/import/scan hooks | **Partial** | Discovery route tests exist; selected run failed a durable Git fixture with HTTP 400 rather than expected 202 |
| Ordinary AI chat | `POST /api/ai/chat` and `/stream` in `routes/ai/chat.ts`; context is built, request intent/classification selects route/profile, messages/session state persist in `aiChatSessionsTable`/`aiChatMessagesTable` | **Verified by automated test; live blocked** | AI JSON/SSE, redaction, resume, and false-success release contracts pass; provider checks are disabled |
| Source-aware tool use | `chat-agent.ts` + `tool-execution-engine.ts`; read/list/search tools, cache, source provenance, tool authorization, bounded iterations/calls, soft synthesis limit | **Verified by automated test** | Deterministic benchmark and AI contract gates pass; no live-provider tool journey |
| Broad/hierarchical analysis | `hierarchical-executor.ts` schedules bounded waves, isolates write scopes, preserves partial sub-results, performs tool-free synthesis, and validates compound coverage | **Verified by code** | Explicit out-of-scope items remain: recursive nesting and per-subquery SSE |
| Structured scan analysis | `POST /api/ai/projects/:projectId/analyze` and `/stream`; context, provider fallback, parse/error envelope, audit log and completion event persistence | **Partial / live blocked** | Provider-free contracts and provider diagnostics are covered; live execution and authenticated E2E remain unproven |
| Structured code review | `POST /api/ai/projects/:projectId/review` and `/stream`; validates relative file keys and 50 KB aggregate input, persists audit/event result | **Partial / blocked** | Same provider limitation; input safety is code-backed |
| AI task execution | `POST /api/ai/tasks/:taskId/execute`; task ownership/status/rate-limit checks delegate to `executeTaskLifecycle`, with task logs/events and durable job helpers | **Partial / blocked** | `tasks.test.ts` covers scheduling/HTTP behavior; real provider execution was not run |
| Workflow orchestration | `POST /api/ai/workflows/:workflowId/orchestrate`; regular workflow API supports start/stop/advance/fail/retry/rollback and execution history | **Partial / blocked** | Workflow route tests passed within selected run; AI orchestration still needs provider and E2E confirmation |
| Execution history and Flight Deck | `GET /api/ai/executions/history`, detail, audit export; `FlightDeck.tsx` renders operation/checkpoint/evidence/validation state | **Verified by code** | `ai-execution-state.test.ts` and dashboard Flight Deck tests exist; no real browser/API journey |
| Mission Control/correlation | Mission Control page consumes execution history; chat route can regenerate a redacted correlation report solely from retained durable evidence | **Verified by automated test** | Dashboard Mission Control/correlation tests passed (part of 101 dashboard tests) |
| Cancellation and recovery | Chat route exposes cancel/recovery/resume-capability; `ai-execution-state.ts` owns leases, resume-token hashing, checkpoint recovery, restart reconciliation, cancellation terminalization | **Verified by automated test** | Latest AI SSE and operational-safety release checks pass; browser reload/restart evidence is still absent |
| Implementation planning | `implementation-planner.ts` requires verified filesystem manifest/source excerpts, validates provider paths, and returns `PENDING_APPROVAL`/`NOT_AUTHORIZED` fallback when grounding is absent | **Verified by code** | No provider-backed plan generation was run |
| Proposed changes and approval | Chat route stores `aiChangeProposalsTable`; write tools queue `pendingChanges`; plan decision and proposal approve/delete routes are present; dashboard shows approval state | **Partial** | Approval boundary is code-backed; complete browser approval journey was not run |
| Isolated delivery workspace | `delivery-workspace.ts` creates/hashes workspace and change set; chat apply path creates workspace before promotion and records `aiApplyJournalTable` | **Verified by automated test; operationally partial** | Latest operational-safety gate passes; no full authenticated promotion journey |
| Validation and repair | `ai-repair-validation.ts` provides server-owned profiles, isolated validation/runtime/preview runners and scope checks; public validation receipts are redacted at route boundary | **Verified by automated test; live journey partial** | Bounded validation and repair-loop checks pass; no live delivery workspace campaign |
| Rebase/conflict handling | Chat route `rebase-changes` and apply path hash base content, rebase hunks, reject conflicts, and preserve conflict metadata | **Verified by code** | Route tests cover conflict-shaped responses; no full user journey |
| Promotion/apply | Apply route checks owner/proposal state, root containment, duplicate paths, base hashes and validation receipts before atomically promoting files | **Verified by code** | `ai.test.ts` and delivery workspace tests cover portions; not E2E proven |
| Git commit and push | `routes/git.ts` exposes status/log/commit/push/export with write/access middleware; commit/push are proposal/operation-aware and release identity is source-bound | **Partial** | Isolated route proof passed the approved Apply → commit → push flow with one operation trace and matching commit hash; Clerk-authenticated live delivery and push against a real GitHub remote remain unrun |
| Audit export | Execution audit export and project export routes project allowlisted/redacted durable evidence | **Verified by code** | Export path is present; no downloaded artifact/API smoke check in this baseline |
| Direct arbitrary model shell execution | Tool policy and execution tools accept server-owned command profiles; the model does not supply arbitrary executable/argv | **Not implemented by design** | `tool-execution-engine.ts` and execution-tools contract enforce the safer profile boundary |

## 4. Agent loop trace

1. The chat route loads the owner-scoped project/session and provider selection,
   then builds project context and history.
2. `resolveTurnIntent`/classification and task routing determine whether the
   request is ordinary chat, behavior/forensic work, implementation planning,
   or another structured contract.
3. `chat-agent.ts` selects the tool policy and uses `executeToolLoop`.
   `tool-execution-engine.ts` enforces registered tools, authorization, phase
   policy, root boundaries, cache deduplication, soft limits, and per-scope
   iteration/tool budgets.
4. Reads become provenance/evidence candidates. `evidence-integrity.ts`
   requires same-run, direct, source-scoped evidence for accepted claims;
   fixture/test evidence cannot silently become production proof.
5. Broad queries may use `executeHierarchical` with bounded subtask waves and a
   no-tools synthesis pass. Compound coverage is validated after synthesis.
6. The final response is sanitized/redacted at the API persistence/SSE boundary.
   Structured outcomes, tool traces, evidence, pending changes, and active task
   state are persisted or exposed through allowlisted schemas.

The loop is therefore code-backed as an auditable workflow. It is not a claim
that every provider/model combination, long-running stream, or browser surface
has passed operational acceptance.

## 5. Change-delivery trace

The implemented intended sequence is:

`verified context → implementation/repair plan → pending approval → proposal →
isolated delivery workspace → scoped validation → optional rebase/conflict
resolution → promotion/apply → commit → push`

The source backs the major gates:

- Plans require verified manifests and source excerpts and are not write-authorized
  by default (`implementation-planner.ts`).
- Execution nodes are server-owned, bounded, dependency-aware, and disjoint by
  file scope (`task-session-state.ts`).
- Delivery workspaces and change sets have hashes and a captured base revision
  (`delivery-workspace.ts`).
- Apply checks root containment, duplicate paths, base/hash conflicts, proposal
  state, validation receipt, and journal state (`routes/ai/chat.ts`,
  `ai-change-guard.ts`).
- Validation uses server-owned profiles and isolated workspaces rather than
  model-provided shell text (`ai-repair-validation.ts`,
  `tool-execution-engine.ts`).
- Git commit/push are separate API transitions and require project write access
  (`routes/git.ts`).

The entire sequence is **partial operationally** because the authenticated
browser campaign did not reach a complete delivery terminal state. The isolated
Git route proof passed, while real Git discovery and live-provider promotion
remain blocked by their explicit prerequisites and fixture boundaries.

### Controlled authenticated journey evidence (2026-08-26)

The following checks were run against the current workspace without a
production deployment or broad provider campaign:

- **Passed:** Clerk handoff contract (8 tests), release CORS contract (17
  checks), and the authenticated browser shell's sign-in/navigation path.
- **Passed:** redacted execution-audit preview/download and reload coverage in
  the browser fixture suite.
- **Passed:** `src/routes/git.test.ts` (4 tests), including scoped Apply →
  commit → push, rejection of a mismatched operation, and matching local and
  remote commit identity.
- **Blocked:** the real Git discovery fixture in
  `src/routes/discovery.test.ts` uses a localhost smart-HTTP repository, while
  the production adapter intentionally accepts only credential-free HTTPS
  `github.com` URLs. The route returned the expected `400` policy response
  instead of starting a discovery session.
- **Incomplete:** the full Playwright campaign reached the running Clerk
  services but timed out in later fixture-backed AI/citation tests and exposed a
  restart/readiness failure before any live delivery receipt could be retained.
- **Not run by design:** `DASHBOARD_E2E_LIVE_PROVIDER=1` and
  `DASHBOARD_E2E_LIVE_CAMPAIGN=1`; no provider-backed project, production
  deployment, or broad campaign was used.

Therefore this is authenticated operational evidence plus isolated Git route
evidence, not a complete end-to-end discovery-to-push receipt. The missing
receipt must remain an explicit release blocker.

## 6. Safety and durability inventory

| Guarantee | Enforcement | Baseline assessment |
|---|---|---|
| User/project authorization | Clerk middleware and `requireProjectAccess`/write access on routes | Code-backed; route tests exist |
| Project-root containment | `establishProjectRoot`, `resolveRootPath`, path validation, delivery/apply guards | Code-backed; project-root/path/discovery tests exist |
| Untrusted-content separation | `formatUntrustedContent` on tool output; redaction helpers at AI route persistence/SSE | Code-backed; no live journey |
| Tool authorization | Registered definitions plus `authorizeToolInvocation` and phase/policy checks | Code-backed |
| Server-owned commands | Fixed command profiles; no model-supplied executable or argv | Code-backed |
| Evidence lineage | Run IDs/read attempts/source scopes and final claim validation in `evidence-integrity.ts` | Code-backed; capability evidence boundary requires complete named reads |
| Leases/checkpoints | Postgres execution rows, worker lease/heartbeat, checkpoint versioning and restart reconciliation | Code-backed; dedicated state/job tests exist |
| Idempotency | User/idempotency-key binding, apply journal, task lifecycle/job idempotency helpers | Code-backed; no production concurrency journey |
| Revision/hash binding | Workspace revision, candidate/change-set/promoted hashes and apply/rebase checks | Code-backed |
| Terminal-state rules | Cancellation terminal fence, ownership checks, recovery-to-paused behavior, terminal completion gates | Provider-free AI SSE and operational-safety release checks pass; no browser restart proof |
| Fixture scope | Fixture/test/spec evidence maps to local verdicts and blocks production repair | Code-backed; deterministic benchmark remains contract evidence, not production proof |

## 7. Provider-free verification matrix

Commands below are reproducible from the repository root. None intentionally
requires a live provider key unless noted.

| Check | Command | Fixture/prerequisite | Observed outcome |
|---|---|---|---|
| Orchestrator typecheck | `pnpm --filter @workspace/ai-orchestrator run typecheck` | Installed workspace dependencies | **PASS** (the chained command proceeded to tests) |
| Orchestrator required scenario gate | `pnpm --filter @workspace/ai-orchestrator run validate:benchmark-scenarios` | Deterministic runtime-oracle fixture | **PASS** after runtime-oracle coverage was restored; no live provider involved |
| API typecheck | `pnpm --filter @workspace/api-server run typecheck` | Workspace declaration rebuild | **PASS** |
| Dashboard AI/operations components | `pnpm --filter @workspace/dashboard exec vitest run src/pages/AiChat.authenticated.test.tsx src/pages/MissionControl.test.tsx src/pages/FlightDeck.test.tsx src/lib/mission-correlation-report.test.ts src/lib/validation-sse-contract.test.ts` | jsdom/component fixtures | **PASS**: 5 files, 101 tests |
| API AI/discovery/Git/workflow/task subset | `pnpm --filter @workspace/api-server exec vitest run ...` (selected route and delivery files) | Mocked providers, fixture DB/workspaces | **PARTIAL**: 8 files passed, 3 files failed; 290 passed, 5 failed, 1 skipped |
| API subset failure detail | Same command | See retained test output | Historical failures remain part of the audit record; they are not the latest release-gate result. The latest targeted AI contract/SSE/operational-safety checks pass. Discovery async-contract and live Git smoke are still unproven. |
| Truth-flow baseline | `pnpm run truth:baseline:check && pnpm run truth:validate` | Checked-in schema authority and attached matrix | **PASS** for both |
| Deterministic benchmark baseline | `pnpm run benchmark:baseline:check` and `pnpm run verify:benchmark-rollout` | Checked-in baseline and server-owned candidate/source lineage | **PASS structurally and for regression comparison** (34 cases; comparator returned `rolloutAllowed: true`); the approved deterministic artifact still has `qualityEligible: false`, `rolloutAllowed: false` as intentional safety markers |
| Dashboard client contract | `pnpm run validate:dashboard-client-contract` | OpenAPI/codegen/dashboard declarations | **PASS**: OpenAPI 90 paths/114 operations/156 schemas; generated files and dashboard typecheck aligned |
| Latest AI release quality decision | `pnpm run validate:ai-release` | Provider-free release contract suite; preview/live checks opt-in | **PASS**: 9 checks passed, 0 blocking failures; preview check skipped, live provider disabled |

The latest release decision is authoritative for the provider-free gate, not
for live quality or browser acceptance. The comparator's `rolloutAllowed: true`
means only that the current comparison found no deterministic regression; it
does not override the baseline's live-quality safety markers. Live credentials were not used. The
controlled dashboard journey, live Git delivery, and full release campaign
remain opt-in and are not represented as passes here.

## 8. Known variables and unresolved questions

- **OpenRouter:** startup can refresh a dynamic catalog when a key is present,
  while static free-model candidates remain compatibility data when refresh
  fails or expires. Provider classification and safe recovery guidance are
  provider-free tested; live availability is not proven.
- **Fixture guards:** explicit fixture/capability-audit mode and local verdict
  handling exist, but a fixture result must not be promoted to production
  behavior. The runtime-oracle blocker is closed for the provider-free gate.
- **Provider availability:** dashboard AI operations intentionally require a
  saved provider key. No key was added or changed for this audit.
- **Operational smoke:** authenticated Clerk browser state, API-to-dashboard
  streaming through the proxy, discovery with a real source, full approval to
  promotion, and Git push still require a controlled environment check.
- **Failure triage:** the prior selected API run exposed concurrency ordering,
  cancellation-stream, discovery-fixture, and validation-timeout issues. The
  latest targeted release contracts cover the repaired AI contract,
  cancellation, and bounded-validation paths; discovery and live Git proof
  still need their own evidence.
- **Release status:** the latest provider-free AI release decision passed, but
  the deterministic benchmark baseline still prevents quality rollout and the
  preview/live campaign remains disabled.

## 9. Capabilities requiring a real smoke check

Before calling these operational rather than code-backed, run an authenticated,
provider-configured, isolated check:

1. Discovery source → scan → imported project → dashboard project detail.
2. Ordinary chat SSE with at least one source read and persisted history.
3. Structured analyze/review stream with persisted audit/event output.
4. Task execution and workflow orchestration through their terminal states.
5. Chat plan → approval → isolated validation → apply/promotion.
6. Rebase conflict and successful retry against a changed workspace revision.
7. Flight Deck/Mission Control reload after cancellation, restart recovery, and
   audit export.
8. Git status → source-bound scoped commit → push with a safe fixture remote.

These are acceptance prerequisites, not claims that the capabilities are
absent.
