# Discovery & Scanner Layer — Origin of Truth Governance Audit

> **Date**: 2026-07-25  
> **Scope**: `lib/scanner/**`, `artifacts/api-server/src/routes/discovery.ts`, `artifacts/api-server/src/services/discovery/*`, `artifacts/api-server/src/lib/scan-runner.ts`, `artifacts/api-server/src/lib/graph-extractor.ts`, `artifacts/api-server/src/lib/graph-provenance.ts`

---

## Why This Layer Matters

This layer is the **Root of Evidence** (أصل الدليل). If it is incorrect:
- The Knowledge Graph will be wrong.
- The inference engine will build false conclusions.
- The AI will operate on incorrect context.
- The Audit layer will record decisions based on invalid evidence.

The standard: every Entity, Relationship, and Metric inside EngineeringOS must be traceable to a specific original piece of evidence inside the project, with knowledge of _how_, _when_, and _by which extractor version_ it was extracted.

---

## Evaluation Criteria

| Criterion | Question |
|---|---|
| **Responsibility** | What is its sole responsibility? |
| **Inputs** | What does it trust? |
| **Outputs** | What does it produce? |
| **Determinism** | Do the same inputs always yield the same outputs? |
| **Provenance** | Is the origin of every fact preserved? |
| **Evidence** | Does every inference have a source? |
| **Failure** | How does it behave on errors? |
| **Drift** | How does it detect deviation? |
| **Dependencies** | What does it rely on? |
| **Verdict** | Proven / Partially Proven / Not Proven |

---

## Component-by-Component Analysis

### 1. Discovery Orchestration (`routes/discovery.ts`, `services/discovery/discovery-runner.ts`)

| Criterion | Finding |
|---|---|
| **Responsibility** | Orchestrates project ingestion (detect name, languages, frameworks, architecture) and imports results into the DB |
| **Inputs** | `StartDiscoveryBody` (sourceType ∈ {LOCAL_FOLDER, GIT_REPOSITORY, WORKSPACE_PROJECT, ARCHIVE_UPLOAD}, sourceConfig) |
| **Outputs** | `DiscoverySession` rows, `Project` rows, initial `GraphEntity` stubs |
| **Failure** | Errors are written to the discovery session row; temp directories (git clones) cleaned via `try/finally` |
| **Confidence** | `computeConfidence` scores based on metadata density (name, language, framework, runtime, etc.) |
| **Incremental** | Opportunistic cleanup of sessions older than 24h; no drift detection |

**Verdict**: ✅ Partially Proven  
**Gap**: Discovery sourceType (Git/Workspace/Upload) is stored at the session level only — not propagated into individual entity provenance records.

---

### 2. Scan Runner (`artifacts/api-server/src/lib/scan-runner.ts`)

| Criterion | Finding |
|---|---|
| **Responsibility** | Executes full project scans out-of-band: walk → match → extract → compute metrics → persist |
| **Inputs** | `projectId`, `jobId` |
| **Outputs** | Updated project scores, tasks, metrics, knowledge graph entities/relationships, audit events |
| **Failure** | PostgreSQL advisory locks prevent concurrent scans; failures logged to `scanJobsTable`, `eventsTable`, and `audit_logs` |
| **Statelessness** | `extractGraph` is pure CPU work done outside DB transactions |

**Verdict**: ✅ Partially Proven  
**Gap**: Re-scan uses **upsert/merge** — old entities/relationships are **never deleted** if they disappear from source code. No stale-graph cleanup pass exists.

---

### 3. File Walker (`lib/scanner/src/file-walker.ts`)

| Criterion | Finding |
|---|---|
| **Responsibility** | Recursively traverse directories, collecting source files respecting ignore lists and limits |
| **Inputs** | `rootPath` |
| **Outputs** | `WalkResult` with `ScannedFile[]` (`relPath`, `absPath`, `lang`, `content`, `sizeBytes`) |
| **Failure** | Soft-truncate at `MAX_FILES=5000` or `MAX_DEPTH=12`: returns partial result with `truncated: true` rather than failing |
| **Determinism** | ⚠️ `Promise.all(readdir entries)` — file order depends on OS/filesystem scheduling; output array is not sorted |

**Verdict**: ⚠️ Partially Proven  
**Gap**: Non-deterministic walk order. Same codebase scanned twice may produce entities in different order, causing spurious diff noise in incremental comparisons.

---

### 4. Graph Extractor (`lib/scanner/src/graph-extractor.ts`, `python-extractor.ts`)

| Criterion | Finding |
|---|---|
| **Responsibility** | Extract entities (functions, classes, APIs) and relationships (imports, calls, extends) from file content using AST parsers |
| **Inputs** | `ScannedFile[]` (file content already in memory) |
| **Outputs** | `GraphExtractionResult` (entities + relationships, each with provenance) |
| **Purity** | `extractFromTsJs` is pure over `ScannedFile` input; closes over `entities[]` and `relationships[]` arrays (local to each call) |
| **External State** | `cachedScriptPath` in `python-extractor.ts` is module-level mutable (optimization, not functional state) |
| **Disk Access** | `python-extractor.ts` writes a temp script to disk and spawns `python3` subprocess |

**Confidence model** (fixed enum, not heuristic):

| Source Type | Confidence |
|---|---|
| `typescript-ast` | 1.0 |
| `python-ast` | 0.95 |
| `manual` | 1.0 |
| `regex-fallback` | 0.5 |
| _(default)_ | 0.7 |

Non-exported TS symbols are downgraded to 0.5.

**Verdict**: ⚠️ Partially Proven  
**Gaps**:
- `cachedScriptPath` is module-level mutable — breaks strict statelessness.
- `line` and `column` are optional in `GraphEvidence`; some relationships created via fallback path have **no line number or snippet** (only file + kind label).

---

### 5. Rule Matcher (`lib/scanner/src/rule-matcher.ts`)

| Criterion | Finding |
|---|---|
| **Responsibility** | Regex-based pattern matching against file content to detect rule violations |
| **Outputs** | `RuleMatch[]` with file, line, and snippet |
| **Drift** | `checkPatternInFiles` allows verifying if a specific violation still exists (used for task auto-closure) |

**Verdict**: ✅ Proven for its scope

---

### 6. Metrics Calculator (`lib/scanner/src/metrics-calc.ts`)

| Criterion | Finding |
|---|---|
| **Responsibility** | Derive quality scores and technical debt estimates from rule matches |
| **Confidence** | Weighted penalties: `critical`=15, `high`=8, `medium`=4, `low`=1 |

**Verdict**: ✅ Proven for its scope

---

### 7. Provenance Helper (`artifacts/api-server/src/lib/graph-provenance.ts`)

| Criterion | Finding |
|---|---|
| **Responsibility** | Centralized factory for consistent `GraphProvenance` objects |
| **Fields Tracked** | `sourceFile`, `evidence.line` (lineRange), `method` (parser), `confidence`, `extractedAt` (timestamp), `projectId` (at table level) |

**Verdict**: ⚠️ Partially Proven  
**Gaps**: `extractorVersion` and `scanSessionId` are **not part of the `GraphProvenance` interface**. `projectId` is denormalized at the DB row level, not embedded in the provenance object itself.

---

## Governance Question Summary

| # | Governance Question | Verdict | Key Gap |
|---|---|---|---|
| 1 | Source Authenticity | ✅ Proven | SourceType is session-level only, not per-entity |
| 2 | Provenance Completeness | ⚠️ Partially Proven | Missing: `extractorVersion`, `scanSessionId` in provenance interface |
| 3 | Incremental Correctness | ❌ Not Proven | No deletion of stale entities/relationships on re-scan; no drift detection |
| 4 | Determinism | ⚠️ Partially Proven | File walk order is OS-dependent (not sorted); entity IDs use `randomUUID()` |
| 5 | Extraction Integrity | ⚠️ Partially Proven | `cachedScriptPath` mutable module state; python-extractor touches disk |
| 6 | Confidence Model | ✅ Proven | Clear enum + downgrade rule for non-exported symbols |
| 7 | Evidence Quality | ⚠️ Partially Proven | Fallback relationship evidence missing line/snippet |
| 8 | Failure Model | ✅ Proven | File-level isolation, fallback to regex, truncated flag |
| 9 | Performance Governance | ⚠️ Partially Proven | Advisory locks + job queue; no cancellation or memory-limit enforcement |
| 10 | Truth Guarantee | ⚠️ Partially Proven | Evidence chain is mostly intact; gaps in stale-graph cleanup and versioning break the full guarantee |

---

## Prioritized Gaps

### 🔴 Critical (breaks the Evidence Chain)

**GAP-1: No stale entity/relationship deletion on re-scan**  
`scan-runner.ts` upserts but never deletes. If a function is renamed or deleted, its old entity remains in the graph indefinitely. The graph diverges from truth after the first code change.

**GAP-2: `extractorVersion` not tracked in provenance**  
There is no way to know *which version* of the scanner produced a given entity. When the scanner logic changes, old and new extractions are indistinguishable.

**GAP-3: `scanSessionId` not embedded in provenance objects**  
`correlationId` exists in scan-runner logs but is not propagated into `GraphProvenance`. Cannot query "all entities from scan session X".

### 🟡 Significant (reduces reliability)

**GAP-4: Non-deterministic file walk order**  
`file-walker.ts` does not sort its output. Two scans of identical code may produce different entity orderings, making incremental diff comparisons noisy.

**GAP-5: Fallback relationship evidence missing line+snippet**  
`buildRelationshipProvenance` fallback path produces evidence with only `file` + `kind` label — no line number or code snippet. Relationships without line evidence cannot be validated or shown in the UI.

**GAP-6: SourceType (Git/Workspace/Upload) not per-entity**  
Discovery sourceType is stored at the session level. Individual entities do not record whether they came from a Git repo, a workspace upload, or a local folder.

### 🟢 Minor (quality improvements)

**GAP-7: `cachedScriptPath` module-level mutable state**  
The Python extractor optimization uses a module-level cache variable. This breaks strict statelessness and makes the module non-trivially testable in isolation.

**GAP-8: `line`/`column` optional in `GraphEvidence`**  
Some callers omit these fields. Making them required (or providing a typed `PointEvidence` vs `RangeEvidence` discriminated union) would enforce completeness at the type level.

---

## Final Verdict

> **The Discovery & Scanner layer is NOT yet the Root of Evidence.**

It is a strong foundation — AST-based extraction, file-level failure isolation, a clear confidence model, and provenance factories are all in place. But the Evidence Chain has three critical breaks:
1. Stale entities are never removed after code changes.
2. Extractor version is not tracked.
3. Scan session is not embedded in provenance.

Until these three gaps are closed, it is not possible to make the statement:

> "Every Entity, Relationship, and Metric inside EngineeringOS can be traced back to a specific original piece of evidence inside the project, with knowledge of how, when, and by which version of the Scanner it was extracted."

---

## Recommended Fixes (Ordered by Impact)

| # | Fix | Status | Files Changed |
|---|---|---|---|
| 1 | Delete stale graph elements on re-scan | ✅ **Implemented** | `artifacts/api-server/src/lib/scan-runner.ts` |
| 2 | Add `extractorVersion` to `GraphProvenance` | ✅ **Implemented** | `lib/db/src/schema/graph.ts`, `lib/scanner/src/index.ts`, `graph-provenance.ts`, `scan-runner.ts` |
| 3 | Propagate `scanSessionId` into `GraphProvenance` | ✅ **Implemented** | `graph-provenance.ts`, `scan-runner.ts` |
| 4 | Sort `file-walker` output | ✅ **Implemented** | `lib/scanner/src/file-walker.ts` |
| 5 | Use `heuristic` kind for position-less fallback evidence | ✅ **Implemented** | `lib/scanner/src/graph-extractor.ts` |
| 6 | Propagate sourceType (Git/Workspace/Upload) per entity | ⏳ Deferred — requires discovery session join at scan time | — |

### Implementation Notes

**GAP-1 (Stale deletion)**: On each re-scan, all existing relationships for the project are deleted and fully re-inserted (relationships are always recomputed). Entities are pruned: any entity whose `type::path::name` key is not present in the current scan output is deleted. In-memory maps are updated before relationship resolution to prevent linking to deleted IDs.

**GAP-2 (extractorVersion)**: `SCANNER_VERSION = "1.0.0"` is exported from `lib/scanner/src/index.ts`. Bump this constant (and `lib/scanner/package.json`) whenever extraction logic changes. Every `GraphProvenance` object now carries `extractorVersion`.

**GAP-3 (scanSessionId)**: The `correlationId` from `performScan()` is passed through `ProvenanceOptions` to every `provenanceFromEntity`, `provenanceFromRelationship`, and `manualProvenance` call. Every stored provenance record now carries `scanSessionId`.

**GAP-4 (Determinism)**: `files.sort((a, b) => a.path.localeCompare(b.path))` added after `walkDir()` in `walkProject()`. Output is now lexicographically ordered by relative path regardless of OS filesystem scheduling.

**GAP-5 (Fallback evidence)**: The position-less fallback in `buildRelationshipProvenance` now uses `kind: "heuristic"` instead of `"import-statement"` / `"call-site"`. Only evidence records with real source locations should use the specific kinds.

**GAP-6 (SourceType per entity)**: Deferred. Requires threading the `SourceType` from the `discovery_sessions` row through to `scan-runner.ts`. Discovery sourceType is still only at the session level.

---

## Revised Verdict (Post-Fix)

The three critical Evidence Chain breaks are now closed:
1. ✅ Stale entities/relationships are pruned on every re-scan.
2. ✅ `extractorVersion` is stamped on every stored element.
3. ✅ `scanSessionId` links every element to its originating scan job.

The statement is now conditionally true for all entities produced by re-scans after this change was deployed. Legacy entities (produced before this fix) carry `null` for `scanSessionId` and `extractorVersion` — these can be identified and invalidated by triggering a fresh re-scan.
