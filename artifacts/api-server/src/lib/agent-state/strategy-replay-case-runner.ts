import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import {
  canonicalJsonHash,
  StrategyCandidateSchema,
  StrategyReplayCaseProofBindingSchema,
  type JsonValue,
} from "@workspace/ai-orchestrator";
import {
  aiAgentEpisodesTable,
  aiExecutionAcceptancesTable,
  aiStrategyCandidatesTable,
  aiStrategyReplayCaseRunsTable,
  aiStrategyReplayCasesTable,
  db,
  projectsTable,
} from "@workspace/db";
import { z } from "zod/v4";
import { createValidationWorkspace } from "../ai-repair-validation.js";
import { hashDeliveryTree } from "../delivery-workspace.js";
import { establishProjectRoot } from "../project-root.js";
import {
  createRuntimeStartRunner,
  runRecipeOperation,
} from "../recipe-operation-runner.js";
import {
  materializeStrategyReplayCaseProofBinding,
  verifyStrategyReplayCaseProofBinding,
} from "./strategy-replay-case-proof.js";
import {
  RegisteredStrategyReplayCaseDefinitionSchema,
  type RegisteredStrategyReplayCaseDefinition,
} from "./strategy-replay-case-registry.js";
import { createInMemoryWorkspaceRuntimeStore } from "../workspace-runtime-store.js";
import { WorkspaceRuntimeManager } from "../workspace-runtime.js";

const execFileAsync = promisify(execFile);
const HASH = /^[a-f0-9]{64}$/;
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const ReplayCaseRunReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1).max(200),
  operationId: z.string().min(1).max(200),
  status: z.enum(["proven", "incomplete"]),
  incompleteReason: z.enum([
    "source_workspace_unavailable",
    "source_revision_mismatch",
    "runner_blocked",
    "replay_proof_not_proven",
    "replay_identity_mismatch",
  ]).nullable(),
  partition: z.literal("held_out"),
  projectId: z.string().min(1).max(200),
  caseRegistrationId: z.string().min(1).max(200),
  caseId: z.string().min(1).max(200),
  candidateId: z.string().min(1).max(200),
  candidateHash: z.string().regex(HASH),
  sourceRevision: z.string().regex(SOURCE_REVISION),
  sourceEpisodeId: z.string().min(1).max(200),
  sourceExecutionId: z.string().min(1).max(200),
  sourceAttempt: z.number().int().nonnegative(),
  sourceAcceptanceId: z.string().min(1).max(200),
  sourceEffectBundleId: z.string().min(1).max(200),
  sourceCanonicalProofHash: z.string().regex(HASH),
  replayExecutionId: z.string().min(1).max(200).nullable(),
  replayAttempt: z.number().int().nonnegative().nullable(),
  replayEpisodeId: z.string().min(1).max(200).nullable(),
  replayAcceptanceId: z.string().min(1).max(200).nullable(),
  replayEffectBundleId: z.string().min(1).max(200).nullable(),
  replayCanonicalProofHash: z.string().regex(HASH).nullable(),
  workspaceTreeHash: z.string().regex(HASH).nullable(),
}).strict().superRefine((receipt, context) => {
  const replayFields = [
    receipt.replayExecutionId,
    receipt.replayAttempt,
    receipt.replayEpisodeId,
    receipt.replayAcceptanceId,
    receipt.replayEffectBundleId,
    receipt.replayCanonicalProofHash,
    receipt.workspaceTreeHash,
  ];
  if (receipt.status === "proven" && replayFields.some((value) => value === null)) {
    context.addIssue({ code: "custom", message: "Proven replay receipt is missing a bound result identity." });
  }
  if (receipt.status === "proven" && receipt.incompleteReason !== null) {
    context.addIssue({ code: "custom", message: "Proven replay receipt cannot include an incomplete reason." });
  }
  if (receipt.status === "incomplete" && !receipt.incompleteReason) {
    context.addIssue({ code: "custom", message: "Incomplete replay receipt requires a bounded reason." });
  }
});

export type StrategyReplayCaseRunReceipt = z.infer<typeof ReplayCaseRunReceiptSchema>;

export type StrategyReplayCaseRunResult = {
  status: "proven" | "incomplete";
  receipt: StrategyReplayCaseRunReceipt;
  recovered: boolean;
};

type ReplayCaseSnapshot = {
  definition: RegisteredStrategyReplayCaseDefinition;
  projectRootPath: string | null;
  consented: boolean;
  candidate: ReturnType<typeof StrategyCandidateSchema.parse>;
  runId: string;
  operationId: string;
  replayRun: typeof aiStrategyReplayCaseRunsTable.$inferSelect;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function deterministicIdentity(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

function sourceProofBinding(definition: RegisteredStrategyReplayCaseDefinition) {
  return StrategyReplayCaseProofBindingSchema.safeParse({
    caseId: definition.caseId,
    projectId: definition.projectId,
    sourceRevision: definition.sourceRevision,
    sourceEpisodeId: definition.sourceEpisodeId,
    executionId: definition.sourceExecutionId,
    attempt: definition.sourceAttempt,
    acceptanceId: definition.acceptanceId,
    effectBundleId: definition.effectBundleId,
    sourceCanonicalProofHash: definition.sourceCanonicalProofHash,
  });
}

function validateCandidate(input: {
  candidateRow: typeof aiStrategyCandidatesTable.$inferSelect;
  definition: RegisteredStrategyReplayCaseDefinition;
}): ReturnType<typeof StrategyCandidateSchema.parse> | undefined {
  const parsed = StrategyCandidateSchema.safeParse(input.candidateRow.candidate);
  if (!parsed.success) return undefined;
  const candidate = parsed.data;
  if (
    input.candidateRow.id !== input.definition.candidateId
    || input.candidateRow.projectId !== input.definition.projectId
    || input.candidateRow.candidateHash !== input.definition.candidateHash
    || input.candidateRow.sourceRevision !== input.definition.sourceRevision
    || input.candidateRow.evaluationStatus !== "pending_replay"
    || candidate.candidateId !== input.candidateRow.id
    || candidate.evaluationStatus !== "pending_replay"
    || canonicalJsonHash(candidate as unknown as JsonValue) !== input.candidateRow.candidateHash
    || candidate.supportingEpisodeIds.includes(input.definition.sourceEpisodeId)
  ) {
    return undefined;
  }
  return candidate;
}

async function loadOrReserveReplayRun(input: {
  projectId: string;
  caseRegistrationId: string;
}): Promise<ReplayCaseSnapshot | undefined> {
  return db.transaction(async (tx) => {
    const [caseRow] = await tx.select().from(aiStrategyReplayCasesTable).where(and(
      eq(aiStrategyReplayCasesTable.id, input.caseRegistrationId),
      eq(aiStrategyReplayCasesTable.projectId, input.projectId),
    )).for("update");
    if (!caseRow) return undefined;

    const parsedDefinition = RegisteredStrategyReplayCaseDefinitionSchema.safeParse(caseRow.caseDefinition);
    if (
      !parsedDefinition.success
      || parsedDefinition.data.projectId !== caseRow.projectId
      || parsedDefinition.data.candidateId !== caseRow.candidateId
      || parsedDefinition.data.sourceEpisodeId !== caseRow.sourceEpisodeId
    ) {
      return undefined;
    }
    const definition = parsedDefinition.data;
    if (
      definition.recipeId !== "runtime.start"
      || definition.capabilityId !== "runtime.start"
      || !HASH.test(definition.candidateHash)
      || !HASH.test(definition.actionContractHash)
    ) {
      return undefined;
    }

    const [project] = await tx.select({
      rootPath: projectsTable.rootPath,
      strategyReplayOptIn: projectsTable.strategyReplayOptIn,
    }).from(projectsTable).where(eq(projectsTable.id, input.projectId)).for("update");
    if (!project) return undefined;

    const [candidateRow] = await tx.select().from(aiStrategyCandidatesTable).where(and(
      eq(aiStrategyCandidatesTable.id, definition.candidateId),
      eq(aiStrategyCandidatesTable.projectId, input.projectId),
    )).for("update");
    if (!candidateRow) return undefined;
    const candidate = validateCandidate({ candidateRow, definition });
    if (!candidate) return undefined;

    const runId = deterministicIdentity("strategy-replay-run", caseRow.id);
    const operationId = deterministicIdentity("strategy-replay-operation", caseRow.id);
    let [replayRun] = await tx.select().from(aiStrategyReplayCaseRunsTable)
      .where(eq(aiStrategyReplayCaseRunsTable.caseRegistrationId, caseRow.id))
      .for("update");
    if (!replayRun) {
      if (!project.strategyReplayOptIn) return undefined;
      [replayRun] = await tx.insert(aiStrategyReplayCaseRunsTable).values({
        id: runId,
        projectId: input.projectId,
        caseRegistrationId: caseRow.id,
        candidateId: definition.candidateId,
        sourceEpisodeId: definition.sourceEpisodeId,
        operationId,
        candidateHash: definition.candidateHash,
        sourceCanonicalProofHash: definition.sourceCanonicalProofHash,
        status: "running",
      }).onConflictDoNothing().returning();
      if (!replayRun) {
        [replayRun] = await tx.select().from(aiStrategyReplayCaseRunsTable)
          .where(eq(aiStrategyReplayCaseRunsTable.caseRegistrationId, caseRow.id))
          .for("update");
      }
    }
    if (!replayRun) return undefined;
    if (!project.strategyReplayOptIn && replayRun.status === "running") return undefined;
    if (
      replayRun.id !== runId
      || replayRun.operationId !== operationId
      || replayRun.candidateHash !== definition.candidateHash
      || replayRun.sourceCanonicalProofHash !== definition.sourceCanonicalProofHash
    ) {
      return undefined;
    }

    return {
      definition,
      projectRootPath: project.rootPath,
      consented: Boolean(project.strategyReplayOptIn),
      candidate,
      runId,
      operationId,
      replayRun,
    };
  });
}

function makeReceipt(
  snapshot: ReplayCaseSnapshot,
  input: {
    status: "proven" | "incomplete";
    incompleteReason?: StrategyReplayCaseRunReceipt["incompleteReason"];
    workspaceTreeHash?: string | null;
    replayExecutionId?: string | null;
    replayAttempt?: number | null;
    replayEpisodeId?: string | null;
    replayAcceptanceId?: string | null;
    replayEffectBundleId?: string | null;
    replayCanonicalProofHash?: string | null;
  },
): StrategyReplayCaseRunReceipt {
  return ReplayCaseRunReceiptSchema.parse({
    schemaVersion: 1,
    runId: snapshot.runId,
    operationId: snapshot.operationId,
    status: input.status,
    incompleteReason: input.status === "incomplete" ? input.incompleteReason ?? "replay_proof_not_proven" : null,
    partition: "held_out",
    projectId: snapshot.definition.projectId,
    caseRegistrationId: snapshot.replayRun.caseRegistrationId,
    caseId: snapshot.definition.caseId,
    candidateId: snapshot.definition.candidateId,
    candidateHash: snapshot.definition.candidateHash,
    sourceRevision: snapshot.definition.sourceRevision,
    sourceEpisodeId: snapshot.definition.sourceEpisodeId,
    sourceExecutionId: snapshot.definition.sourceExecutionId,
    sourceAttempt: snapshot.definition.sourceAttempt,
    sourceAcceptanceId: snapshot.definition.acceptanceId,
    sourceEffectBundleId: snapshot.definition.effectBundleId,
    sourceCanonicalProofHash: snapshot.definition.sourceCanonicalProofHash,
    replayExecutionId: input.replayExecutionId ?? null,
    replayAttempt: input.replayAttempt ?? null,
    replayEpisodeId: input.replayEpisodeId ?? null,
    replayAcceptanceId: input.replayAcceptanceId ?? null,
    replayEffectBundleId: input.replayEffectBundleId ?? null,
    replayCanonicalProofHash: input.replayCanonicalProofHash ?? null,
    workspaceTreeHash: input.workspaceTreeHash ?? null,
  });
}

async function persistReceipt(
  snapshot: ReplayCaseSnapshot,
  receipt: StrategyReplayCaseRunReceipt,
): Promise<void> {
  await db.update(aiStrategyReplayCaseRunsTable).set({
    status: receipt.status,
    replayExecutionId: receipt.replayExecutionId,
    replayEpisodeId: receipt.replayEpisodeId,
    replayAttempt: receipt.replayAttempt,
    replayEffectBundleId: receipt.replayEffectBundleId,
    replayCanonicalProofHash: receipt.replayCanonicalProofHash,
    workspaceTreeHash: receipt.workspaceTreeHash,
    receipt: receipt as unknown as JsonValue,
    updatedAt: new Date(),
  }).where(and(
    eq(aiStrategyReplayCaseRunsTable.id, snapshot.runId),
    eq(aiStrategyReplayCaseRunsTable.status, "running"),
  ));
}

async function assertCleanRevision(rootPath: string, sourceRevision: string): Promise<void> {
  const [head, status] = await Promise.all([
    execFileAsync("git", ["-C", rootPath, "rev-parse", "--verify", "HEAD"], {
      timeout: 10_000,
      maxBuffer: 8_192,
    }),
    execFileAsync("git", ["-C", rootPath, "status", "--porcelain", "--untracked-files=all"], {
      timeout: 10_000,
      maxBuffer: 32_768,
    }),
  ]);
  if (
    !SOURCE_REVISION.test(head.stdout.trim())
    || head.stdout.trim() !== sourceRevision
    || status.stdout.trim() !== ""
  ) {
    throw new Error("source_revision_mismatch");
  }
}

async function verifyStoredReceipt(
  snapshot: ReplayCaseSnapshot,
): Promise<StrategyReplayCaseRunReceipt | undefined> {
  const parsedReceipt = ReplayCaseRunReceiptSchema.safeParse(snapshot.replayRun.receipt);
  const parsedSourceBinding = sourceProofBinding(snapshot.definition);
  if (!parsedReceipt.success || !parsedSourceBinding.success) return undefined;
  const receipt = parsedReceipt.data;
  if (
    receipt.status !== snapshot.replayRun.status
    || receipt.runId !== snapshot.runId
    || receipt.operationId !== snapshot.operationId
    || receipt.candidateHash !== snapshot.definition.candidateHash
    || receipt.sourceCanonicalProofHash !== snapshot.definition.sourceCanonicalProofHash
    || receipt.sourceEpisodeId !== snapshot.definition.sourceEpisodeId
    || receipt.replayExecutionId !== snapshot.replayRun.replayExecutionId
    || receipt.replayEpisodeId !== snapshot.replayRun.replayEpisodeId
    || receipt.replayAttempt !== snapshot.replayRun.replayAttempt
    || receipt.replayEffectBundleId !== snapshot.replayRun.replayEffectBundleId
    || receipt.replayCanonicalProofHash !== snapshot.replayRun.replayCanonicalProofHash
    || receipt.workspaceTreeHash !== snapshot.replayRun.workspaceTreeHash
  ) {
    return undefined;
  }
  const sourceProof = await verifyStrategyReplayCaseProofBinding(parsedSourceBinding.data);
  if (sourceProof.status !== "verified") return undefined;
  if (receipt.status === "incomplete") return receipt;

  if (
    !receipt.replayEpisodeId
    || !receipt.replayExecutionId
    || !receipt.replayCanonicalProofHash
    || !receipt.workspaceTreeHash
  ) {
    return undefined;
  }
  const [episode] = await db.select().from(aiAgentEpisodesTable).where(and(
    eq(aiAgentEpisodesTable.id, receipt.replayEpisodeId),
    eq(aiAgentEpisodesTable.projectId, snapshot.definition.projectId),
  )).limit(1);
  const replayScope = asRecord(episode?.scope);
  const replayCaseScope = asRecord(replayScope?.strategyReplayCase);
  if (
    !episode
    || !replayCaseScope
    || episode.executionId !== receipt.replayExecutionId
    || episode.attempt !== receipt.replayAttempt
    || episode.id === snapshot.definition.sourceEpisodeId
    || episode.projectRevision !== snapshot.definition.sourceRevision
    || replayCaseScope?.caseRegistrationId !== snapshot.replayRun.caseRegistrationId
    || replayCaseScope.caseId !== snapshot.definition.caseId
    || replayCaseScope.candidateId !== snapshot.definition.candidateId
    || replayCaseScope.candidateHash !== snapshot.definition.candidateHash
    || replayCaseScope.sourceEpisodeId !== snapshot.definition.sourceEpisodeId
    || replayCaseScope.sourceCanonicalProofHash !== snapshot.definition.sourceCanonicalProofHash
  ) {
    return undefined;
  }
  const replayProof = await materializeStrategyReplayCaseProofBinding({
    projectId: snapshot.definition.projectId,
    episodeId: receipt.replayEpisodeId,
  });
  if (
    replayProof.status !== "verified"
    || replayProof.binding.executionId !== receipt.replayExecutionId
    || replayProof.binding.attempt !== receipt.replayAttempt
    || replayProof.binding.acceptanceId !== receipt.replayAcceptanceId
    || replayProof.binding.effectBundleId !== receipt.replayEffectBundleId
    || replayProof.binding.sourceCanonicalProofHash !== receipt.replayCanonicalProofHash
    || replayProof.binding.sourceCanonicalProofHash === snapshot.definition.sourceCanonicalProofHash
  ) {
    return undefined;
  }
  const [acceptance] = await db.select().from(aiExecutionAcceptancesTable).where(and(
    eq(aiExecutionAcceptancesTable.executionId, receipt.replayExecutionId),
    eq(aiExecutionAcceptancesTable.projectId, snapshot.definition.projectId),
    eq(aiExecutionAcceptancesTable.attempt, receipt.replayAttempt!),
  )).limit(1);
  if (!acceptance || acceptance.candidateIdentity !== receipt.workspaceTreeHash) return undefined;
  return receipt;
}

export async function runRegisteredStrategyReplayCase(input: {
  projectId: string;
  caseRegistrationId: string;
  userId: string;
}): Promise<StrategyReplayCaseRunResult> {
  const snapshot = await loadOrReserveReplayRun(input);
  if (!snapshot) {
    throw new Error("Registered Strategy Replay case is not eligible.");
  }
  const parsedSourceBinding = sourceProofBinding(snapshot.definition);
  if (!parsedSourceBinding.success) {
    throw new Error("Registered Strategy Replay source binding is invalid.");
  }
  const sourceProof = await verifyStrategyReplayCaseProofBinding(parsedSourceBinding.data);
  if (sourceProof.status !== "verified") {
    throw new Error("Registered Strategy Replay source proof is no longer valid.");
  }

  if (snapshot.replayRun.status !== "running") {
    const receipt = await verifyStoredReceipt(snapshot);
    if (!receipt) throw new Error("Stored Strategy Replay receipt failed revalidation.");
    return { status: receipt.status, receipt, recovered: true };
  }

  let workspace: Awaited<ReturnType<typeof createValidationWorkspace>> | undefined;
  const runtimeManager = new WorkspaceRuntimeManager({
    store: createInMemoryWorkspaceRuntimeStore(),
  });
  try {
    if (!snapshot.projectRootPath) {
      const receipt = makeReceipt(snapshot, {
        status: "incomplete",
        incompleteReason: "source_workspace_unavailable",
      });
      await persistReceipt(snapshot, receipt);
      return { status: receipt.status, receipt, recovered: false };
    }
    const establishedRoot = await establishProjectRoot(snapshot.projectRootPath);
    if (!establishedRoot.ok) {
      const receipt = makeReceipt(snapshot, {
        status: "incomplete",
        incompleteReason: "source_workspace_unavailable",
      });
      await persistReceipt(snapshot, receipt);
      return { status: receipt.status, receipt, recovered: false };
    }

    await assertCleanRevision(establishedRoot.canonicalPath, snapshot.definition.sourceRevision);
    workspace = await createValidationWorkspace(
      establishedRoot.canonicalPath,
      [],
      async () => undefined,
    );
    await assertCleanRevision(establishedRoot.canonicalPath, snapshot.definition.sourceRevision);
    const workspaceTreeHash = await hashDeliveryTree(workspace.rootPath);

    const result = await runRecipeOperation({
      projectId: snapshot.definition.projectId,
      operationId: snapshot.operationId,
      rootPath: establishedRoot.canonicalPath,
      sourceRevision: snapshot.definition.sourceRevision,
      recipeId: "runtime.start",
      recipeVersion: 1,
      candidateIdentity: workspaceTreeHash,
      candidateWorkspace: workspace.rootPath,
      userId: input.userId,
      idempotencyKey: `strategy-replay-case:${createHash("sha256").update(snapshot.replayRun.caseRegistrationId).digest("hex")}`,
      runtimeStartRunner: createRuntimeStartRunner(runtimeManager),
      strategyReplayContext: {
        caseRegistrationId: snapshot.replayRun.caseRegistrationId,
        caseId: snapshot.definition.caseId,
        candidateId: snapshot.definition.candidateId,
        candidateHash: snapshot.definition.candidateHash,
        sourceEpisodeId: snapshot.definition.sourceEpisodeId,
        sourceCanonicalProofHash: snapshot.definition.sourceCanonicalProofHash,
        expectedActionContractHash: snapshot.definition.actionContractHash,
      },
    });

    await runtimeManager.stop(snapshot.definition.projectId);
    const finalWorkspaceTreeHash = await hashDeliveryTree(workspace.rootPath);
    const workspaceUnchanged = finalWorkspaceTreeHash === workspaceTreeHash;
    const [replayEpisode] = await db.select().from(aiAgentEpisodesTable).where(and(
      eq(aiAgentEpisodesTable.projectId, snapshot.definition.projectId),
      eq(aiAgentEpisodesTable.executionId, result.executionId),
    )).limit(1);
    const replayScope = asRecord(replayEpisode?.scope);
    const replayCaseScope = asRecord(replayScope?.strategyReplayCase);
    const replayProof = result.status === "completed" && replayEpisode
      ? await materializeStrategyReplayCaseProofBinding({
          projectId: snapshot.definition.projectId,
          episodeId: replayEpisode.id,
        })
      : undefined;
    if (
      result.status !== "completed"
      || !replayEpisode
      || !replayCaseScope
      || replayEpisode.executionId === snapshot.definition.sourceExecutionId
      || replayEpisode.id === snapshot.definition.sourceEpisodeId
      || replayEpisode.attempt !== result.receipt.attempt
      || replayEpisode.projectRevision !== snapshot.definition.sourceRevision
      || replayCaseScope?.caseRegistrationId !== snapshot.replayRun.caseRegistrationId
      || replayCaseScope.caseId !== snapshot.definition.caseId
      || replayCaseScope.candidateId !== snapshot.definition.candidateId
      || replayCaseScope.candidateHash !== snapshot.definition.candidateHash
      || replayCaseScope.sourceEpisodeId !== snapshot.definition.sourceEpisodeId
      || replayCaseScope.sourceCanonicalProofHash !== snapshot.definition.sourceCanonicalProofHash
      || !workspaceUnchanged
      || replayProof?.status !== "verified"
      || replayProof.binding.executionId !== result.executionId
      || replayProof.binding.attempt !== replayEpisode.attempt
      || replayProof.binding.acceptanceId === snapshot.definition.acceptanceId
      || replayProof.binding.effectBundleId === snapshot.definition.effectBundleId
      || replayProof.binding.sourceCanonicalProofHash === snapshot.definition.sourceCanonicalProofHash
    ) {
      const receipt = makeReceipt(snapshot, {
        status: "incomplete",
        incompleteReason: result.status === "blocked"
          ? "runner_blocked"
          : !workspaceUnchanged
            ? "replay_identity_mismatch"
            : "replay_proof_not_proven",
        replayExecutionId: result.executionId,
        replayAttempt: result.receipt.attempt,
        replayEpisodeId: replayEpisode?.id ?? null,
        workspaceTreeHash,
      });
      await persistReceipt(snapshot, receipt);
      return { status: receipt.status, receipt, recovered: false };
    }

    const [acceptance] = await db.select().from(aiExecutionAcceptancesTable).where(and(
      eq(aiExecutionAcceptancesTable.executionId, result.executionId),
      eq(aiExecutionAcceptancesTable.projectId, snapshot.definition.projectId),
      eq(aiExecutionAcceptancesTable.attempt, replayEpisode.attempt),
    )).limit(1);
    if (!acceptance || acceptance.candidateIdentity !== workspaceTreeHash) {
      const receipt = makeReceipt(snapshot, {
        status: "incomplete",
        incompleteReason: "replay_identity_mismatch",
        replayExecutionId: result.executionId,
        replayAttempt: replayEpisode.attempt,
        replayEpisodeId: replayEpisode.id,
        workspaceTreeHash,
      });
      await persistReceipt(snapshot, receipt);
      return { status: receipt.status, receipt, recovered: false };
    }

    const receipt = makeReceipt(snapshot, {
      status: "proven",
      replayExecutionId: result.executionId,
      replayAttempt: replayEpisode.attempt,
      replayEpisodeId: replayEpisode.id,
      replayAcceptanceId: replayProof.binding.acceptanceId,
      replayEffectBundleId: replayProof.binding.effectBundleId,
      replayCanonicalProofHash: replayProof.binding.sourceCanonicalProofHash,
      workspaceTreeHash,
    });
    await persistReceipt(snapshot, receipt);
    return { status: receipt.status, receipt, recovered: false };
  } catch (error) {
    if (error instanceof Error && error.message === "source_revision_mismatch") {
      const receipt = makeReceipt(snapshot, {
        status: "incomplete",
        incompleteReason: "source_revision_mismatch",
      });
      await persistReceipt(snapshot, receipt);
      return { status: receipt.status, receipt, recovered: false };
    }
    throw error;
  } finally {
    if (workspace) await workspace.cleanup().catch(() => undefined);
    await runtimeManager.stop(snapshot.definition.projectId).catch(() => undefined);
  }
}