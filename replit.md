# EngineeringOS

An engineering operations platform — one console for how your code actually moves. Scan projects, extract dependency graphs, enforce rules, and trace every workflow end-to-end.

## Stack

- **API server**: Express + TypeScript, Clerk auth, Drizzle ORM + PostgreSQL, pino logging
- **Dashboard**: React + Vite + Tailwind v4, Wouter routing, TanStack Query, Clerk React
- **AI orchestrator**: Groq / OpenRouter / Gemini / DeepSeek via provider registry with fallback
- **Knowledge engine**: BFS graph queries, centrality/cluster inference
- **Scanner**: TS compiler API AST extraction, Python AST subprocess for Python files

## Product experience and documentation

The UX documents distinguish current source observations, historical changes,
proposed implementation, and checks that still need independent verification.

- Current UX plan: `docs/dashboard-goal-first-execution-plan.md`.
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

The current import has completed these steps. Express was updated within its
existing major version because the imported lockfile's `proxy-addr@2.0.7`
download was rejected by the package firewall. Express 5.3 uses `proxy-addr`
2.0.8 or later; the firewall was not bypassed.

### Import verification

- `/api/readiness`: HTTP 200; API, database, and schema report ready.
- `/api/healthz`: HTTP 200.
- `/api/projects` without a session: HTTP 401 (authentication remains enforced).
- `/dashboard/` and `/dashboard/sign-in`: visually checked; the Arabic landing
  page and Clerk sign-in form render.
- Signed-in dashboard journeys and live AI-provider calls have not been
  verified. AI features still require a provider key.
- The development-banner plugin requests an unprefixed script and logs a 404
  under the dashboard preview path; it does not prevent the app or sign-in form
  from rendering.
- For browser checks after a fresh import, install the test browser with
  `pnpm --filter @workspace/dashboard exec playwright install firefox`.
  Firefox was installed and independently opened the dashboard landing page.
- The dashboard restart smoke check passed. The broader release checks did not
  pass: their browser run initially lacked Firefox; a separate API regression
  run then failed the stream completion assertion in
  `src/routes/ai-stream-integration.test.ts` and timed out in the matching
  paired-baseline auto-promotion case in `src/routes/ai.test.ts`.
  These are not resolved by import setup; do not treat startup readiness as
  release approval. The full release/browser suites have not been rerun after
  installing Firefox.

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
