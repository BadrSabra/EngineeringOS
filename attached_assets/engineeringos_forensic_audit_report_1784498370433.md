# EngineeringOS Forensic Engineering Audit

## Executive summary

- Repository entries: 744 files under `EngineeringOS-main/`.

- Root areas: .agents, artifacts, attached_assets, docs, lib, scripts.

- The codebase is a real monorepo with a runtime API server, dashboard, scanner, knowledge engine, AI orchestrator, DB layer, and generated contract packages.

- Several documentation gaps in `docs/ai-orchestrator-gap-analysis.md` are now fixed in code, but at least four risks remain materially open: mixed-state AI apply/chat, silent loss of invalid pending changes, non-transactional context snapshots, and prefix-based tool dispatch.


## Scope and inventory snapshot

| Top-level | Files | Bytes |
|---|---:|---:|

| `lib` | 249 | 951,572 |

| `artifacts` | 218 | 1,235,382 |

| `attached_assets` | 205 | 9,465,692 |

| `.agents` | 37 | 78,973 |

| `docs` | 15 | 386,815 |

| `scripts` | 8 | 17,826 |

| `.gitattributes` | 1 | 170 |

| `.gitignore` | 1 | 668 |

| `.npmrc` | 1 | 78 |

| `.replit` | 1 | 522 |

| `.replitignore` | 1 | 201 |

| `package.json` | 1 | 941 |

| `pnpm-lock.yaml` | 1 | 263,157 |

| `pnpm-workspace.yaml` | 1 | 6,579 |

| `replit.md` | 1 | 9,082 |

| `tsconfig.base.json` | 1 | 691 |

| `tsconfig.base.json.bak` | 1 | 692 |

| `tsconfig.json` | 1 | 382 |


## Key runtime paths

| Area | Evidence |
|---|---|

| Bootstrap | `artifacts/api-server/src/index.ts` — startup calls reconcileStuckJobs() and fixDeadRootPaths() before app.listen |

| API shell | `artifacts/api-server/src/app.ts` — Express app mounts Clerk/auth/rate limit/helmet and routes |

| Discovery | `artifacts/api-server/src/routes/discovery.ts` — POST /projects/discover creates discovery session and enqueues heavyJobQueue |

| Projects/scan | `artifacts/api-server/src/routes/projects.ts` — POST /projects/:id/scan creates scan job, marks project scanning, enqueues runScanJob |

| AI chat | `artifacts/api-server/src/routes/ai.ts` — POST /ai/chat builds context, calls chat(), persists session/messages, returns pendingChanges |

| AI apply | `artifacts/api-server/src/routes/ai.ts` — POST /ai/chat/apply-changes revalidates paths, writes files, invalidates cache, emits AiChangesApplied event |

| Task execution | `artifacts/api-server/src/routes/tasks.ts` — execute/retry/rollback implement atomic claims and verification state transitions |

| Workflow orchestration | `artifacts/api-server/src/routes/workflows.ts` — start/advance/fail/retry manage phase transitions with guards |

| Git push | `artifacts/api-server/src/routes/git.ts` — push emits GitPushed and queues post-push scan |

| Context builder | `lib/ai-orchestrator/src/context-builder.ts` — TTL cache + Promise.allSettled buildProjectContext |

| Agent parser | `lib/ai-orchestrator/src/parsing.ts` — parseAgentResponse degrades to fallback instead of throwing |

| File tools | `lib/ai-orchestrator/src/tools/file-tools.ts` — write_file queues PendingChange; path guard checks lexical + realpath |

| Chat agent | `lib/ai-orchestrator/src/agents/chat-agent.ts` — tool loop, dedupe cache, JSON correction retry, source merging |

| Knowledge engine | `lib/knowledge-engine/src/queries.ts` — pure async graph queries (path, neighborhood, runtime subgraph, layered view) |

| Scanner | `lib/scanner/src/graph-extractor.ts` — AST + Python extraction builds graph entities/relationships |

| Dashboard AI | `artifacts/dashboard/src/pages/AiChat.tsx` — localStorage pending change queue + apply-changes mutation + query invalidation |


## Documentation vs implementation gaps

| ID | Status | Observation |
|---|---|---|

| G-01 | Likely fixed | context-builder.ts task ordering: Tasks are ordered in the DB with priority ASC, updatedAt DESC, then limited to 10. |

| G-02 | Fixed | apply-changes events: routes/ai.ts now inserts AiChangesApplied and invalidates context cache. |

| G-03 | Fixed | push → graph refresh: routes/git.ts now queues a post-push scan and emits ProjectScanQueued. |

| G-04 | Unresolved | apply ↔ chat race: No server-side lock spans apply and chat context construction. |

| G-05 | Fixed | dashboard refresh after apply: AiChat.tsx invalidates git-status query on success. |

| G-06 | Mitigated | localStorage ghost pending: AiChat.tsx adds 24h TTL and removes stale entries. |

| G-07 | Fixed | workflow nextPhase validation: validateDecision rejects unknown / out-of-order phases. |

| G-08 | Fixed | workflow metrics gate: workflow-orchestrator blocks advance/complete when metrics are unverified. |

| G-09 | Unresolved | silent drop of invalid pendingChanges: fallbackChatOutput still returns pendingChanges: [] on parse/schema failure. |

| G-10 | Partly fixed | silent decision downgrade: parse errors are surfaced as 422, but invalid decisions can still degrade to wait. |

| G-11 | Fixed | no cache in context builder: contextCache TTL exists and invalidateContextCache is used on writes. |

| G-12 | Unresolved | non-transactional reads in context: buildProjectContext still uses Promise.allSettled across separate queries. |

| G-13 | Unresolved | tool dispatch prefix routing: chat-agent still routes by tc.function.name.startsWith('git_'). |

| G-14 | Mixed | apply/commit/push events: apply and push emit events; git commit still appears audit-only in current code. |

| G-15 | Unresolved | generated-files rule: No enforcement of generated-file edits in safePath/write_file. |

| G-16 | Unresolved | rootPath fallback: AI chat falls back to WORKSPACE_PATH when project.rootPath is missing on disk. |


## Risk register snapshot

| ID | Severity | Risk |
|---|---|---|

| R-01 | High | Mixed live/queued state during AI apply and chat. Root cause: No server-side lock around write/apply and subsequent context reads. |

| R-02 | Medium | Silent loss of model-authored pending changes on schema failure. Root cause: fallbackChatOutput drops invalid pendingChanges to []. |

| R-03 | Medium | Non-transactional context snapshots can be internally inconsistent. Root cause: Seven+ DB reads are gathered independently. |

| R-04 | Medium | Tool executor routing is name-prefix based. Root cause: Future tool name collisions could misroute execution. |

| R-05 | Medium | Generated files remain writable by the model. Root cause: No runtime denylist in safePath/write_file. |


## Completion snapshot

| Component | % | Confidence | Basis |
|---|---:|---|---|

| Core runtime API | 92% | Confirmed | Entrypoint, auth, routes, and state machines are implemented. |

| AI orchestration | 88% | Confirmed | Chat/task/review/analyze/workflow flows exist with rate limits and cache invalidation. |

| Graph/query layer | 86% | Confirmed | Knowledge-engine exposes path, neighborhood, layered, and runtime-subgraph queries. |

| Scanner/import pipeline | 84% | Likely | Graph extraction and metric calc are present; runtime provenance breadth needs broader run coverage. |

| Dashboard state sync | 78% | Likely | Apply refresh is wired, but cross-tab/session consistency remains partial. |

| Documentation parity | 74% | Confirmed | Several docs are stale relative to current code, especially gap-analysis items. |

| Generated contract surface | 95% | Confirmed | OpenAPI/Zod/client generation surfaces exist and are wired. |


## Most important evidence notes

- `artifacts/api-server/src/index.ts` performs bootstrap repair work before listening.

- `lib/ai-orchestrator/src/context-builder.ts` now caches contexts for 30 seconds and invalidates on write-like flows.

- `artifacts/api-server/src/routes/ai.ts` now emits `AiChangesApplied`, `AiScanAnalysisCompleted`, `AiCodeReviewCompleted`, and invalidates cache after writes.

- `artifacts/api-server/src/routes/git.ts` queues a post-push scan, keeping graph/metrics fresher after remote changes.

- `artifacts/dashboard/src/pages/AiChat.tsx` persists pending changes locally with TTL cleanup and refreshes `git-status` after apply.

- `lib/ai-orchestrator/src/tools/file-tools.ts` still relies on runtime path checks, but does not enforce a generated-file denylist.


## Unresolved items that need follow-up

- Mixed state between `apply-changes` and concurrent chat requests.

- Silent drop of invalid `pendingChanges` when model output fails schema validation.

- Non-transactional context snapshots across multiple independent queries.

- String-prefix tool routing in the chat agent.


## Missing components / unresolved items

| ID | Component | Status | Why it remains unresolved |
|---|---|---|---|
| M-01 | Server-side lock spanning `apply-changes` and concurrent chat reads | Unresolved | No shared lock or transaction boundary spans disk writes and context reads. |
| M-02 | Hard denylist for generated files inside file tools | Unresolved | `safePath` validates location, but not file class / generation provenance. |
| M-03 | Transactional snapshot for `buildProjectContext` | Unresolved | Context still uses independent reads via `Promise.allSettled`. |
| M-04 | Central tool registry instead of prefix dispatch | Unresolved | Tool routing still depends on `startsWith("git_")`. |
| M-05 | Stronger persistence for invalid model output diagnostics | Unresolved | Invalid `pendingChanges` are collapsed to `[]` on fallback. |

## PR backlog snapshot

| PR | Type | Main target | Risk links | Summary |
|---|---|---|---|---|
| PR-01 | Fix | `lib/ai-orchestrator/src/tools/file-tools.ts`, `artifacts/api-server/src/routes/ai.ts` | R-01, R-05 | Add generated-file denylist and explicit write eligibility checks before queueing changes. |
| PR-02 | Structural | `lib/ai-orchestrator/src/agents/chat-agent.ts` | R-04 | Replace prefix-based tool dispatch with an explicit registry + runtime assertion. |
| PR-03 | Fix | `lib/ai-orchestrator/src/agents/chat-agent.ts`, `lib/ai-orchestrator/src/parsing.ts` | R-02 | Preserve invalid `pendingChanges` as diagnosable metadata instead of silently dropping them. |
| PR-04 | Structural | `lib/ai-orchestrator/src/context-builder.ts` | R-03 | Introduce a snapshot/transaction strategy or version stamp for context reads. |
| PR-05 | Fix | `artifacts/api-server/src/routes/ai.ts`, `artifacts/dashboard/src/pages/AiChat.tsx` | R-01 | Add server-side coordination for apply/write vs. follow-up chat reads. |

## Final engineering verdict

The runtime is real and materially complete across the core paths: bootstrap, discovery, scan, graph, AI orchestration, task execution, workflow advancement, and git push. The biggest remaining issues are not missing features in the abstract; they are correctness boundaries where concurrent state, fallback behavior, and tool dispatch can still produce silent degradation.
