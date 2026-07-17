/**
 * Shared helpers that convert scanner-emitted provenance (EntityProvenance /
 * RelationshipProvenance from lib/scanner) into the unified GraphProvenance
 * shape stored in the database (lib/db/src/schema/graph.ts).
 *
 * This is the ONLY place in the api-server that constructs a GraphProvenance
 * object — all write paths (scan-runner, discovery, seed scripts) must go
 * through one of these helpers so the stored shape is always consistent.
 */
import type { GraphProvenance } from "@workspace/db";
import type { EntityProvenance, RelationshipProvenance } from "@workspace/scanner";

/**
 * Convert a scanner EntityProvenance into a DB-storable GraphProvenance.
 * The scanner guarantees ≥1 evidence record after mergeResult() — we pass
 * them through directly so the DB row is fully traceable.
 */
export function provenanceFromEntity(
  p: EntityProvenance,
  extractedAt: Date,
): GraphProvenance {
  return {
    sourceType: p.sourceType,
    method: p.method,
    extractedAt: extractedAt.toISOString(),
    evidence: p.evidence.length > 0 ? p.evidence : undefined,
  };
}

/**
 * Convert a scanner RelationshipProvenance into a DB-storable GraphProvenance.
 * Evidence is inherited from the push site (import-statement, call-site, etc.)
 * or built by mergeResult() as a minimal but correct fallback.
 */
export function provenanceFromRelationship(
  p: RelationshipProvenance,
  extractedAt: Date,
): GraphProvenance {
  return {
    sourceType: p.sourceType,
    method: p.method,
    extractedAt: extractedAt.toISOString(),
    evidence: p.evidence.length > 0 ? p.evidence : undefined,
  };
}

/**
 * Build provenance for rows that are not produced by the scanner — e.g. API
 * stubs detected during discovery, manually seeded data, or legacy rows that
 * predate PR-01's provenance enrichment.
 *
 * @param sourceType  Broad category (e.g. "discovery-import", "provenance-registry-import")
 * @param method      Specific mechanism (e.g. "api-route-detection", "manual-seed")
 * @param extractedAt Timestamp when the row was produced (use the transaction `now`)
 * @param evidence    Optional evidence records; omit for manual / seeded rows
 */
export function manualProvenance(
  sourceType: string,
  method: string,
  extractedAt: Date,
  evidence?: GraphProvenance["evidence"],
): GraphProvenance {
  return {
    sourceType,
    method,
    extractedAt: extractedAt.toISOString(),
    ...(evidence && evidence.length > 0 ? { evidence } : {}),
  };
}
