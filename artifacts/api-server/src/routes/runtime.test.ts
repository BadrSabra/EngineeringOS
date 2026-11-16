import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiChatSessionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import app from "../app.js";
import { childProcessBindingDigest } from "../lib/agent-state/child-process-attestation.js";
import { hashDeliveryTree } from "../lib/delivery-workspace.js";
import { projectExecutionProofGraph } from "../lib/execution-proof-graph-projector.js";
import { normalizeStoredRuntimeStartGateCProofArtifact } from "../lib/runtime-start-gate-c-proof.js";
import {
  workspaceRuntime,
  type RuntimeAfterState,
  type RuntimeStartBeforeState,
  type WorkspaceRuntimeSnapshot,
} from "../lib/workspace-runtime.js";

const TEST_ROOTS_BASE = "/home/runner/workspace/.test-roots";
const fixtures: Array<{ projectId: string; rootPath: string }> = [];

function createRuntimeMock(
  projectId: string,
  revision: string,
  afterOverrides: Partial<RuntimeAfterState> = {},
) {
  const now = new Date().toISOString();
  const snapshot: WorkspaceRuntimeSnapshot = {
    projectId,
    sessionId: `runtime-session-${projectId}`,
    status: "running",
    port: 3001,
    command: "pnpm run dev",
    revision,
    environmentRevision: null,
    startedAt: now,
    stoppedAt: null,
    pid: 12345,
    leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    lastHeartbeatAt: now,
    error: null,
    logs: [],
  };
  const afterState: RuntimeAfterState = {
    status: "passed",
    projectId,
    sessionId: snapshot.sessionId!,
    revision,
    pid: snapshot.pid,
    port: snapshot.port!,
    processAlive: true,
    portReady: true,
    healthPath: "/healthz",
    healthStatus: 200,
    servingRevision: revision,
    markerMatched: true,
    listener: {
      status: "known",
      reasonCode: "listener_process_attested",
      port: snapshot.port!,
      identityDigest: "d".repeat(64),
      processAttestation: {
        status: "known",
        reasonCode: "child_process_observed",
        bindingDigest: "e".repeat(64),
        attestationDigest: "f".repeat(64),
        processEnvironmentDigest: "1".repeat(64),
        observedAt: now,
      },
    },
    responseBody: "ok",
    observedAt: now,
    detail: "Runtime after-state verified.",
    ...afterOverrides,
  };
  const beforeState: RuntimeStartBeforeState = {
    status: "observed",
    runtimeStatus: "stopped",
    projectId,
    revision,
    sessionId: null,
    pid: null,
    port: null,
    processAlive: false,
    portReady: false,
    source: "test_observer",
    inventoryComplete: true,
    unknownListenerPorts: [],
    observedAt: now,
    detail: "Controlled test fixture independently observed a stopped runtime.",
  };

  const startSpy = vi.spyOn(workspaceRuntime, "start").mockImplementation(async (input) => ({
    ...snapshot,
    environmentRevision: input.expectedEnvironmentRevision ?? null,
  }));
  vi.spyOn(workspaceRuntime, "get").mockResolvedValue(snapshot);
  vi.spyOn(workspaceRuntime, "observeStartBeforeState").mockResolvedValue(beforeState);
  vi.spyOn(workspaceRuntime, "observeAfterState").mockImplementation(async (input) => ({
    ...afterState,
    ...(input.attestationBinding ? {
      childProcessAttestation: {
        ...afterState.listener.processAttestation,
        bindingDigest: childProcessBindingDigest(input.attestationBinding),
      },
    } : {}),
  }));
  return { startSpy, snapshot, afterState };
}

async function createProjectFixture(input: { ownerId?: string } = {}): Promise<{
  projectId: string;
  rootPath: string;
  sourceRevision: string;
}> {
  const projectId = randomUUID();
  const rootPath = join(TEST_ROOTS_BASE, `runtime-start-${projectId}`);
  mkdirSync(rootPath, { recursive: true });
  writeFileSync(join(rootPath, "package.json"), JSON.stringify({ name: "runtime-route-fixture" }));
  const sourceRevision = await hashDeliveryTree(rootPath);
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: input.ownerId ?? "test-user",
    name: `runtime-route-${projectId.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  fixtures.push({ projectId, rootPath });
  return { projectId, rootPath, sourceRevision };
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (!fixture) continue;
    const executions = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.projectId, fixture.projectId));
    for (const execution of executions) {
      await db.delete(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, execution.id));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, execution.id));
    }
    await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, fixture.projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

async function createCompletedRuntimeStart() {
  const fixture = await createProjectFixture();
  createRuntimeMock(fixture.projectId, fixture.sourceRevision);
  const response = await request(app)
    .post(`/api/projects/${fixture.projectId}/runtime/start`)
    .set("Idempotency-Key", `graph-projector-${randomUUID()}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const [execution] = await db.select({
    id: aiExecutionsTable.id,
    attempt: aiExecutionsTable.attempt,
  }).from(aiExecutionsTable).where(eq(aiExecutionsTable.id, response.body.executionId));
  expect(execution).toBeDefined();
  const [acceptance] = await db.select({
    evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
  }).from(aiExecutionAcceptancesTable).where(and(
    eq(aiExecutionAcceptancesTable.executionId, response.body.executionId),
    eq(aiExecutionAcceptancesTable.attempt, execution!.attempt),
  ));
  expect(acceptance?.evidenceSnapshotId).toBeTruthy();
  const [snapshot] = await db.select({ artifactRefs: aiExecutionEvidenceSnapshotsTable.artifactRefs })
    .from(aiExecutionEvidenceSnapshotsTable)
    .where(eq(aiExecutionEvidenceSnapshotsTable.id, acceptance!.evidenceSnapshotId!));
  const refs = Array.isArray(snapshot?.artifactRefs) ? snapshot.artifactRefs : [];
  const storedArtifact = refs.find((value) => (
    value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === "runtime_start_gate_c"
  ));
  const gateCArtifact = storedArtifact
    ? normalizeStoredRuntimeStartGateCProofArtifact(storedArtifact)
    : undefined;
  expect(gateCArtifact).toBeDefined();
  return { fixture, execution: execution!, gateCArtifact: gateCArtifact! };
}

describe("read-only Execution Proof Graph projector", () => {
  it("fails closed when acceptance, its snapshot binding, or the proof mode is unsupported", async () => {
    const missingAcceptance = await createCompletedRuntimeStart();
    await db.delete(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, missingAcceptance.execution.id));
    const noAcceptanceResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: missingAcceptance.fixture.projectId,
      executionId: missingAcceptance.execution.id,
      expectedAttempt: missingAcceptance.execution.attempt,
    }));
    expect(noAcceptanceResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["ACCEPTANCE_MISSING"],
    });

    const missingSnapshot = await createCompletedRuntimeStart();
    await db.update(aiExecutionAcceptancesTable)
      .set({ evidenceSnapshotId: null })
      .where(eq(aiExecutionAcceptancesTable.executionId, missingSnapshot.execution.id));
    const noSnapshotResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: missingSnapshot.fixture.projectId,
      executionId: missingSnapshot.execution.id,
      expectedAttempt: missingSnapshot.execution.attempt,
    }));
    expect(noSnapshotResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["EVIDENCE_SNAPSHOT_MISSING"],
    });

    const unsupportedMode = await createCompletedRuntimeStart();
    const [storedExecution] = await db.select({ request: aiExecutionsTable.request })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, unsupportedMode.execution.id));
    const requestBody = JSON.parse(storedExecution!.request) as Record<string, unknown>;
    await db.update(aiExecutionsTable)
      .set({ request: JSON.stringify({ ...requestBody, recipeProofMode: "unsupported.v1" }) })
      .where(eq(aiExecutionsTable.id, unsupportedMode.execution.id));
    const unsupportedResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: unsupportedMode.fixture.projectId,
      executionId: unsupportedMode.execution.id,
      expectedAttempt: unsupportedMode.execution.attempt,
    }));
    expect(unsupportedResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["UNSUPPORTED_PROOF_MODE"],
    });
  });

  it("fails closed when candidate, source revision, or linked snapshot identity drifts", async () => {
    const candidateMismatch = await createCompletedRuntimeStart();
    await db.update(aiExecutionAcceptancesTable)
      .set({ candidateIdentity: "unrelated-candidate" })
      .where(eq(aiExecutionAcceptancesTable.executionId, candidateMismatch.execution.id));
    const candidateResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: candidateMismatch.fixture.projectId,
      executionId: candidateMismatch.execution.id,
      expectedAttempt: candidateMismatch.execution.attempt,
    }));
    expect(candidateResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["DOMAIN_PROOF_MISMATCH"],
    });

    const revisionMismatch = await createCompletedRuntimeStart();
    await db.update(aiExecutionAcceptancesTable)
      .set({ sourceRevision: "unrelated-source-revision" })
      .where(eq(aiExecutionAcceptancesTable.executionId, revisionMismatch.execution.id));
    const revisionResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: revisionMismatch.fixture.projectId,
      executionId: revisionMismatch.execution.id,
      expectedAttempt: revisionMismatch.execution.attempt,
    }));
    expect(revisionResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["DOMAIN_PROOF_MISMATCH"],
    });

    const linkedSnapshotMismatch = await createCompletedRuntimeStart();
    const unrelatedSnapshot = await createCompletedRuntimeStart();
    const [unrelatedAcceptance] = await db.select({
      evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, unrelatedSnapshot.execution.id));
    await db.update(aiExecutionAcceptancesTable)
      .set({ evidenceSnapshotId: unrelatedAcceptance!.evidenceSnapshotId })
      .where(eq(aiExecutionAcceptancesTable.executionId, linkedSnapshotMismatch.execution.id));
    const snapshotResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: linkedSnapshotMismatch.fixture.projectId,
      executionId: linkedSnapshotMismatch.execution.id,
      expectedAttempt: linkedSnapshotMismatch.execution.attempt,
    }));
    expect(snapshotResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["EVIDENCE_SNAPSHOT_MISSING"],
    });
  });

  it("rejects failed or misbound runtime recipe receipts", async () => {
    const failedReceipt = await createCompletedRuntimeStart();
    const [failedExecution] = await db.select({
      recipeReceipt: aiExecutionsTable.recipeReceipt,
    }).from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, failedReceipt.execution.id));
    const failedReceiptValue = failedExecution!.recipeReceipt as Record<string, unknown>;
    await db.update(aiExecutionsTable)
      .set({ recipeReceipt: { ...failedReceiptValue, status: "failed" } })
      .where(eq(aiExecutionsTable.id, failedReceipt.execution.id));
    const failedResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: failedReceipt.fixture.projectId,
      executionId: failedReceipt.execution.id,
      expectedAttempt: failedReceipt.execution.attempt,
    }));
    expect(failedResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["DOMAIN_PROOF_MISMATCH"],
    });

    const wrongAttemptReceipt = await createCompletedRuntimeStart();
    const [attemptExecution] = await db.select({
      recipeReceipt: aiExecutionsTable.recipeReceipt,
    }).from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, wrongAttemptReceipt.execution.id));
    const attemptReceiptValue = attemptExecution!.recipeReceipt as Record<string, unknown>;
    await db.update(aiExecutionsTable)
      .set({
        recipeReceipt: {
          ...attemptReceiptValue,
          attempt: wrongAttemptReceipt.execution.attempt + 1,
        },
      })
      .where(eq(aiExecutionsTable.id, wrongAttemptReceipt.execution.id));
    const attemptResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: wrongAttemptReceipt.fixture.projectId,
      executionId: wrongAttemptReceipt.execution.id,
      expectedAttempt: wrongAttemptReceipt.execution.attempt,
    }));
    expect(attemptResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["DOMAIN_PROOF_MISMATCH"],
    });

    const wrongExecutionReceipt = await createCompletedRuntimeStart();
    const [executionReceipt] = await db.select({
      recipeReceipt: aiExecutionsTable.recipeReceipt,
    }).from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, wrongExecutionReceipt.execution.id));
    const executionReceiptValue = executionReceipt!.recipeReceipt as Record<string, unknown>;
    await db.update(aiExecutionsTable)
      .set({
        recipeReceipt: {
          ...executionReceiptValue,
          executionId: randomUUID(),
        },
      })
      .where(eq(aiExecutionsTable.id, wrongExecutionReceipt.execution.id));
    const executionResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: wrongExecutionReceipt.fixture.projectId,
      executionId: wrongExecutionReceipt.execution.id,
      expectedAttempt: wrongExecutionReceipt.execution.attempt,
    }));
    expect(executionResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["DOMAIN_PROOF_MISMATCH"],
    });
  });

  it("rejects a tampered Gate C artifact or incomplete evidence snapshot", async () => {
    const tamperedArtifact = await createCompletedRuntimeStart();
    const [artifactAcceptance] = await db.select({
      evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, tamperedArtifact.execution.id));
    const [artifactSnapshot] = await db.select({
      id: aiExecutionEvidenceSnapshotsTable.id,
      artifactRefs: aiExecutionEvidenceSnapshotsTable.artifactRefs,
    }).from(aiExecutionEvidenceSnapshotsTable)
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, artifactAcceptance!.evidenceSnapshotId!));
    const alteredArtifactRefs = (artifactSnapshot!.artifactRefs as Array<Record<string, unknown>>)
      .map((artifact) => artifact.kind === "runtime_start_gate_c"
        ? { ...artifact, operationId: "tampered-operation" }
        : artifact);
    await db.update(aiExecutionEvidenceSnapshotsTable)
      .set({ artifactRefs: alteredArtifactRefs })
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, artifactSnapshot!.id));
    const tamperedArtifactResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: tamperedArtifact.fixture.projectId,
      executionId: tamperedArtifact.execution.id,
      expectedAttempt: tamperedArtifact.execution.attempt,
    }));
    expect(tamperedArtifactResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["DOMAIN_PROOF_MISMATCH"],
    });

    const incompleteEvidence = await createCompletedRuntimeStart();
    const [evidenceAcceptance] = await db.select({
      evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, incompleteEvidence.execution.id));
    await db.update(aiExecutionEvidenceSnapshotsTable)
      .set({ complete: 0 })
      .where(eq(
        aiExecutionEvidenceSnapshotsTable.id,
        evidenceAcceptance!.evidenceSnapshotId!,
      ));
    const incompleteEvidenceResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: incompleteEvidence.fixture.projectId,
      executionId: incompleteEvidence.execution.id,
      expectedAttempt: incompleteEvidence.execution.attempt,
    }));
    expect(incompleteEvidenceResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["EVIDENCE_INCOMPLETE"],
    });
  });

  it("rejects an extra artifact that is not bound by the accepted snapshot", async () => {
    const { fixture, execution } = await createCompletedRuntimeStart();
    const [acceptance] = await db.select({
      evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, execution.id));
    const [snapshot] = await db.select({
      id: aiExecutionEvidenceSnapshotsTable.id,
      artifactRefs: aiExecutionEvidenceSnapshotsTable.artifactRefs,
    }).from(aiExecutionEvidenceSnapshotsTable)
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, acceptance!.evidenceSnapshotId!));
    const artifactRefs = snapshot!.artifactRefs as Array<Record<string, unknown>>;
    await db.update(aiExecutionEvidenceSnapshotsTable)
      .set({ artifactRefs: [...artifactRefs, { kind: "unbound_receipt", id: randomUUID() }] })
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, snapshot!.id));

    const result = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: fixture.projectId,
      executionId: execution.id,
      expectedAttempt: execution.attempt,
    }));
    expect(result).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["IDENTITY_MISMATCH"],
    });
  });

  it("reprojects only the revalidated current attempt and emits no observation values", async () => {
    const { fixture, execution } = await createCompletedRuntimeStart();
    const input = {
      projectId: fixture.projectId,
      executionId: execution.id,
      expectedAttempt: execution.attempt,
    };
    const first = await db.transaction((tx) => projectExecutionProofGraph(tx, input));
    const retry = await db.transaction((tx) => projectExecutionProofGraph(tx, input));
    expect(first.kind).toBe("PROJECTED");
    expect(retry.kind).toBe("PROJECTED");
    if (first.kind !== "PROJECTED" || retry.kind !== "PROJECTED") return;

    expect(first.authority).toBe("READ_ONLY_PROJECTION");
    expect(first.canonicalProof).toMatchObject({
      accepted: true,
      verdict: "PROVEN",
      executionId: execution.id,
      attempt: execution.attempt,
    });
    expect(first.graphHash).toBe(retry.graphHash);
    expect(first.graph).toEqual(retry.graph);
    expect(first.graph.nodes.every((node) => !("value" in node))).toBe(true);
    const serializedGraph = JSON.stringify(first.graph);
    expect(serializedGraph).not.toContain("workspaceRoot");
    expect(serializedGraph).not.toContain('"pid"');
    expect(serializedGraph).not.toContain('"port"');

    const wrongAttempt = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      ...input,
      expectedAttempt: execution.attempt + 1,
    }));
    expect(wrongAttempt).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["ATTEMPT_MISMATCH"],
    });
    const wrongProject = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      ...input,
      projectId: randomUUID(),
    }));
    expect(wrongProject).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["EXECUTION_NOT_FOUND"],
    });

    const [acceptance] = await db.select({
      id: aiExecutionAcceptancesTable.id,
      evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
    }).from(aiExecutionAcceptancesTable).where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
    ));
    expect(acceptance?.evidenceSnapshotId).toBeTruthy();
    const [evidence] = await db.select().from(aiExecutionEvidenceSnapshotsTable)
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, acceptance!.evidenceSnapshotId!));
    expect(evidence?.artifactRefs).toBeTruthy();
  });

  it("rejects an observation whose stored digest no longer matches its private value", async () => {
    const { fixture, execution, gateCArtifact } = await createCompletedRuntimeStart();
    const [observation] = await db.select({ id: aiAgentObservationsTable.id })
      .from(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.id, gateCArtifact.afterObservationIds[0]!))
      .limit(1);
    expect(observation).toBeDefined();
    await db.update(aiAgentObservationsTable)
      .set({ valueHash: "0".repeat(64) })
      .where(eq(aiAgentObservationsTable.id, observation!.id));

    const result = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: fixture.projectId,
      executionId: execution.id,
      expectedAttempt: execution.attempt,
    }));
    expect(result).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["SOURCE_HASH_MISMATCH"],
    });
  });

  it("rejects missing evidence rows and revision drift instead of degrading the graph", async () => {
    const missingFixture = await createCompletedRuntimeStart();
    const [missingObservation] = await db.select({ id: aiAgentObservationsTable.id })
      .from(aiAgentObservationsTable)
      .where(eq(
        aiAgentObservationsTable.id,
        missingFixture.gateCArtifact.afterObservationIds[0]!,
      ))
      .limit(1);
    expect(missingObservation).toBeDefined();
    await db.delete(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.id, missingObservation!.id));
    const missingResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: missingFixture.fixture.projectId,
      executionId: missingFixture.execution.id,
      expectedAttempt: missingFixture.execution.attempt,
    }));
    expect(missingResult.kind).toBe("NOT_PROJECTABLE");

    const driftFixture = await createCompletedRuntimeStart();
    const [driftObservation] = await db.select({ id: aiAgentObservationsTable.id })
      .from(aiAgentObservationsTable)
      .where(eq(
        aiAgentObservationsTable.id,
        driftFixture.gateCArtifact.afterObservationIds[0]!,
      ))
      .limit(1);
    expect(driftObservation).toBeDefined();
    await db.update(aiAgentObservationsTable)
      .set({ projectRevision: "workspace-tree-v1:" + "a".repeat(64) })
      .where(eq(aiAgentObservationsTable.id, driftObservation!.id));
    const driftResult = await db.transaction((tx) => projectExecutionProofGraph(tx, {
      projectId: driftFixture.fixture.projectId,
      executionId: driftFixture.execution.id,
      expectedAttempt: driftFixture.execution.attempt,
    }));
    expect(driftResult).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["DOMAIN_PROOF_MISMATCH"],
    });
  });

  it("holds source observations stable until the caller's transaction commits", async () => {
    const { fixture, execution, gateCArtifact } = await createCompletedRuntimeStart();
    const [observation] = await db.select({
      id: aiAgentObservationsTable.id,
      freshness: aiAgentObservationsTable.freshness,
    }).from(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.id, gateCArtifact.afterObservationIds[0]!))
      .limit(1);
    expect(observation?.freshness).toBe("fresh");

    let announceProjected!: () => void;
    const projectedReady = new Promise<void>((resolve) => {
      announceProjected = resolve;
    });
    let releaseTransaction!: () => void;
    const holdTransaction = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const transaction = db.transaction(async (tx) => {
      const result = await projectExecutionProofGraph(tx, {
        projectId: fixture.projectId,
        executionId: execution.id,
        expectedAttempt: execution.attempt,
      });
      announceProjected();
      await holdTransaction;
      return result;
    });
    await projectedReady;

    let updateSettled = false;
    const concurrentUpdate = db.update(aiAgentObservationsTable)
      .set({ freshness: "stale" })
      .where(eq(aiAgentObservationsTable.id, observation!.id))
      .then(() => {
        updateSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const updateWasBlocked = !updateSettled;
    releaseTransaction();
    const result = await transaction;
    await concurrentUpdate;
    expect(updateWasBlocked).toBe(true);
    expect(result.kind).toBe("PROJECTED");
    if (result.kind === "PROJECTED") {
      expect(result.graph.nodes.find((node) => (
        node.kind === "OBSERVATION" && node.observationId === observation!.id
      ))).toMatchObject({ freshness: "fresh" });
    }
    expect(updateSettled).toBe(true);
  });
});

describe("GET /api/projects/:projectId/executions/:executionId/proof-graph/attempts/:attempt", () => {
  it("returns the separate graph and canonical verdict only to the authorized project owner", async () => {
    const { fixture, execution } = await createCompletedRuntimeStart();
    const path = `/api/projects/${fixture.projectId}/executions/${execution.id}/proof-graph/attempts/${execution.attempt}`;
    const [beforeExecution] = await db.select({
      status: aiExecutionsTable.status,
      attempt: aiExecutionsTable.attempt,
    }).from(aiExecutionsTable).where(eq(aiExecutionsTable.id, execution.id));
    const [beforeAcceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      attempt: aiExecutionAcceptancesTable.attempt,
    }).from(aiExecutionAcceptancesTable).where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
    ));
    const response = await request(app).get(path);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      kind: "PROJECTED",
      authority: "READ_ONLY_PROJECTION",
      canonicalProof: {
        accepted: true,
        verdict: "PROVEN",
        executionId: execution.id,
        attempt: execution.attempt,
      },
      structuralValidation: {
        authority: "STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY",
        verdict: "PASS",
      },
    });
    const serialized = JSON.stringify(response.body);
    expect(response.body.graph.nodes.every((node: Record<string, unknown>) => !("value" in node))).toBe(true);
    expect(serialized).not.toContain(fixture.rootPath);
    expect(serialized).not.toContain("workspaceRoot");
    expect(serialized).not.toContain('"pid"');
    expect(serialized).not.toContain('"port"');
    expect(serialized).not.toContain("runtime-session-");
    const [afterExecution] = await db.select({
      status: aiExecutionsTable.status,
      attempt: aiExecutionsTable.attempt,
    }).from(aiExecutionsTable).where(eq(aiExecutionsTable.id, execution.id));
    const [afterAcceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      attempt: aiExecutionAcceptancesTable.attempt,
    }).from(aiExecutionAcceptancesTable).where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
    ));
    expect(afterExecution).toEqual(beforeExecution);
    expect(afterAcceptance).toEqual(beforeAcceptance);

    const unauthorizedFixture = await createProjectFixture({ ownerId: "different-user" });
    const unauthorized = await request(app)
      .get(`/api/projects/${unauthorizedFixture.projectId}/executions/${execution.id}/proof-graph/attempts/${execution.attempt}`);
    expect(unauthorized.status).toBe(403);
    expect(JSON.stringify(unauthorized.body)).not.toContain('"graph"');
  });

  it("rejects malformed attempts and does not project an execution from another project", async () => {
    const { fixture, execution } = await createCompletedRuntimeStart();
    const invalidAttempt = await request(app)
      .get(`/api/projects/${fixture.projectId}/executions/${execution.id}/proof-graph/attempts/not-an-attempt`);
    expect(invalidAttempt.status).toBe(400);
    expect(invalidAttempt.body.code).toBe("PROOF_GRAPH_ATTEMPT_INVALID");

    const otherFixture = await createProjectFixture();
    const mismatch = await request(app)
      .get(`/api/projects/${otherFixture.projectId}/executions/${execution.id}/proof-graph/attempts/${execution.attempt}`);
    expect(mismatch.status).toBe(200);
    expect(mismatch.body).toMatchObject({
      kind: "NOT_PROJECTABLE",
      reasons: ["EXECUTION_NOT_FOUND"],
    });
    expect(mismatch.body.graph).toBeUndefined();
  });
});

describe("POST /api/projects/:projectId/runtime/start", () => {
  it("uses the durable action spine and returns the existing runtime snapshot shape", async () => {
    const fixture = await createProjectFixture();
    const runtime = createRuntimeMock(fixture.projectId, fixture.sourceRevision);
    const idempotencyKey = "runtime-start-route-success-001";

    const first = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/start`)
      .set("Idempotency-Key", idempotencyKey);

    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      projectId: fixture.projectId,
      status: "running",
      operationStatus: "completed",
      executionId: expect.any(String),
      operationId: expect.any(String),
      receipt: { status: "completed" },
    });
    expect(runtime.startSpy).toHaveBeenCalledTimes(1);
    const [persistedExecution] = await db.select({
      status: aiExecutionsTable.status,
      recipeReceipt: aiExecutionsTable.recipeReceipt,
    }).from(aiExecutionsTable).where(eq(aiExecutionsTable.id, first.body.executionId));
    expect(persistedExecution).toMatchObject({
      status: "completed",
      recipeReceipt: { status: "completed" },
    });

    const retry = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/start`)
      .set("Idempotency-Key", idempotencyKey);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.executionId).toBe(first.body.executionId);
    expect(retry.body.operationId).toBe(first.body.operationId);
    expect(runtime.startSpy).toHaveBeenCalledTimes(1);

    const [bundle] = await db.select().from(aiAgentEffectBundlesTable)
      .where(eq(aiAgentEffectBundlesTable.executionId, first.body.executionId))
      .limit(1);
    expect(bundle).toMatchObject({ verdict: "OBSERVED" });
    const effects = await db.select().from(aiAgentEffectsTable)
      .where(eq(aiAgentEffectsTable.executionId, first.body.executionId));
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ capabilityId: "runtime.start", status: "observed" });
    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable).where(and(
      eq(aiExecutionAcceptancesTable.executionId, first.body.executionId),
      eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
    )).limit(1);
    expect(acceptance?.effectBundleId).toBe(bundle?.id);
    const observations = await db.select().from(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.executionId, first.body.executionId));
    const runtimeStateObservation = observations.find((row) => (
      row.predicate === "runtime.after_state"
      && row.observationRole === "after"
      && row.sourceId.startsWith(`runtime-start:${first.body.executionId}:`)
      && row.sourceId.endsWith(":runtime.after_state")
    ));
    expect(runtimeStateObservation?.value).toMatchObject({
      status: "passed",
      runtimeStatus: "running",
      projectId: fixture.projectId,
      revision: fixture.sourceRevision,
      sessionId: `runtime-session-${fixture.projectId}`,
      processAlive: true,
      portReady: true,
    });
    expect(runtimeStateObservation?.value).not.toHaveProperty("after");
    const childProcessObservation = observations.find(
      (row) => (
        row.predicate === "runtime.child_process_environment"
        && row.sourceType === "child_process_attestation"
        && row.value
        && typeof row.value === "object"
        && !Array.isArray(row.value)
        && (row.value as Record<string, unknown>).operationId === first.body.operationId
      ),
    );
    expect(childProcessObservation).toMatchObject({
      environmentRevision: expect.stringMatching(/^env-v1:[a-f0-9]{64}$/),
      value: {
        status: "known",
        operationId: first.body.operationId,
        sessionId: `runtime-session-${fixture.projectId}`,
      },
    });
    const events = await db.select({ eventType: aiAgentEpisodeEventsTable.eventType })
      .from(aiAgentEpisodeEventsTable)
      .where(eq(aiAgentEpisodeEventsTable.executionId, first.body.executionId));
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["ACTION_REQUESTED", "ACTION_COMMITTED", "EFFECT_CLASSIFIED"]),
    );
    const [episode] = await db.select().from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.executionId, first.body.executionId))
      .limit(1);
    expect(episode).toMatchObject({
      state: "completed",
      verdict: "achieved",
      reasonCode: "CANONICAL_PROOF_PROVEN",
    });
  });

  it("does not accept an unavailable stale after-state", async () => {
    const fixture = await createProjectFixture();
    createRuntimeMock(fixture.projectId, fixture.sourceRevision, {
      status: "unavailable",
      revision: "stale-runtime-revision",
      detail: "Runtime after-state did not match the requested revision.",
    });

    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/start`)
      .set("Idempotency-Key", "runtime-start-route-stale-001");

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      status: "running",
      operationStatus: "blocked",
      code: "RUNTIME_START_NOT_VERIFIED",
    });
    const executions = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.projectId, fixture.projectId));
    expect(executions).toHaveLength(1);
    const acceptances = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executions[0]!.id));
    expect(acceptances.some((row) => row.outcome === "SUCCEEDED")).toBe(false);
    expect(acceptances.every((row) => row.effectBundleId === null)).toBe(true);
  });
});

async function assertRuntimeRouteEvidence(executionId: string, capabilityId: string) {
  const [bundle] = await db.select().from(aiAgentEffectBundlesTable)
    .where(eq(aiAgentEffectBundlesTable.executionId, executionId)).limit(1);
  expect(bundle).toMatchObject({ verdict: "OBSERVED" });
  const effects = await db.select().from(aiAgentEffectsTable)
    .where(eq(aiAgentEffectsTable.executionId, executionId));
  expect(effects).toHaveLength(1);
  expect(effects[0]).toMatchObject({ capabilityId, status: "observed" });
  const [acceptance] = await db.select({
    outcome: aiExecutionAcceptancesTable.outcome,
    effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
  }).from(aiExecutionAcceptancesTable).where(and(
    eq(aiExecutionAcceptancesTable.executionId, executionId),
    eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
  )).limit(1);
  expect(acceptance?.effectBundleId).toBe(bundle?.id);
  const observations = await db.select().from(aiAgentObservationsTable)
    .where(eq(aiAgentObservationsTable.executionId, executionId));
  const runtimeStateObservation = observations.find((row) => (
    row.predicate === "runtime.after_state"
    && row.observationRole === "after"
    && row.sourceId.startsWith(`gate-c:${executionId}:`)
    && row.sourceId.endsWith(":after:runtime-state")
  ));
  if (capabilityId === "runtime.stop") {
    expect(runtimeStateObservation?.value).toMatchObject({
      before: {
        listener: {
          status: "known",
          processAttestation: { status: "known" },
        },
      },
    });
  } else {
    expect(runtimeStateObservation?.value).toMatchObject({
      after: {
        listener: {
          status: "known",
          processAttestation: { status: "known" },
        },
      },
    });
  }
}

describe.each([
  { action: "restart", capability: "runtime.restart" },
  { action: "stop", capability: "runtime.stop" },
] as const)("POST /api/projects/:projectId/runtime/$action", ({ action, capability }) => {
  it("uses the real recipe operation and is idempotent", async () => {
    const fixture = await createProjectFixture();
    const runtime = createRuntimeMock(fixture.projectId, fixture.sourceRevision);
    const originalGet = vi.mocked(workspaceRuntime.get);
    const stopped: WorkspaceRuntimeSnapshot = {
      ...runtime.snapshot,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
      pid: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    };
    const operation = action === "restart"
      ? vi.spyOn(workspaceRuntime, "start").mockResolvedValue(runtime.snapshot)
      : vi.spyOn(workspaceRuntime, "stop").mockResolvedValue(stopped);
    if (action === "stop") {
      originalGet.mockReset()
        .mockResolvedValueOnce(runtime.snapshot)
        .mockResolvedValue(stopped);
      vi.spyOn(workspaceRuntime, "observeRunningBeforeStop").mockResolvedValue({
        ...runtime.afterState,
        pid: runtime.snapshot.pid,
        port: runtime.snapshot.port!,
        status: "passed",
        processAlive: true,
        portReady: true,
        detail: "Runtime process and port were observed before stop.",
      });
      vi.spyOn(workspaceRuntime, "observeStoppedAfterState").mockResolvedValue({
        ...runtime.afterState,
        pid: runtime.snapshot.pid,
        port: runtime.snapshot.port!,
        status: "passed",
        processAlive: false,
        portReady: false,
        healthStatus: null,
        servingRevision: null,
        markerMatched: null,
        listener: {
          status: "unknown",
          reasonCode: "listener_not_running",
          port: null,
          identityDigest: null,
          processAttestation: {
            status: "unknown",
            reasonCode: "process_unavailable",
            bindingDigest: null,
            attestationDigest: null,
            processEnvironmentDigest: null,
            observedAt: new Date().toISOString(),
          },
        },
        detail: "Runtime process and port closure were observed.",
      });
    }
    const key = `runtime-${action}-route-success-001`;
    const first = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/${action}`)
      .set("Idempotency-Key", key);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      operationStatus: "completed",
      executionId: expect.any(String),
      receipt: { status: "completed" },
    });
    expect(operation).toHaveBeenCalledTimes(1);
    await assertRuntimeRouteEvidence(first.body.executionId, capability);
    const retry = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/${action}`)
      .set("Idempotency-Key", key);
    expect(retry.status).toBe(200);
    expect(retry.body.executionId).toBe(first.body.executionId);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("blocks an unavailable after-state without successful acceptance", async () => {
    const fixture = await createProjectFixture();
    const runtime = createRuntimeMock(fixture.projectId, fixture.sourceRevision, {
      status: "unavailable",
      revision: "stale-runtime-revision",
      detail: "Runtime after-state did not match the requested revision.",
    });
    if (action === "stop") {
      const stopped: WorkspaceRuntimeSnapshot = {
        ...runtime.snapshot,
        status: "stopped",
        stoppedAt: new Date().toISOString(),
        pid: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
      };
      vi.mocked(workspaceRuntime.get).mockReset()
        .mockResolvedValueOnce(runtime.snapshot)
        .mockResolvedValue(stopped);
      vi.spyOn(workspaceRuntime, "stop").mockResolvedValue(stopped);
      vi.spyOn(workspaceRuntime, "observeRunningBeforeStop").mockResolvedValue({
        ...runtime.afterState,
        status: "passed",
        processAlive: true,
        portReady: true,
        pid: runtime.snapshot.pid,
        port: runtime.snapshot.port!,
      });
      vi.spyOn(workspaceRuntime, "observeStoppedAfterState").mockResolvedValue({
        ...runtime.afterState,
        status: "unavailable",
        pid: runtime.snapshot.pid,
        port: runtime.snapshot.port!,
        listener: {
          status: "unknown",
          reasonCode: "listener_not_running",
          port: null,
          identityDigest: null,
          processAttestation: {
            status: "unknown",
            reasonCode: "process_unavailable",
            bindingDigest: null,
            attestationDigest: null,
            processEnvironmentDigest: null,
            observedAt: new Date().toISOString(),
          },
        },
      });
    } else {
      vi.spyOn(workspaceRuntime, "start").mockResolvedValue(runtime.snapshot);
    }
    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/${action}`)
      .set("Idempotency-Key", `runtime-${action}-route-stale-001`);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      operationStatus: "blocked",
      code: `RUNTIME_${action.toUpperCase()}_NOT_VERIFIED`,
    });
    const executions = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, fixture.projectId));
    const acceptances = await db.select({ outcome: aiExecutionAcceptancesTable.outcome })
      .from(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, executions[0]!.id));
    expect(acceptances.some((row) => row.outcome === "SUCCEEDED")).toBe(false);
  });
});

describe("POST /api/projects/:projectId/runtime/stop preflight", () => {
  it("does not stop when the direct pre-stop process observation is unavailable", async () => {
    const fixture = await createProjectFixture();
    const runtime = createRuntimeMock(fixture.projectId, fixture.sourceRevision);
    vi.spyOn(workspaceRuntime, "get").mockResolvedValue(runtime.snapshot);
    const stop = vi.spyOn(workspaceRuntime, "stop").mockResolvedValue({
      ...runtime.snapshot,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
      pid: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    });
    vi.spyOn(workspaceRuntime, "observeRunningBeforeStop").mockResolvedValue({
      ...runtime.afterState,
      status: "unavailable",
      processAlive: false,
      portReady: false,
      pid: runtime.snapshot.pid,
      port: runtime.snapshot.port!,
      detail: "Runtime process or port was unavailable before stop.",
    });
    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/runtime/stop`)
      .set("Idempotency-Key", "runtime-stop-preflight-failure-001");
    expect(response.status).toBe(409);
    expect(stop).not.toHaveBeenCalled();
    const [execution] = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, fixture.projectId));
    const acceptances = await db.select({ outcome: aiExecutionAcceptancesTable.outcome })
      .from(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, execution!.id));
    expect(acceptances.some((row) => row.outcome === "SUCCEEDED")).toBe(false);
  });
});