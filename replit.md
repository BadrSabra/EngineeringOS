# EngineeringOS

A full-stack engineering intelligence platform built on a pnpm monorepo. Scans codebases, builds knowledge graphs, enforces governance rules, and orchestrates AI-powered engineering workflows from a single dashboard.

## Architecture

| Artifact | Path | Preview |
|---|---|---|
| API Server (Express) | `artifacts/api-server` | `/api` |
| Dashboard (React + Vite) | `artifacts/dashboard` | `/dashboard/` |
| Mockup Sandbox (design) | `artifacts/mockup-sandbox` | `/__mockup` |

Shared libraries in `lib/`:
- `lib/db` — Drizzle ORM schema + PostgreSQL client (Replit managed DB)
- `lib/ai-orchestrator` — Groq-powered multi-agent AI layer
- `lib/knowledge-engine` — BFS graph queries, centrality, cluster inference
- `lib/scanner` — TypeScript/Python AST extractor + TS compiler API
- `lib/api-zod` — Shared Zod schemas + OpenAPI spec
- `lib/api-client-react` — Generated React Query API client

## Running the Project

All three workflows start automatically. The run order is not strict — the dashboard and API server are independent.

**API Server** (`artifacts/api-server: API Server`):
```
pnpm --filter @workspace/api-server run dev
```
Builds with esbuild then starts with Node. Listens on `$PORT`.

**Dashboard** (`artifacts/dashboard: web`):
```
pnpm --filter @workspace/dashboard run dev
```
Vite dev server with HMR. Listens on `$PORT`.

## Required Secrets

| Secret | Where to get it | Required? |
|---|---|---|
| `CLERK_SECRET_KEY` | Auto-provisioned by Replit Clerk integration | Yes |
| `CLERK_PUBLISHABLE_KEY` | Auto-provisioned by Replit Clerk integration | Yes |
| `VITE_CLERK_PUBLISHABLE_KEY` | Auto-provisioned by Replit Clerk integration | Yes |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) | Yes (AI features) |
| `SESSION_SECRET` | Any random string (already set) | Yes |

`AI_CREDENTIALS_ENCRYPTION_KEY` is set as an env var (not a secret) — already configured.

## Database

Uses Replit's managed PostgreSQL. `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` are injected automatically at runtime — do not set them manually.

To push schema changes:
```
cd lib/db && pnpm run push
```

## First-time Setup (after import)

1. `pnpm install` — install all workspace dependencies
2. `cd lib/db && pnpm run push` — push Drizzle schema to the managed database
3. Provision Clerk via Replit Auth pane (or `setupClerkWhitelabelAuth()` in agent)
4. Add `GROQ_API_KEY` secret for AI orchestration features

### Setup status (2026-07-21)

| Step | Status |
|---|---|
| `pnpm install` | ✅ Done — 659 packages resolved |
| DB schema push (`drizzle-kit push`) | ✅ Done — schema applied to managed PostgreSQL |
| Clerk auth provisioned | ✅ Done — `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` set |
| `GROQ_API_KEY` | ⚠️ Still needed — add to Replit Secrets to enable AI features |
| `SESSION_SECRET` | ✅ Pre-existing |
| `AI_CREDENTIALS_ENCRYPTION_KEY` | ✅ Pre-existing env var |
| Workflows | ✅ All three running (API server, dashboard, mockup sandbox) |

## Key Conventions

- All routes under `/api/` are served by the Express API server
- Clerk auth uses cookie-based sessions for web (no Bearer tokens in browser code)
- `requireAuth` middleware reads `getAuth(req)` from `@clerk/express`
- Context cache invalidation: any DB write to a context-builder table must call `invalidateContextCache`
- Codegen: run `pnpm codegen` after changing `lib/api-zod`; drift is checked in CI via `pnpm codegen:check`

## User Preferences

- Keep existing monorepo structure — do not migrate or restructure
- Use pnpm workspace conventions throughout
