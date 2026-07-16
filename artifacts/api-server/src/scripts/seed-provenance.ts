#!/usr/bin/env tsx
/**
 * One-off import of the EngineeringOS provenance registry into the
 * Knowledge Graph (graph_entities / graph_relationships).
 *
 * Merges the two uploaded registry snapshots:
 *  - ..._linked_*.json  → authoritative upstream/downstream/decision/evidence
 *                          refs and authority levels (source of truth for
 *                          relationships).
 *  - ..._seed_*.json    → adds `note` and `source_of_truth` fields not
 *                          present in the linked snapshot.
 *
 * Each record becomes a `file`-type graph entity keyed by repo-relative
 * path, attached to a single "EngineeringOS" project. Relationships are
 * derived from upstream/downstream ("feeds") and decision_refs/evidence_refs
 * (kept as their own relation types) for anything that resolves to a known
 * path in the registry.
 *
 * Idempotent: entity ids are deterministic (`prov:<path>`), and the whole
 * import runs inside one transaction that first clears any prior
 * provenance-import rows for the project before re-inserting.
 *
 * Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/seed-provenance.ts
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  db,
  pool,
  projectsTable,
  graphEntitiesTable,
  graphRelationshipsTable,
} from "@workspace/db";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const LINKED_PATH = resolve(
  REPO_ROOT,
  "attached_assets/EngineeringOS_provenance_registry_linked_1783911530593.json",
);
const SEED_PATH = resolve(
  REPO_ROOT,
  "attached_assets/EngineeringOS_provenance_registry_seed_1783911530658.json",
);

const PROJECT_ID = "engineeringos-self";
const PROJECT_ROOT_PATH = "/home/runner/workspace";

type LinkedRecord = {
  path: string;
  layer: string;
  role: string;
  status: string;
  ext: string;
  line_count: number;
  char_count: number;
  provenance_kind: string;
  authority_level: "A" | "B" | "C" | "D";
  upstream: string[];
  downstream: string[];
  decision_refs: string[];
  evidence_refs: string[];
  relationship_basis: string;
};

type SeedRecord = {
  path: string;
  note?: string;
  provenance_bucket?: string;
  source_of_truth?: boolean;
  operational_impact?: string;
  provenance_summary?: string;
  verified_at?: string | null;
};

async function loadJson<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as T[];
}

function entityIdFor(path: string): string {
  return `prov:${path}`;
}

async function main() {
  const [linked, seed] = await Promise.all([
    loadJson<LinkedRecord>(LINKED_PATH),
    loadJson<SeedRecord>(SEED_PATH),
  ]);

  const seedByPath = new Map(seed.map((s) => [s.path, s]));
  const knownPaths = new Set(linked.map((r) => r.path));
  const now = new Date();

  console.log(`Loaded ${linked.length} linked records, ${seed.length} seed records.`);

  // Build entities
  const entityRows = linked.map((rec) => {
    const seedRec = seedByPath.get(rec.path);
    return {
      id: entityIdFor(rec.path),
      projectId: PROJECT_ID,
      scanJobId: null,
      type: "file" as const,
      name: rec.path.split("/").pop() ?? rec.path,
      path: rec.path,
      metadata: {
        layer: rec.layer,
        role: rec.role,
        status: rec.status,
        ext: rec.ext,
        lineCount: rec.line_count,
        charCount: rec.char_count,
        provenanceKind: rec.provenance_kind,
        authorityLevel: rec.authority_level,
        relationshipBasis: rec.relationship_basis,
        note: seedRec?.note ?? null,
        provenanceBucket: seedRec?.provenance_bucket ?? null,
        sourceOfTruth: seedRec?.source_of_truth ?? false,
        operationalImpact: seedRec?.operational_impact || null,
        provenanceSummary: seedRec?.provenance_summary || null,
        verifiedAt: seedRec?.verified_at ?? null,
      },
      provenance: {
        extractor: "provenance-registry-import",
        method: "manual-seed",
        extractedAt: now.toISOString(),
      },
      createdAt: now,
    };
  });

  // Build relationships, deduped by (source, target, relation)
  const edgeMap = new Map<
    string,
    { sourceId: string; targetId: string; relation: string }
  >();

  function addEdge(sourcePath: string, targetPath: string, relation: string) {
    if (sourcePath === targetPath) return;
    if (!knownPaths.has(sourcePath) || !knownPaths.has(targetPath)) return;
    const sourceId = entityIdFor(sourcePath);
    const targetId = entityIdFor(targetPath);
    const key = `${sourceId}|${targetId}|${relation}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { sourceId, targetId, relation });
    }
  }

  for (const rec of linked) {
    for (const upstreamPath of rec.upstream ?? []) {
      addEdge(upstreamPath, rec.path, "feeds");
    }
    for (const downstreamPath of rec.downstream ?? []) {
      addEdge(rec.path, downstreamPath, "feeds");
    }
    for (const ref of rec.decision_refs ?? []) {
      addEdge(rec.path, ref, "decision_ref");
    }
    for (const ref of rec.evidence_refs ?? []) {
      addEdge(rec.path, ref, "evidence_ref");
    }
  }

  const relationshipRows = [...edgeMap.values()].map((e) => ({
    id: randomUUID(),
    sourceId: e.sourceId,
    targetId: e.targetId,
    relation: e.relation,
    scanJobId: null,
    confidence: 1,
    metadata: null,
    provenance: {
      extractor: "provenance-registry-import",
      method: "manual-seed",
      extractedAt: now.toISOString(),
    },
    createdAt: now,
  }));

  console.log(
    `Prepared ${entityRows.length} entities and ${relationshipRows.length} relationships.`,
  );

  await db.transaction(async (tx) => {
    await tx
      .insert(projectsTable)
      .values({
        id: PROJECT_ID,
        ownerId: "system",
        name: "EngineeringOS",
        description: "This EngineeringOS monorepo itself, tracked via its own provenance registry.",
        rootPath: PROJECT_ROOT_PATH,
        language: "typescript",
        framework: "pnpm-workspace",
        status: "active",
        qualityScore: null,
        lastScanAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projectsTable.id,
        set: { updatedAt: now, lastScanAt: now },
      });

    // Clear any prior import of this registry so the script is safely
    // re-runnable, then insert fresh rows. Relationships cascade on
    // entity delete, so deleting entities is enough.
    await tx
      .delete(graphEntitiesTable)
      .where(
        and(
          eq(graphEntitiesTable.projectId, PROJECT_ID),
        ),
      );

    const CHUNK = 200;
    for (let i = 0; i < entityRows.length; i += CHUNK) {
      await tx.insert(graphEntitiesTable).values(entityRows.slice(i, i + CHUNK));
    }
    for (let i = 0; i < relationshipRows.length; i += CHUNK) {
      await tx
        .insert(graphRelationshipsTable)
        .values(relationshipRows.slice(i, i + CHUNK));
    }
  });

  console.log("Provenance registry import complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Provenance import failed:", err);
  process.exit(1);
});
