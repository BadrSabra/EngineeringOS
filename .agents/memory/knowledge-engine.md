---
name: Knowledge engine package
description: lib/knowledge-engine — semantic graph queries and inference; key setup rules and design decisions.
---

# Knowledge Engine Package

## Package location
`lib/knowledge-engine/` — a lib-style pnpm workspace package (`@workspace/knowledge-engine`).

## What it provides
- **`queries.ts`**: DB-backed BFS traversal functions (no writes, no side effects):
  - `getImpactedEntities(db, entityId, maxDepth=4)` — outgoing transitive impact
  - `getShortestPath(db, fromId, toId, maxDepth=5)` — BFS directed path finding
  - `getNeighborhood(db, entityId, depth=2)` — bidirectional N-hop subgraph
  - `fetchProjectGraph(db, projectId)` — all entities + relationships for a project
- **`inference.ts`**: in-memory computations over fetched arrays (no DB calls):
  - `computeCentrality(entities, relationships)` — degree centrality per entity
  - `detectClusters(entities, relationships)` — union-find connected components
  - `computeGraphSummary(projectId, entities, relationships)` — full summary stats

## Critical setup rule
`drizzle-orm` must be declared as a **direct dependency** of `lib/knowledge-engine/package.json`
(not just a transitive dep via `@workspace/db`). TypeScript resolution fails otherwise with
`Cannot find module 'drizzle-orm'` even though drizzle is used transitively.

**Why:** discovered during setup — `tsc --build` resolves module declarations strictly; transitive
packages from workspace deps are not automatically hoisted to the importing package's resolution.

**How to apply:** add `"drizzle-orm": "catalog:"` to `lib/knowledge-engine/package.json` dependencies
whenever this package imports anything from `drizzle-orm` directly (eq, inArray, and, etc.).

## Exposed API endpoints (graph routes)
- `GET /api/graph/impact?entityId=&maxDepth=` — uses `getImpactedEntities`
- `GET /api/graph/path?fromId=&toId=&maxDepth=` — uses `getShortestPath`
- `GET /api/graph/summary/:projectId` — uses `fetchProjectGraph` + `computeGraphSummary`

## Schema additions
Added to `lib/db/src/schema/graph.ts`:
- `scanJobId` (nullable FK → scan_jobs) on both `graph_entities` and `graph_relationships`
- `confidence` (real 0–1) on `graph_relationships`
- `provenance` (jsonb, type `GraphProvenance`) on both tables
