# EngineeringOS

An engineering intelligence platform — scan codebases, extract dependency graphs, enforce governance rules, run AI-assisted workflows, and trace every project end-to-end from a single dashboard.

## Stack

- **Monorepo**: pnpm workspace
- **API server**: Node.js + Express (`artifacts/api-server`), port 8080, path `/api`
- **Dashboard**: React + Vite (`artifacts/dashboard`), port 23183, path `/dashboard/`
- **Database**: Replit PostgreSQL (drizzle-orm, schema in `lib/db/src/schema/`)
- **Auth**: Replit-managed Clerk (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`)
- **AI**: Groq-powered orchestrator (`lib/ai-orchestrator/`) with 5 agents, file tools, SSE streaming
- **Scanner**: AST-based dependency graph extraction (TS compiler API + Python AST subprocess)
- **Knowledge engine**: BFS graph queries, centrality/cluster inference

## How to run

Dependencies are installed and the DB schema is pushed. All three workflows start automatically:

| Workflow | Command |
|---|---|
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` |
| `artifacts/dashboard: web` | `pnpm --filter @workspace/dashboard run dev` |
| `artifacts/mockup-sandbox: Component Preview Server` | `pnpm --filter @workspace/mockup-sandbox run dev` |

## Post-import setup (already done)

1. `pnpm install` — install all workspace dependencies
2. `pnpm --filter @workspace/db run push` — push Drizzle schema to PostgreSQL
3. `setupClerkWhitelabelAuth()` — provision Replit-managed Clerk secrets

## Key environment variables

- `DATABASE_URL` / `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` — auto-provisioned by Replit
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — provisioned via Clerk auth skill
- `AI_CREDENTIALS_ENCRYPTION_KEY` — set in `.replit` userenv
- `SESSION_SECRET` — set as a Replit secret

## User preferences

- Keep the existing monorepo structure — do not restructure or migrate packages
- Use pnpm; never npm or yarn
