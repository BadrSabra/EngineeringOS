import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
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
  taskScope: string;
  environmentRevision: string | null;
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
  requestedTaskScope: string | undefined,
  requestedEnvironmentRevision: string | null | undefined,
  facts: readonly WorldStateFactProjection[],
  observations: readonly typeof aiAgentObservationsTable.$inferSelect[],
): string {
  const digest = createHash("sha256");
  digest.update(JSON.stringify([
    projectId,
    requestedTaskScope === undefined ? "all" : requestedTaskScope,
    requestedEnvironmentRevision === undefined ? "all" : requestedEnvironmentRevision,
  ]));
  for (const fact of [...facts].sort((left, right) => left.id.localeCompare(right.id))) {
    digest.update(JSON.stringify([
      fact.id,
      fact.subject,
      fact.predicate,
      fact.valueHash,
      fact.version,
      fact.status,
      fact.taskScope,
      fact.projectRevision,
      fact.environmentRevision,
      fact.sourceObservationIds,
    ]));
  }
  const latestSequenceByEpisode = new Map<string, number>();
  for (const observation of observations) {
    if (requestedTaskScope !== undefined && observation.taskScope !== requestedTaskScope) continue;
    if (
      requestedEnvironmentRevision !== undefined
      && observation.environmentRevision !== requestedEnvironmentRevision
    ) {
      continue;
    }
    latestSequenceByEpisode.set(
      observation.episodeId,
      Math.max(latestSequenceByEpisode.get(observation.episodeId) ?? -1, observation.sequence),
    );
  }
  for (const [episodeId, sequence] of [...latestSequenceByEpisode].sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(JSON.stringify([episodeId, sequence]));
  }
  return digest.digest("hex");
}

function factScopeKey(
  taskScope: string,
  environmentRevision: string | null,
  subject: string,
  predicate: string,
): string {
  return JSON.stringify([taskScope, environmentRevision, subject, predicate]);
}

function environmentRevisionIdentity(revision: string | null | undefined): string {
  return revision ? `revision:${revision}` : "unknown";
}

function compareObservations(
  left: typeof aiAgentObservationsTable.$inferSelect,
  right: typeof aiAgentObservationsTable.$inferSelect,
): number {
  return left.createdAt.getTime() - right.createdAt.getTime()
    || left.episodeId.localeCompare(right.episodeId)
    || left.sequence - right.sequence
    || left.id.localeCompare(right.id);
}

function projectFact(row: typeof aiWorldFactsTable.$inferSelect): WorldStateFactProjection {
  return {
    id: row.id,
    subject: row.subject,
    predicate: row.predicate,
    value: row.value as JsonValue,
    valueHash: row.valueHash,
    taskScope: row.taskScope,
    environmentRevision: row.environmentRevision,
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

    const recentObservations = await tx
      .select()
      .from(aiAgentObservationsTable)
      .where(and(
        eq(aiAgentObservationsTable.projectId, projectId),
        eq(aiAgentObservationsTable.completeness, "complete"),
        eq(aiAgentObservationsTable.freshness, "fresh"),
      ))
      .orderBy(
        desc(aiAgentObservationsTable.createdAt),
        desc(aiAgentObservationsTable.sequence),
        desc(aiAgentObservationsTable.id),
      )
      .limit(2_048);
    const observations = recentObservations.sort(compareObservations);

    const grouped = new Map<string, typeof observations>();
    for (const observation of observations) {
      const scopedKey = factScopeKey(
        observation.taskScope,
        observation.environmentRevision,
        observation.subject,
        observation.predicate,
      );
      const bucket = grouped.get(scopedKey) ?? [];
      bucket.push(observation);
      grouped.set(scopedKey, bucket);
    }

    const existing = await tx
      .select()
      .from(aiWorldFactsTable)
      .where(eq(aiWorldFactsTable.projectId, projectId))
      .orderBy(desc(aiWorldFactsTable.version));
    const byKey = new Map<string, typeof existing>();
    for (const fact of existing) {
      const key = factScopeKey(fact.taskScope, fact.environmentRevision, fact.subject, fact.predicate);
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
          taskScope: valueObservations[0]!.taskScope,
          environmentRevisionKey: environmentRevisionIdentity(valueObservations[0]!.environmentRevision),
          subject: valueObservations[0]!.subject,
          predicate: valueObservations[0]!.predicate,
          value: valueObservations[0]!.value,
          valueHash,
          version: (latest?.version ?? 0) + 1,
          status,
          sourceObservationIds: valueObservations.map((observation) => observation.id).slice(0, MAX_SOURCE_IDS),
          projectRevision: sourceRevision,
          environmentRevision: valueObservations[0]!.environmentRevision,
          supersedesFactId: sameRevisionConflict ? null : latest?.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const projected = {
          id: factId,
          projectId,
          taskScope: valueObservations[0]!.taskScope,
          environmentRevisionKey: environmentRevisionIdentity(valueObservations[0]!.environmentRevision),
          subject: valueObservations[0]!.subject,
          predicate: valueObservations[0]!.predicate,
          value: valueObservations[0]!.value,
          valueHash,
          version: (latest?.version ?? 0) + 1,
          status,
          sourceObservationIds: valueObservations.map((observation) => observation.id).slice(0, MAX_SOURCE_IDS),
          projectRevision: sourceRevision,
          environmentRevision: valueObservations[0]!.environmentRevision,
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
      .orderBy(
        desc(aiWorldFactsTable.version),
        asc(aiWorldFactsTable.taskScope),
        asc(aiWorldFactsTable.environmentRevisionKey),
        asc(aiWorldFactsTable.subject),
        asc(aiWorldFactsTable.predicate),
        asc(aiWorldFactsTable.id),
      )
      .limit(MAX_FACTS);
    const facts = rows.map(projectFact);
    return {
      projectId,
      inserted,
      skipped,
      contradictions,
      worldRevision: worldRevision(projectId, undefined, undefined, facts, observations),
    };
  });
}

export async function getProjectWorldState(
  projectId: string,
  filter?: { taskScope?: string; environmentRevision?: string | null },
): Promise<ProjectWorldStateProjection> {
  const conditions = [
    eq(aiWorldFactsTable.projectId, projectId),
    ...(filter?.taskScope ? [eq(aiWorldFactsTable.taskScope, filter.taskScope)] : []),
    ...(filter?.environmentRevision === undefined
      ? []
      : [filter.environmentRevision === null
          ? isNull(aiWorldFactsTable.environmentRevision)
          : eq(aiWorldFactsTable.environmentRevision, filter.environmentRevision)]),
  ];
  const rows = await db
    .select()
    .from(aiWorldFactsTable)
    .where(and(...conditions))
    .orderBy(
      desc(aiWorldFactsTable.version),
      asc(aiWorldFactsTable.taskScope),
      asc(aiWorldFactsTable.environmentRevisionKey),
      asc(aiWorldFactsTable.subject),
      asc(aiWorldFactsTable.predicate),
      asc(aiWorldFactsTable.id),
    )
    .limit(MAX_FACTS);
  const facts = rows.map(projectFact);
  const observations = await db
    .select()
    .from(aiAgentObservationsTable)
    .where(and(
        eq(aiAgentObservationsTable.projectId, projectId),
        eq(aiAgentObservationsTable.completeness, "complete"),
        eq(aiAgentObservationsTable.freshness, "fresh"),
        ...(filter?.taskScope ? [eq(aiAgentObservationsTable.taskScope, filter.taskScope)] : []),
        ...(filter?.environmentRevision === undefined
          ? []
          : [filter.environmentRevision === null
              ? isNull(aiAgentObservationsTable.environmentRevision)
              : eq(aiAgentObservationsTable.environmentRevision, filter.environmentRevision)]),
      ))
    .orderBy(
      desc(aiAgentObservationsTable.createdAt),
      desc(aiAgentObservationsTable.sequence),
      desc(aiAgentObservationsTable.id),
    )
    .limit(2_048);
  observations.sort(compareObservations);
  return {
    projectId,
    worldRevision: worldRevision(projectId, filter?.taskScope, filter?.environmentRevision, facts, observations),
    facts,
    currentFacts: facts.filter((fact) => fact.status === "believed" || fact.status === "confirmed"),
    contradictions: facts.filter((fact) => fact.status === "contradicted"),
    generatedAt: new Date().toISOString(),
  };
}