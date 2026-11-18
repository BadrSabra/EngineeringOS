# EngineeringOS

An engineering operations platform — one console for how your code actually moves. Scan projects, extract dependency graphs, enforce rules, and trace every workflow end-to-end.

## Stack

- **API server**: Express + TypeScript, Clerk auth, Drizzle ORM + PostgreSQL, pino logging
- **Dashboard**: React + Vite + Tailwind v4, Wouter routing, TanStack Query, Clerk React
- **AI orchestrator**: provider strategies are registered for Groq / OpenRouter / Gemini / DeepSeek; product priority is currently OpenRouter free-only, and a registered provider is not automatically eligible for product routing.
- **Knowledge engine**: BFS graph queries, centrality/cluster inference
- **Scanner**: TS compiler API AST extraction, Python AST subprocess for Python files

## Product experience and documentation

The UX documents distinguish current source observations, historical changes,
proposed implementation, and checks that still need independent verification.

- Current UX plan: `docs/dashboard-goal-first-execution-plan.md`.
- AI cost and availability policy: `docs/free-only-ai-execution-plan.md`.
- OpenRouter free-lane rotation RFC: `docs/openrouter-shared-free-lane-cursor-rfc.md`.
- UX review and historical implementation notes: `docs/dashboard-user-experience-review.md`.
- Architectural boundaries and current versus proposed UX: `docs/architecture.md`.

The UX plan is a proposal, not implementation approval or evidence that its
runtime, browser, or usability checks have passed.

## How to run

All services start automatically via the configured workflows:

Use the **Run** button (`Project`) to start the existing services, then open
`/dashboard/` in the app preview. Run package commands from the repository root
with pnpm; there is no root `dev` script.

| Service | Workflow |
|---|---|
| API server | `artifacts/api-server: API Server` |
| Dashboard | `artifacts/dashboard: web` |
| Mockup sandbox | `artifacts/mockup-sandbox: Component Preview Server` |
| Project runtime supervisor | `workspace-runtime-supervisor` |

The release and restart validation workflows are on-demand checks, not required
for ordinary startup.

### Build versus runtime environment

`pnpm run build` runs codegen, typechecking, and every workspace package build
without depending on workflow-injected variables. Vite uses the non-secret
build-only defaults below when these optional overrides are absent:

- `BUILD_PORT` and `BUILD_BASE_PATH` override the build-time server metadata for
  the Dashboard and mockup sandbox.
- `VITE_CLERK_PUBLISHABLE_KEY` is preferred, followed by
  `CLERK_PUBLISHABLE_KEY`. A labeled build-only placeholder is used only when
  neither public value is available; it does not prove that Clerk is configured.
- Release validation rejects a missing, malformed, or build-only placeholder
  Clerk key. It also scans the generated Dashboard output for that placeholder
  before deployment cleanup can complete. The check never prints key values.

The `dev` and `preview` commands remain fail-fast runtime commands: they require
`PORT` and `BASE_PATH`, and the Dashboard additionally requires a valid public
Clerk key. `CLERK_SECRET_KEY` is never read into or embedded in browser output.

## Post-import setup

For a fresh import:

1. `pnpm install --frozen-lockfile` — restores all workspace dependencies.
2. Provision Replit-managed Clerk through the Auth setup if the import has no
   Clerk configuration; do not copy credentials from another app.
3. `pnpm run db:schema:apply` — applies the schema to the development database
   and verifies the application, audit outbox, and operator alert contracts.
4. Start `Project` with the Run button.

These steps have been completed for this import. The frozen pnpm lockfile was
installed, Replit-managed Clerk was provisioned for Development, the development
database schema was applied and checked, and the existing Project workflows
were started. Express was updated within its existing major version because the
imported lockfile's `proxy-addr@2.0.7` download was rejected by the package
firewall. Express 5.3 uses `proxy-addr` 2.0.8 or later; the firewall was not
bypassed.

### Import verification

- `pnpm install --frozen-lockfile` restored dependencies for all 18 workspace
  packages.
- The development database schema, audit outbox schema, and operator alert
  schema checks passed.
- `/api/readiness` and `/api/healthz` return HTTP 200; readiness reports the
  API, database, schema, and maintenance checks ready.
- `/api/projects` without a session returns HTTP 401, confirming authentication
  remains enforced.
- `/dashboard/`, `/dashboard/sign-in`, and `/__mockup/` return HTTP 200. The
  dashboard landing page and Clerk sign-in form were visually checked in the
  browser. Clerk's Development-key warning is expected.
- Controlled signed-in dashboard checks for Workspace restore/SSE and owner
  isolation passed; the full release suite and live AI-provider calls remain
  unverified. AI features return HTTP 428 until a provider key is saved through
  the dashboard.
- The optional `workspace-runtime-supervisor` workflow is disabled because its
  secure Unix-socket provisioning values are unavailable. This does not prevent
  the API or dashboard from starting, but runtime-managed project processes are
  unavailable until that provisioning is completed.

## Required secrets (already provisioned)

- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — auto-provisioned by Replit Clerk
- `SESSION_SECRET` — session signing key
- `DATABASE_URL` — runtime-managed by Replit

## Optional secrets (AI features)

AI features return HTTP 428 until at least one key is saved via the dashboard:

- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY`
- `DEEPSEEK_API_KEY`

## User preferences

- Keep the project's existing structure and stack; do not restructure or migrate.
