---
name: Scanner governance fixes
description: GAP-1 through GAP-5 from the Discovery & Scanner governance audit — what was fixed and the key patterns to keep consistent.
---

Five gaps from `docs/governance/discovery-scanner-origin-of-truth.md` were closed.

**GAP-1 – Stale entity/relationship deletion**
- `scan-runner.ts`: on every re-scan, ALL existing relationships for the project are deleted and fully re-inserted (relationships are always recomputed from scratch).
- Stale entities (those whose `type::path::name` key is absent from the current scan output) are deleted with `inArray(graphEntitiesTable.id, staleEntityIds)`.
- In-memory maps (`entityKeyToId`, `entityNameToIds`) are pruned of stale entries before relationship resolution so no edge is created pointing to a deleted entity ID.

**Why:** The old upsert-only strategy left deleted/renamed functions in the graph forever, causing Knowledge Graph divergence from source truth after every code change.

**GAP-2 – extractorVersion**
- `SCANNER_VERSION = "1.0.0"` exported from `lib/scanner/src/index.ts`.
- Bump this constant (and `lib/scanner/package.json`) whenever extraction logic changes.
- Passed as `extractorVersion` in `ProvenanceOptions` to every `provenanceFromEntity`, `provenanceFromRelationship`, and `manualProvenance` call.

**GAP-3 – scanSessionId**
- `correlationId` from `performScan()` is now threaded through `ProvenanceOptions` to every provenance builder.
- `ProvenanceOptions` interface lives in `artifacts/api-server/src/lib/graph-provenance.ts` — all three helper functions accept it as an optional third argument.
- `GraphProvenance` type in `lib/db/src/schema/graph.ts` gained `scanSessionId?: string` and `extractorVersion?: string`.

**GAP-4 – Deterministic file walk**
- `lib/scanner/src/file-walker.ts`: `files.sort((a, b) => a.path.localeCompare(b.path))` added after `walkDir()` completes.

**GAP-5 – Heuristic fallback evidence**
- `lib/scanner/src/graph-extractor.ts` `buildRelationshipProvenance`: fallback evidence (no real call-site) now uses `kind: "heuristic"` instead of `"import-statement"` / `"call-site"`, so consumers can distinguish position-less fallbacks from verified source locations.

**How to apply:** Any new write path that inserts graph entities/relationships must go through the helpers in `graph-provenance.ts` and pass `{ scanSessionId, extractorVersion: SCANNER_VERSION }`. Any logic change in the extractor must bump `SCANNER_VERSION`.
