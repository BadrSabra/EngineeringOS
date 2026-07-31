---
name: Knowledge-engine BFS off-by-one
description: getImpactedEntities' maxDepthReached counted a failed final hop; how it was found and fixed.
---

- `getImpactedEntities` (BFS impact traversal) incremented `currentDepth` at the *start* of each loop iteration, before checking whether that hop actually found any new entities. When the final hop found nothing (frontier exhausted, e.g. reached a leaf with no outgoing edges), the increment had already happened, so `maxDepthReached` was off by one (reported one deeper than the graph actually was).
- **Why this stayed hidden:** the repo's aggregate `pnpm run test` runs packages recursively and aborts at the *first* failing package (pnpm's default bail behavior). `lib/knowledge-engine` had zero test files (`vitest run` exits 1 on "no test files found"), so it always failed first and the run never reached `artifacts/api-server`'s route tests — which already asserted the correct (pre-bug) `maxDepthReached` values and were failing silently, unseen, the whole time.
- **Lesson:** a package with no tests in a `pnpm -r` test pipeline isn't neutral — if it exits non-zero (e.g. vitest's default "no test files" behavior) and the runner bails on first failure, it can mask real regressions in every package after it. Either give every package at least one test file, or make sure the aggregate test command doesn't bail before running all packages.
- **Fix:** decrement `currentDepth` back down when a hop finds no new entities, immediately before the `break`, so the counter only reflects hops that actually expanded the frontier.
