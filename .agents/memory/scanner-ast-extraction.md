---
name: Scanner AST rewrite
description: graph-extractor.ts extraction approach and known coverage gaps, for anyone extending entity/relationship extraction.
---

- `lib/scanner/src/graph-extractor.ts` parses TS/JS via the TypeScript compiler API (`ts.createSourceFile`, `setParentNodes: false` since the walk never reads `.parent`) instead of line-by-line regex. Python stays regex-based — no lightweight AST parser was available without adding a new heavy dependency.
- `typescript` had to move from `devDependencies` to `dependencies` in `lib/scanner/package.json` once parsing became a runtime concern, not just a build-time one.
- Known, intentionally-deferred gaps in extraction coverage (flagged by code review, not yet built): CommonJS `require`/`module.exports`, TS `export =`, and class methods as their own function entities. Extend `extractFromTsJs` in graph-extractor.ts if any of these become needed.
- **Why deferred:** none of these were supported by the old regex extractor either, so skipping them is not a regression — just a scoping boundary for the AST-rewrite task.
