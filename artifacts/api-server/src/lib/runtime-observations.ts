import { createHash, randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import {
  db,
  graphEntitiesTable,
  graphRelationshipsTable,
  workspaceRuntimeTable,
} from "@workspace/db";

const RUNTIME_OBSERVATION_SOURCE = "workspace-runtime";

export type RuntimeObservationInput = {
  projectId: string;
  sessionId: string;
  runtimeRevision: string;
  sourcePath: string;
  sourceName: string;
  targetPath: string;
  targetName: string;
  relationType?: "calls" | "uses";
  line?: number;
  column?: number;
  snippet?: string;
  observedAt?: Date;
};

export class RuntimeObservationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "RUNTIME_SESSION_UNAVAILABLE"
      | "RUNTIME_SESSION_MISMATCH"
      | "RUNTIME_REVISION_MISMATCH"
      | "RUNTIME_ENTITY_NOT_FOUND"
      | "RUNTIME_PATH_INVALID",
    public readonly status = 409,
  ) {
    super(message);
    this.name = "RuntimeObservationError";
  }
}

function validProjectPath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").trim();
  return Boolean(normalized)
    && !normalized.startsWith("/")
    && !normalized.split("/").some((part) => part === "..");
}

function observationId(input: RuntimeObservationInput, sourceId: string, targetId: string): string {
  return `runtime-${createHash("sha256")
    .update([
      input.projectId,
      input.sessionId,
      input.runtimeRevision,
      sourceId,
      targetId,
      input.relationType ?? "calls",
    ].join("\x1f"))
    .digest("hex")}`;
}

async function assertRuntimeIdentity(input: RuntimeObservationInput): Promise<void> {
  const [runtime] = await db
    .select({
      sessionId: workspaceRuntimeTable.sessionId,
      revision: workspaceRuntimeTable.revision,
      status: workspaceRuntimeTable.status,
    })
    .from(workspaceRuntimeTable)
    .where(eq(workspaceRuntimeTable.projectId, input.projectId))
    .limit(1);
  if (!runtime || !["starting", "running"].includes(runtime.status)) {
    throw new RuntimeObservationError(
      "Runtime observations require an active workspace runtime.",
      "RUNTIME_SESSION_UNAVAILABLE",
    );
  }
  if (runtime.sessionId !== input.sessionId) {
    throw new RuntimeObservationError(
      "The runtime observation session is no longer current.",
      "RUNTIME_SESSION_MISMATCH",
    );
  }
  if (runtime.revision !== input.runtimeRevision) {
    throw new RuntimeObservationError(
      "The runtime observation revision is no longer current.",
      "RUNTIME_REVISION_MISMATCH",
    );
  }
}

async function resolveEntity(projectId: string, name: string, path: string) {
  const [entity] = await db
    .select()
    .from(graphEntitiesTable)
    .where(and(
      eq(graphEntitiesTable.projectId, projectId),
      eq(graphEntitiesTable.path, path),
      or(eq(graphEntitiesTable.name, name), eq(graphEntitiesTable.name, path)),
    ))
    .limit(1);
  return entity;
}

export async function recordRuntimeObservation(input: RuntimeObservationInput): Promise<{
  relationshipId: string;
  sourceId: string;
  targetId: string;
  runtimeRevision: string;
  observedAt: string;
}> {
  if (!validProjectPath(input.sourcePath) || !validProjectPath(input.targetPath)) {
    throw new RuntimeObservationError(
      "Runtime observations require project-relative endpoint paths.",
      "RUNTIME_PATH_INVALID",
      400,
    );
  }
  await assertRuntimeIdentity(input);
  const [source, target] = await Promise.all([
    resolveEntity(input.projectId, input.sourceName, input.sourcePath),
    resolveEntity(input.projectId, input.targetName, input.targetPath),
  ]);
  if (!source || !target) {
    throw new RuntimeObservationError(
      "Runtime observations require path-qualified entities already present in the project graph.",
      "RUNTIME_ENTITY_NOT_FOUND",
    );
  }

  const observedAt = input.observedAt ?? new Date();
  const relationType = input.relationType ?? "calls";
  const evidence = [{
    file: input.sourcePath,
    ...(input.line !== undefined ? { line: input.line } : {}),
    ...(input.column !== undefined ? { column: input.column } : {}),
    ...(input.snippet ? { snippet: input.snippet.slice(0, 240) } : {}),
    kind: "call-site" as const,
  }];
  const relationshipId = observationId(input, source.id, target.id);
  await db
    .insert(graphRelationshipsTable)
    .values({
      id: relationshipId,
      sourceId: source.id,
      targetId: target.id,
      projectId: input.projectId,
      relation: relationType,
      relationType,
      relationSubtype: "runtime-observed",
      weight: 1,
      confidence: 1,
      isHeuristic: false,
      isRuntimeObserved: true,
      evidenceJson: evidence,
      evidenceCount: evidence.length,
      evidenceSummary: `Observed ${relationType} edge during workspace runtime.`,
      sourceType: "manual",
      metadata: {
        observationSource: RUNTIME_OBSERVATION_SOURCE,
        runtimeSessionId: input.sessionId,
        runtimeRevision: input.runtimeRevision,
        observedAt: observedAt.toISOString(),
      },
      provenance: {
        sourceType: "manual",
        method: "runtime-observation",
        extractedAt: observedAt.toISOString(),
        evidence,
      },
      createdAt: observedAt,
    })
    .onConflictDoUpdate({
      target: graphRelationshipsTable.id,
      set: {
        confidence: 1,
        isRuntimeObserved: true,
        evidenceJson: evidence,
        evidenceCount: evidence.length,
        evidenceSummary: `Observed ${relationType} edge during workspace runtime.`,
        metadata: {
          observationSource: RUNTIME_OBSERVATION_SOURCE,
          runtimeSessionId: input.sessionId,
          runtimeRevision: input.runtimeRevision,
          observedAt: observedAt.toISOString(),
        },
        provenance: {
          sourceType: "manual",
          method: "runtime-observation",
          extractedAt: observedAt.toISOString(),
          evidence,
        },
      },
    });

  return {
    relationshipId,
    sourceId: source.id,
    targetId: target.id,
    runtimeRevision: input.runtimeRevision,
    observedAt: observedAt.toISOString(),
  };
}

export async function clearRuntimeObservations(
  projectId: string,
  sessionId: string,
  runtimeRevision: string,
): Promise<number> {
  const deleted = await db
    .delete(graphRelationshipsTable)
    .where(and(
      eq(graphRelationshipsTable.projectId, projectId),
      eq(graphRelationshipsTable.isRuntimeObserved, true),
      sql`${graphRelationshipsTable.metadata}->>'observationSource' = ${RUNTIME_OBSERVATION_SOURCE}`,
      sql`${graphRelationshipsTable.metadata}->>'runtimeSessionId' = ${sessionId}`,
      sql`${graphRelationshipsTable.metadata}->>'runtimeRevision' = ${runtimeRevision}`,
    ))
    .returning({ id: graphRelationshipsTable.id });
  return deleted.length;
}

export function newRuntimeObservationSessionId(): string {
  return randomUUID();
}