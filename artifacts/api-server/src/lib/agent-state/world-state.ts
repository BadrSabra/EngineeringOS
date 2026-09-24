import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  aiAgentObservationsTable,
  aiWorldFactsTable,
  db,
  projectsTable,
} from "@workspace/db";
import type { JsonValue } from "@workspace/ai-orchestrator";

const MAX_FACTS = 256;
const MAX_SOURCE_IDS = 16;

export type WorldStateFactProjection = {
  id: string;
  subject: string;
  predicate: string;
  value: JsonValue;
  valueHash: string;
  version: number;
  status: "believed" | "confirmed" | "contradicted" | "superseded" | "retracted";
  sourceObservationIds: string[];
  projectRevision: string;
  supersedesFactId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectWorldStateProjection = {
  projectId: string;
  worldRevision: string;
  facts: WorldStateFactProjection[];
  currentFacts: WorldStateFactProjection[];
  contradictions: WorldStateFactProjection[];
  generatedAt: string;
};

export type WorldStateMaterializationResult = {
  projectId: string;
  inserted: number;
  skipped: number;
  contradictions: number;
  worldRevision: string;
};

function asString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function boundedSourceIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string").slice(0, MAX_SOURCE_IDS)
    : [];
}

function worldRevision(
  projectId: string,
  facts: readonly WorldStateFactProjection[],
): string {
  const digest = createHash("sha256");
  digest.update(projectId);
  for (const fact of [...facts].sort((left, right) => left.id.localeCompare(right.id))) {
    digest.update(JSON.stringify([
      fact.id,
      fact.subject,
      fact.predicate,
      fact.valueHash,
      fact.version,
      fact.status,
      fact.projectRevision,
      fact.sourceObservationIds,
    ]));
  }
  return digest.digest("hex");
}

function projectFact(row: typeof aiWorldFactsTable.$inferSelect): WorldStateFactProjection {
  return {
    id: row.id,
    subject: row.subject,
    predicate: row.predicate,
    value: row.value as JsonValue,
    valueHash: row.valueHash,
    version: row.version,
    status: row.status,
    sourceObservationIds: boundedSourceIds(row.sourceObservationIds),
    projectRevision: row.projectRevision,
    supersedesFactId: row.supersedesFactId,
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

export async function materializeWorldStateForProject(
  projectId: string,
): Promise<WorldStateMaterializationResult> {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .for("update");
    if (!project) throw new Error("world_state_project_not_found");

    const observations = await tx
      .select()
      .from(aiAgentObservationsTable)
      .where(and(
        eq(aiAgentObservationsTable.projectId, projectId),
        eq(aiAgentObservationsTable.completeness, "complete"),
        eq(aiAgentObservationsTable.freshness, "fresh"),
      ))
      .orderBy(asc(aiAgentObservationsTable.createdAt), asc(aiAgentObservationsTable.sequence))
      .limit(2_048);

    const grouped = new Map<string, typeof observations>();
    for (const observation of observations) {
      const key = `${observation.subject}\u0000${observation.predicate}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(observation);
      grouped.set(key, bucket);
    }

    const existing = await tx
      .select()
      .from(aiWorldFactsTable)
      .where(eq(aiWorldFactsTable.projectId, projectId))
      .orderBy(desc(aiWorldFactsTable.version));
    const byKey = new Map<string, typeof existing>();
    for (const fact of existing) {
      const key = `${fact.subject}\u0000${fact.predicate}`;
      const bucket = byKey.get(key) ?? [];
      bucket.push(fact);
      byKey.set(key, bucket);
    }

    let inserted = 0;
    let skipped = 0;
    let contradictions = 0;

    for (const [key, bucket] of grouped) {
      const values = new Map<string, typeof bucket>();
      for (const observation of bucket) {
        const valueBucket = values.get(observation.valueHash) ?? [];
        valueBucket.push(observation);
        values.set(observation.valueHash, valueBucket);
      }
      const factsForKey = byKey.get(key) ?? [];
      let latest = factsForKey[0];

      for (const [valueHash, valueObservations] of values) {
        if (factsForKey.some((fact) => fact.valueHash === valueHash)) {
          skipped++;
          continue;
        }
        const sourceRevision = valueObservations[0]!.projectRevision
          ?? latest?.projectRevision
          ?? "unknown";
        const sameRevisionConflict = Boolean(
          latest
          && latest.valueHash !== valueHash
          && latest.projectRevision === sourceRevision,
        );
        // Multiple values are only a contradiction when they describe the
        // same project revision. Values from a newer revision supersede the
        // previous belief instead of making the new value contradictory.
        const status = sameRevisionConflict ? "contradicted" as const : "believed" as const;
        if (status === "contradicted") contradictions++;
        if (
          latest
          && latest.valueHash !== valueHash
          && (
            sameRevisionConflict
            || (latest.status !== "contradicted" && latest.status !== "retracted")
          )
        ) {
          await tx.update(aiWorldFactsTable)
            .set({
              status: sameRevisionConflict ? "contradicted" : "superseded",
              updatedAt: new Date(),
            })
            .where(eq(aiWorldFactsTable.id, latest.id));
        }

        const factId = randomUUID();
        await tx.insert(aiWorldFactsTable).values({
          id: factId,
          projectId,
          subject: valueObservations[0]!.subject,
          predicate: valueObservations[0]!.predicate,
          value: valueObservations[0]!.value,
          valueHash,
          version: (latest?.version ?? 0) + 1,
          status,
          sourceObservationIds: valueObservations.map((observation) => observation.id).slice(0, MAX_SOURCE_IDS),
          projectRevision: sourceRevision,
          supersedesFactId: sameRevisionConflict ? null : latest?.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const projected = {
          id: factId,
          projectId,
          subject: valueObservations[0]!.subject,
          predicate: valueObservations[0]!.predicate,
          value: valueObservations[0]!.value,
          valueHash,
          version: (latest?.version ?? 0) + 1,
          status,
          sourceObservationIds: valueObservations.map((observation) => observation.id).slice(0, MAX_SOURCE_IDS),
          projectRevision: sourceRevision,
          environmentRevision: null,
          supersedesFactId: sameRevisionConflict ? null : latest?.id ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as typeof aiWorldFactsTable.$inferSelect;
        factsForKey.unshift(projected);
        latest = projected;
        inserted++;
      }
      byKey.set(key, factsForKey);
    }

    const rows = await tx
      .select()
      .from(aiWorldFactsTable)
      .where(eq(aiWorldFactsTable.projectId, projectId))
      .orderBy(desc(aiWorldFactsTable.version), asc(aiWorldFactsTable.subject), asc(aiWorldFactsTable.predicate))
      .limit(MAX_FACTS);
    const facts = rows.map(projectFact);
    return {
      projectId,
      inserted,
      skipped,
      contradictions,
      worldRevision: worldRevision(projectId, facts),
    };
  });
}

export async function getProjectWorldState(
  projectId: string,
): Promise<ProjectWorldStateProjection> {
  const rows = await db
    .select()
    .from(aiWorldFactsTable)
    .where(eq(aiWorldFactsTable.projectId, projectId))
    .orderBy(desc(aiWorldFactsTable.version), asc(aiWorldFactsTable.subject), asc(aiWorldFactsTable.predicate))
    .limit(MAX_FACTS);
  const facts = rows.map(projectFact);
  return {
    projectId,
    worldRevision: worldRevision(projectId, facts),
    facts,
    currentFacts: facts.filter((fact) => fact.status === "believed" || fact.status === "confirmed"),
    contradictions: facts.filter((fact) => fact.status === "contradicted"),
    generatedAt: new Date().toISOString(),
  };
}