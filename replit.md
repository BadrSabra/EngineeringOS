# EngineeringOS

An engineering operations platform — one console for how your code actually moves. Scan projects, extract dependency graphs, enforce rules, and trace every workflow end-to-end.

## Stack

- **API server**: Express + TypeScript, Clerk auth, Drizzle ORM + PostgreSQL, pino logging
- **Dashboard**: React + Vite + Tailwind v4, Wouter routing, TanStack Query, Clerk React
- **AI orchestrator**: Groq / OpenRouter / Gemini / DeepSeek via provider registry with fallback
- **Knowledge engine**: BFS graph queries, centrality/cluster inference
- **Scanner**: TS compiler API AST extraction, Python AST subprocess for Python files

## How to run

All services start automatically via the configured workflows:

| Service | Workflow |
|---|---|
| API server | `artifacts/api-server: API Server` |
| Dashboard | `artifacts/dashboard: web` |
| Mockup sandbox | `artifacts/mockup-sandbox: Component Preview Server` |

## Post-import setup (already done)

1. `pnpm install` — restores node_modules
2. `pnpm --filter @workspace/db run push` — pushes Drizzle schema to the DB
3. `setupClerkWhitelabelAuth()` — provisions Clerk keys

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
