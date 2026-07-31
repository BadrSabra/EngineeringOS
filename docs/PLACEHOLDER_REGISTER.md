# EngineeringOS — Placeholder Register

> آخر تحديث: 2026-07-15. مرتبط بـ PR 04 (Placeholder / Stub / Dead-Code Cleanup).

This register lists the main files that contain explicit placeholder/stub/mock/temporary language or code patterns, plus the files that deserve a second review because they are the main hot spots in the scan.

| File | Why it appears here | Evidence | Risk | Verify next |
|---|---|---|---|---|
| `artifacts/api-server/src/routes/discovery.ts` | marker-heavy file (12 hits) | `throw new Error` on path checks; `return null` in JSON parsing | Medium | Inspect whether this is a true stub, a deliberate example, or a harmless implementation note. |
| `artifacts/dashboard/src/pages/AiChat.tsx` | marker-heavy file (8 hits) | `placeholder="gsk_…"` in Groq key input; `throw new Error` in fetch helper | Medium | `placeholder` on key input field is correct UX (example format hint) — not a stub. |
| `artifacts/api-server/src/lib/discovery-adapters.test.ts` | marker-heavy file (7 hits) | `Fake` test data; `throw new Error` in test guards | Low | Test-only patterns — not production stubs. |
| `artifacts/dashboard/src/components/ui/chart.tsx` | marker-heavy file (7 hits) | `throw new Error` in context guards; `return null` | Low | Standard React context guard pattern — not a stub. |
| `lib/api-client-react/src/custom-fetch.ts` | marker-heavy file (7 hits) | Comment `not implemented`; `return null` in parse fallback | Medium | Review the `not implemented` comment — confirm it is a comment about what the runtime doesn't do, not a missing impl. |
| `artifacts/api-server/src/lib/discovery-adapters.ts` | marker-heavy file (6 hits) | `Temporary` in a comment about resource management; `return null` | Low | Comment-level note — not functional stub. |
| `artifacts/api-server/src/middlewares/requireProjectAccess.ts` | marker-heavy file (6 hits) | `return undefined` as sentinel in `loadProjectByIdForUser` | Low | Intentional — function writes the HTTP response and returns undefined as a signal to callers. |
| `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` | marker-heavy file (5 hits) | `placeholder="/home/runner/workspace/my-project"` | Medium | Placeholder text in form input — acceptable as example hint but could be more generic. |
| `artifacts/dashboard/src/pages/Rules.tsx` | marker-heavy file (5 hits) | `placeholder="Filter rules..."` | Low | Standard search-field placeholder — correct UX, not a stub. |
| `artifacts/api-server/src/routes/ai.test.ts` | marker-heavy file (4 hits) | `Stub` / `Mock` — test file explicitly mocks @workspace/ai-orchestrator | Low | Test-only patterns — expected in test files. |
| `lib/scanner/src/graph-extractor.ts` | marker-heavy file (4 hits) | `Stub` in a comment about import resolution level; `return null` | Low | Comment-level documentation of algorithm edge case — not a functional stub. |
| `artifacts/api-server/src/lib/path-validation.ts` | marker-heavy file (3 hits) | `return null` as error sentinel | Low | Intentional — callers check for null to detect invalid path. |
| `artifacts/api-server/src/lib/scan-runner.ts` | marker-heavy file (3 hits) | `throw new Error` on project-not-found; `return null` in relationship dedup | Low | Correct fail-fast and dedup patterns — not stubs. |
| `artifacts/api-server/src/routes/projects.test.ts` | marker-heavy file (3 hits) | `throw new Error` in test timeout helper | Low | Test utility — not production code. |
| `artifacts/dashboard/src/components/ui/form.tsx` | marker-heavy file (3 hits) | `throw new Error` in context guards; `return null` | Low | Standard shadcn/ui context guard — not a stub. |
| `artifacts/dashboard/src/pages/Graph.tsx` | marker-heavy file (3 hits) | `placeholder="Find entity..."` ; `return null` in render guard | Low | UI placeholder text + null render guard — both correct. |
| `artifacts/dashboard/src/pages/Workflows.tsx` | marker-heavy file (3 hits) | `placeholder="e.g. Release Pipeline"` | Low | Example hint text — acceptable. |
| `artifacts/dashboard/vite.config.ts` | marker-heavy file (3 hits) | `throw new Error` when PORT not set | Low | Correct fail-fast on missing required env var. |
| `artifacts/api-server/src/config.ts` | marker-heavy file (2 hits) | `throw new Error` on invalid config | Low | Correct fail-fast Zod validation — not a stub. |
| `artifacts/api-server/src/lib/credentials-crypto.ts` | marker-heavy file (2 hits) | `throw new Error` when encryption key missing | Low | Correct fail-fast — not a stub. |
| `artifacts/api-server/src/lib/job-queue.test.ts` | marker-heavy file (2 hits) | `throw new Error` in test timeout helper | Low | Test utility — not production code. |
| `artifacts/api-server/src/routes/discovery.test.ts` | marker-heavy file | `Fake` test data values | Low | Test-only patterns. |
| `artifacts/dashboard/src/App.tsx` | marker-heavy file | `throw new Error` on missing VITE_CLERK_PUBLISHABLE_KEY; `return null` | Low | Correct fail-fast + React Suspense null guard. |
| `artifacts/dashboard/src/components/layout/Shell.tsx` | marker-heavy file | `placeholder="Search projects, tasks, rules... (Press '/')"` | Low | Search hint text — correct UX. |
| `artifacts/dashboard/src/components/ui/field.tsx` | marker-heavy file | `return null` in error display | Low | Standard conditional render — not a stub. |
| `artifacts/dashboard/src/index.css` | marker-heavy file | `placeholder` in CSS selector (`[placeholder]:empty::before`) | Low | CSS attribute selector — not a stub. |
| `lib/scanner/src/file-walker.ts` | marker-heavy file | `throw new Error` on file limit exceeded | Low | Correct guard — not a stub. |
| `lib/scanner/src/rule-matcher.ts` | marker-heavy file | `return null` on invalid regex | Low | Correct sentinel — not a stub. |
| `artifacts/api-server/.replit-artifact/artifact.toml` | marker-heavy file | `TODO` comment about excluding API Server from preview | Low | Config-level comment — track separately; does not affect runtime. |
| `artifacts/api-server/src/lib/job-queue.ts` | marker-heavy file | `throw new Error` on invalid concurrency | Low | Correct constructor guard — not a stub. |
| `artifacts/api-server/src/lib/plugin-runtime.ts` | marker-heavy file | `Placeholder` comment for doc-ratio metric until doc-extraction lands | **Medium** | This IS a real placeholder — doc coverage ratio uses a hardcoded 0.0 until scanner extracts doc comments. Tracked in PR 04. |
| `artifacts/api-server/src/middlewares/requireAuth.test.ts` | marker-heavy file | `Mock` — explicitly mocks Clerk for unit tests | Low | Correct test pattern — see clerk-auth-testing memory entry. |
| `artifacts/api-server/src/routes/ai.ts` | marker-heavy file | `return null` as key-not-found sentinel | Low | Intentional — callers check for null before using key. |
| `artifacts/api-server/src/types/express.d.ts` | marker-heavy file | Comment `not implemented yet` about future role/permissions extension | Low | Documentation comment about a known future extension point — not a code stub. |
| `artifacts/dashboard/src/components/ui/carousel.tsx` | marker-heavy file | `throw new Error` in context guard | Low | Standard shadcn/ui context guard — not a stub. |

## True stubs requiring action (PR 04 scope)

| File | Stub | Action |
|---|---|---|
| `artifacts/api-server/src/lib/plugin-runtime.ts` | doc-coverage ratio hardcoded to 0.0 | Implement doc-comment extraction in scanner, or expose the ratio as `null`/unavailable until implemented. |
| `lib/api-client-react/src/custom-fetch.ts` | `not implemented` comment | Verify the comment is a truthful note about what the HTTP runtime doesn't support (e.g. request cancellation), not a missing feature. Update comment to be explicit. |
| `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` | example path `/home/runner/workspace/my-project` as placeholder hint | Consider replacing with a more portable example (`/path/to/your/project`) so it doesn't imply a Replit-specific path. |

## Archived evidence files
The `attached_assets/` directory also contains many files with `Mock`, `Placeholder`, and `Temporary` in their names or content. Most are archival evidence, not production runtime. Keep them cataloged, but do not treat them as live app code unless a runtime import proves otherwise.
