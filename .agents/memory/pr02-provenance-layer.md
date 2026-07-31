---
name: PR-02 provenance layer
description: Decisions and gotchas from enforcing provenance at the DB write layer for graph entities/relationships.
---

## Rule
Every `graphEntitiesTable` and `graphRelationshipsTable` INSERT must carry a populated `provenance` column. The shape is the unified `GraphProvenance = { sourceType, method, extractedAt, evidence? }` defined in `lib/db/src/schema/graph.ts`.

**Why:** Without provenance on DB rows, there is no auditability of where a graph element came from — scanner vs. discovery stub vs. manual seed are indistinguishable.

**How to apply:** All write paths go through one of the three helpers in `artifacts/api-server/src/lib/graph-provenance.ts`:
- `provenanceFromEntity(p, now)` — scanner EntityProvenance → GraphProvenance
- `provenanceFromRelationship(p, now)` — scanner RelationshipProvenance → GraphProvenance
- `manualProvenance(sourceType, method, now, evidence?)` — non-scanner paths (discovery stubs, seeds)

Never construct a `GraphProvenance` literal inline outside that file.

## GraphProvenance shape change
Old (broken): `{ extractor: string, method, extractedAt }`
New (unified): `{ sourceType: string, method, extractedAt, evidence?: GraphEvidenceRecord[] }`

The DB column stays **nullable JSONB** — making it NOT NULL would break historical test inserts and rows from before PR-01. Enforce non-null at the application layer (TypeScript types + helper gate).

## clerkMiddleware must be skipped in test mode
`clerkMiddleware` from `@clerk/express` calls `assertValidSecretKey` at request time and throws "Missing Clerk Secret Key" even before `requireAuth` runs. The fix in `app.ts`: wrap the middleware mount in `if (config.nodeEnv !== 'test') { ... }`. The `requireAuth` test bypass already injects a synthetic `test-user` so handlers see the correct authContext shape in tests.

**Why:** Without this, every supertest request in vitest returns 500 (Clerk error) regardless of which route is being tested.

## walkProject hard-fail breaks old scan tests
`file-walker.ts` throws `Error("Project root does not exist or is inaccessible: ...")` when rootPath is missing (introduced for discovery correctness). Tests that used `/tmp/definitely-does-not-exist-*` paths and expected `job.status === "completed"` must instead:
- Use `mkdtempSync(join(tmpdir(), "prefix-"))` to create a real temp dir
- Clean it up in afterEach with `rmdirSync(dir)` (swallowed if already gone)
- Tests verifying error-path behavior (job fails) can still use non-existent paths — they just must assert `failed`, not `completed`

## DB push prerequisite
The test DB needs `drizzle-kit push --force` run once after schema changes: `pnpm --filter @workspace/db run push-force`. Tables missing = all tests fail with `42P01 relation does not exist`.
