# PostgreSQL schema delivery

The database schema declarations under `src/schema` are the source of truth.
The supported delivery command is:

```sh
pnpm --filter @workspace/db run schema:apply
```

`schema:apply` runs `drizzle-kit push` against the `DATABASE_URL` selected by
the invoking environment, then runs the read-only application contract check.
Drizzle's push operation is idempotent for the existing schema and preserves
rows when adding the nullable `tasks.remediation_plan` column. The follow-up
check is intentional: a successful push is not accepted as proof that the
runtime contract is complete.

Use `schema:check` when DDL is managed by another release step and only
verification is wanted. The separate `check-audit-schema` command verifies the
pending audit outbox; it is not a substitute for the application contract
check. API startup performs both checks read-only and never runs DDL.

The lower-level `push` command remains available for local development and
Drizzle troubleshooting. `push-force` is not part of CI, deployment, or
startup because its purpose is to auto-approve potentially destructive data
loss statements. Schema application must run before starting release traffic.