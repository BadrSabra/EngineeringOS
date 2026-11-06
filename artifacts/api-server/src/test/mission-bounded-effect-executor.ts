/**
 * Test-only bounded executor for Mission restart-recovery proofs.
 *
 * It stands in for `runMissionGoal` through the existing `runGoal` seam of
 * `reconcileApprovedMissionDecisionDispatches`. Its only side effect is a
 * reversible marker file inside a synthetic workspace under `.test-roots`.
 * Everything that proves the effect (execution, episode, before/after
 * observations, effect bundle, acceptance, linked task/goal projection) goes
 * through the production modules; only the mutation itself is test-owned.
 */
import { appendFile, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentObservationsTable,
  aiExecutionsTable,
  aiGoalsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import type { AgentAction, EffectContract } from "@workspace/ai-orchestrator";
import { appendEpisodeEvent, startEpisode } from "../lib/agent-state/agent-episode-ledger.js";
import { verifyAndPersistEffect } from "../lib/agent-state/effect-observer.js";
import { getProjectWorldState } from "../lib/agent-state/world-state.js";
import { materializeServerOwnedObservations } from "../lib/agent-state/observation-materializer.js";
import { finalizeExecutionAcceptance } from "../lib/ai-execution-acceptance.js";
import { claimAiExecution, createAiExecution } from "../lib/ai-execution-state.js";
import type { MissionGoalRunResult } from "../lib/mission-runtime.js";

export const BOUNDED_EFFECT_DIRECTORY = "synthetic-effect";
export const BOUNDED_EFFECT_MARKER_PATH = `${BOUNDED_EFFECT_DIRECTORY}/marker.json`;
export const BOUNDED_EFFECT_SOURCE_REVISION = "bounded-effect-source-revision";
export const BOUNDED_EFFECT_CODE = "synthetic-marker.state";
const BOUNDED_EFFECT_SUBJECT = "synthetic-marker";
const BOUNDED_EFFECT_PREDICATE = "state";
const BOUNDED_EFFECT_CAPABILITY = "synthetic.marker-toggle";
const BOUNDED_EFFECT_ID = "synthetic.marker-toggle.observed";

export type BoundedEffectCrashPoint =
  | "none"
  | "after_before_observation"
  | "after_mutation"
  | "after_effect_record";

export type SyntheticMarker = {
  state: "off" | "on";
  appliedBy: string | null;
  /** Number of physical mutations; it is carried by the same atomic write as the state. */
  applications: number;
  reversals: number;
};

function syntheticRootBase(): string {
  return path.resolve(process.cwd(), "../../.test-roots");
}

/** The executor may touch only a real directory below the repository `.test-roots`. */
export async function assertSyntheticRoot(rootPath: string): Promise<string> {
  const resolved = await realpath(rootPath);
  const base = await realpath(syntheticRootBase());
  if (!resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error("bounded_effect_root_outside_synthetic_workspace");
  }
  return resolved;
}

export async function seedSyntheticMarker(rootPath: string): Promise<void> {
  const root = await assertSyntheticRoot(rootPath);
  await mkdir(path.join(root, BOUNDED_EFFECT_DIRECTORY), { recursive: true });
  await writeMarker(root, { state: "off", appliedBy: null, applications: 0, reversals: 0 });
}

export async function readSyntheticMarker(rootPath: string): Promise<SyntheticMarker> {
  const root = await assertSyntheticRoot(rootPath);
  const parsed = JSON.parse(await readFile(path.join(root, BOUNDED_EFFECT_MARKER_PATH), "utf8")) as
    Partial<SyntheticMarker>;
  if (
    (parsed.state !== "off" && parsed.state !== "on")
    || !Number.isSafeInteger(parsed.applications)
    || !Number.isSafeInteger(parsed.reversals)
  ) {
    throw new Error("bounded_effect_marker_invalid");
  }
  return {
    state: parsed.state,
    appliedBy: typeof parsed.appliedBy === "string" ? parsed.appliedBy : null,
    applications: parsed.applications as number,
    reversals: parsed.reversals as number,
  };
}

async function writeMarker(root: string, marker: SyntheticMarker): Promise<void> {
  const target = path.join(root, BOUNDED_EFFECT_MARKER_PATH);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(marker)}\n`, "utf8");
  await rename(temporary, target);
}

/**
 * Idempotent per action key: a marker already applied by the same key is left
 * untouched, so a replay cannot mutate (or count) a second time.
 */
export async function applySyntheticMarker(
  rootPath: string,
  actionKey: string,
): Promise<"applied" | "already_applied"> {
  const root = await assertSyntheticRoot(rootPath);
  const current = await readSyntheticMarker(root);
  if (current.state === "on") {
    if (current.appliedBy === actionKey) return "already_applied";
    throw new Error("bounded_effect_marker_owned_by_another_action");
  }
  await writeMarker(root, {
    state: "on",
    appliedBy: actionKey,
    applications: current.applications + 1,
    reversals: current.reversals,
  });
  await appendFile(
    path.join(root, BOUNDED_EFFECT_DIRECTORY, "journal.log"),
    `apply:${actionKey}\n`,
    "utf8",
  );
  return "applied";
}

/** The marker is reversible: this restores the initial state for the same action only. */
export async function reverseSyntheticMarker(rootPath: string, actionKey: string): Promise<void> {
  const root = await assertSyntheticRoot(rootPath);
  const current = await readSyntheticMarker(root);
  if (current.state !== "on" || current.appliedBy !== actionKey) {
    throw new Error("bounded_effect_marker_not_applied_by_action");
  }
  await writeMarker(root, {
    state: "off",
    appliedBy: null,
    applications: current.applications,
    reversals: current.reversals + 1,
  });
}

export function boundedEffectActionKey(executionId: string, attempt: number): string {
  return `bounded-effect:${executionId}:${attempt}`;
}

function buildAction(input: {
  actionId: string;
  episodeId: string;
  projectId: string;
  operationId: string;
}): AgentAction {
  return {
    schemaVersion: "1",
    actionId: input.actionId,
    episodeId: input.episodeId,
    capabilityId: BOUNDED_EFFECT_CAPABILITY,
    intent: "Toggle a reversible marker inside a synthetic test workspace.",
    triggerConditions: [{ kind: "server_route", route: "test.bounded-effect" }],
    scope: {
      projectId: input.projectId,
      operationId: input.operationId,
      marker: BOUNDED_EFFECT_MARKER_PATH,
    },
    preconditions: ["The marker lives under the repository synthetic workspace root."],
    expectedEffects: [BOUNDED_EFFECT_ID],
    authorization: { source: "server", capability: BOUNDED_EFFECT_CAPABILITY },
    risk: "LOW",
    idempotencyKey: input.actionId,
    observationProfile: "WORKSPACE",
    failureSemantics: [
      "A missing or stale after observation cannot produce PROVEN.",
      "A marker applied by another action stops the executor.",
    ],
  };
}

function buildEffectContract(beforeRef: string, afterRef: string): EffectContract {
  return {
    schemaVersion: "1",
    effectId: BOUNDED_EFFECT_ID,
    expectedStateChanges: [{
      subject: BOUNDED_EFFECT_SUBJECT,
      predicate: BOUNDED_EFFECT_PREDICATE,
      expectedValue: { state: "on" },
    }],
    observationProfile: "WORKSPACE",
    requiredEvidence: [beforeRef, afterRef],
    allowedResult: "OBSERVED",
  };
}

export type BoundedEffectExecutorOptions = {
  workerId: string;
  crashPoint: BoundedEffectCrashPoint;
  /** Called with a plain step name for process-level assertions. */
  report?: (step: string, detail?: Record<string, unknown>) => void;
  /** Test control: a hard process death without cleanup. */
  die?: () => never;
};

async function findObservationId(
  executionId: string,
  episodeId: string,
  sourceId: string,
): Promise<string | undefined> {
  const [row] = await db.select({ id: aiAgentObservationsTable.id })
    .from(aiAgentObservationsTable)
    .where(and(
      eq(aiAgentObservationsTable.executionId, executionId),
      eq(aiAgentObservationsTable.episodeId, episodeId),
      eq(aiAgentObservationsTable.sourceId, sourceId),
    ))
    .limit(1);
  return row?.id;
}

export function createBoundedEffectExecutor(options: BoundedEffectExecutorOptions) {
  const report = options.report ?? (() => undefined);
  const crashAt = (point: BoundedEffectCrashPoint) => {
    if (options.crashPoint !== point) return;
    report("crash", { point });
    (options.die ?? (() => process.kill(process.pid, "SIGKILL") as never))();
  };

  /**
   * Stands in for `runMissionGoal`: like the production runner it only creates
   * (idempotently) the durable execution and reports it as scheduled; the work
   * happens later, in `executeScheduled`, so a crash there follows the recorded
   * dispatch exactly as it would for a real asynchronous execution.
   */
  const runGoal = async (input: {
    goalId: string;
    userId: string;
    trigger?: string;
  }): Promise<MissionGoalRunResult> => {
    const [goal] = await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.id, input.goalId));
    if (!goal) throw new Error("bounded_effect_goal_missing");
    const [project] = await db.select().from(projectsTable)
      .where(eq(projectsTable.id, goal.projectId));
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.goalId, goal.id));
    if (!project || !task?.correlationId) throw new Error("bounded_effect_binding_missing");
    const root = await assertSyntheticRoot(project.rootPath);
    const operationId = `bounded-effect-operation:${goal.id}`;

    const { execution: created } = await createAiExecution({
      userId: input.userId,
      projectId: project.id,
      goalId: goal.id,
      linkedTaskId: task.id,
      correlationId: task.correlationId,
      idempotencyKey: `bounded-effect:${goal.id}`,
      workspaceRoot: root,
      request: {
        projectId: project.id,
        operationId,
        message: "Toggle the synthetic marker once.",
        modelMessage: "Toggle the synthetic marker once.",
        linkedTaskId: task.id,
        validationTargetPaths: [],
        workspaceRevision: BOUNDED_EFFECT_SOURCE_REVISION,
        workspaceRoot: root,
        proofRequired: true,
        effectRequired: true,
      },
    });
    report("execution_scheduled", { executionId: created.id, status: created.status });
    return {
      status: created.status === "completed" ? "completed" : "scheduled",
      goalId: goal.id,
      taskId: task.id,
      executionId: created.id,
    };
  };

  /** Resume-or-start every queued/paused bounded execution of a project. */
  const executePending = async (projectId: string): Promise<number> => {
    const pending = await db.select({ id: aiExecutionsTable.id, status: aiExecutionsTable.status })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.projectId, projectId),
        inArray(aiExecutionsTable.status, ["queued", "paused"]),
      ));
    let executed = 0;
    for (const { id } of pending) {
      await executeScheduled(id);
      executed++;
    }
    return executed;
  };

  const executeScheduled = async (scheduledExecutionId: string): Promise<void> => {
    const [created] = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, scheduledExecutionId));
    if (!created?.goalId || !created.linkedTaskId) throw new Error("bounded_effect_execution_unbound");
    if (!created.idempotencyKey.startsWith("bounded-effect:")) return;
    const [goal] = await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.id, created.goalId));
    const [project] = await db.select().from(projectsTable)
      .where(eq(projectsTable.id, created.projectId));
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, created.linkedTaskId));
    if (!goal || !project || !task?.correlationId) throw new Error("bounded_effect_binding_missing");
    const root = await assertSyntheticRoot(project.rootPath);
    const operationId = `bounded-effect-operation:${goal.id}`;
    const input = { userId: created.userId };
    report("execution", { executionId: created.id, status: created.status });

    const claimed = await claimAiExecution({
      executionId: created.id,
      userId: input.userId,
      workerId: options.workerId,
      linkedTaskId: task.id,
    });
    if (!claimed) throw new Error("bounded_effect_claim_rejected");
    const executionId = claimed.id;
    const attempt = claimed.attempt;
    const workerId = options.workerId;
    const actionKey = boundedEffectActionKey(executionId, attempt);
    report("claimed", { executionId, attempt });

    // Mirror the production task lease: finalization requires the running task owner.
    await db.update(tasksTable).set({
      status: "running",
      workerId,
      leaseUntil: claimed.leaseUntil,
      updatedAt: new Date(),
    }).where(eq(tasksTable.id, task.id));

    const world = await getProjectWorldState(project.id);
    const episode = await startEpisode({
      projectId: project.id,
      worldRevision: world.worldRevision,
      executionId,
      attempt,
      workerId,
      idempotencyKey: `${executionId}:episode:${attempt}`,
      projectRevision: BOUNDED_EFFECT_SOURCE_REVISION,
      intentKind: "TASK_EXECUTION",
      scope: { kind: "mission-task", taskId: task.id, missionId: goal.missionId, goalId: goal.id },
      missionId: goal.missionId,
      goalId: goal.id,
    });
    const episodeId = episode.episodeId;
    const action = buildAction({ actionId: actionKey, episodeId, projectId: project.id, operationId });

    const priorRequests = await db.select({ payload: aiAgentEpisodeEventsTable.payload })
      .from(aiAgentEpisodeEventsTable)
      .where(and(
        eq(aiAgentEpisodeEventsTable.episodeId, episodeId),
        eq(aiAgentEpisodeEventsTable.eventType, "ACTION_REQUESTED"),
      ));
    const alreadyRequested = priorRequests.some((event) =>
      (event.payload as { action?: { actionId?: string } } | null)?.action?.actionId === actionKey);
    if (!alreadyRequested) {
      await appendEpisodeEvent({
        episodeId,
        projectId: project.id,
        executionId,
        attempt,
        workerId,
        eventType: "ACTION_REQUESTED",
        payload: { action, expectedEffects: action.expectedEffects },
        actorType: "worker",
        actorId: workerId,
        correlationId: task.correlationId,
      });
    }

    // The before observation is recorded once; a recovered worker reuses it.
    const beforeSourceId = `${actionKey}:before`;
    let beforeObservationId = await findObservationId(executionId, episodeId, beforeSourceId);
    if (!beforeObservationId) {
      const marker = await readSyntheticMarker(root);
      if (marker.state !== "off") throw new Error("bounded_effect_before_state_not_initial");
      const before = await materializeServerOwnedObservations({
        projectId: project.id,
        executionId,
        attempt,
        episodeId,
        projectRevision: BOUNDED_EFFECT_SOURCE_REVISION,
        materializeWorldState: false,
        workerLease: { workerId },
        sources: [{
          kind: "direct_observation",
          sourceId: beforeSourceId,
          subject: BOUNDED_EFFECT_SUBJECT,
          predicate: BOUNDED_EFFECT_PREDICATE,
          observationRole: "before",
          value: { state: marker.state },
          sourceRevision: BOUNDED_EFFECT_SOURCE_REVISION,
          observedAt: new Date(),
        }],
      });
      beforeObservationId = before.observationIds[0];
      if (!beforeObservationId || before.stale > 0) {
        throw new Error("bounded_effect_before_observation_unavailable");
      }
      report("before_observed", { observationId: beforeObservationId });
    } else {
      report("before_reused", { observationId: beforeObservationId });
    }
    crashAt("after_before_observation");

    const mutation = await applySyntheticMarker(root, actionKey);
    report("mutation", { result: mutation });
    crashAt("after_mutation");

    const afterSourceId = `${actionKey}:after`;
    let afterObservationId = await findObservationId(executionId, episodeId, afterSourceId);
    const finalMarker = await readSyntheticMarker(root);
    if (!afterObservationId) {
      const after = await materializeServerOwnedObservations({
        projectId: project.id,
        executionId,
        attempt,
        episodeId,
        projectRevision: BOUNDED_EFFECT_SOURCE_REVISION,
        materializeWorldState: false,
        workerLease: { workerId },
        sources: [{
          kind: "direct_observation",
          sourceId: afterSourceId,
          subject: BOUNDED_EFFECT_SUBJECT,
          predicate: BOUNDED_EFFECT_PREDICATE,
          observationRole: "after",
          value: { state: finalMarker.state },
          sourceRevision: BOUNDED_EFFECT_SOURCE_REVISION,
          observedAt: new Date(),
        }],
      });
      afterObservationId = after.observationIds[0];
      if (!afterObservationId || after.stale > 0) {
        throw new Error("bounded_effect_after_observation_unavailable");
      }
    }

    const verification = await verifyAndPersistEffect({
      projectId: project.id,
      executionId,
      attempt,
      episodeId,
      workerId,
      action,
      effectContract: buildEffectContract(beforeObservationId, afterObservationId),
      beforeObservationIds: [beforeObservationId],
      afterObservationIds: [afterObservationId],
    });
    report("effect_recorded", { status: verification.status, bundle: verification.effectBundleId });
    crashAt("after_effect_record");

    const accepted = await finalizeExecutionAcceptance({
      executionId,
      expectedAttempt: attempt,
      workerId,
      finalizationKey: `${actionKey}:final`,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      reasonCode: "proof_complete",
      recoveryState: "NONE",
      workspaceRoot: root,
      sourceRevision: BOUNDED_EFFECT_SOURCE_REVISION,
      effectRequired: true,
      effectBundleId: verification.effectBundleId,
      evidence: {
        required: true,
        sourceEvidenceRequired: true,
        operationId,
        workspaceRoot: root,
        sourceRevision: BOUNDED_EFFECT_SOURCE_REVISION,
        // The verdict derives from the server-classified effect, never from the executor's claim.
        verdict: verification.status === "observed" ? "PROVEN" : "INCOMPLETE",
        reads: [{
          path: BOUNDED_EFFECT_MARKER_PATH,
          body: `${JSON.stringify({ state: finalMarker.state })}\n`,
        }],
      },
      taskFinalization: {
        taskId: task.id,
        workerId,
        status: "completed",
        agentResponse: "Synthetic marker toggled exactly once.",
        completedAt: new Date(),
      },
    });
    if (!accepted.accepted) {
      throw new Error(`bounded_effect_acceptance_rejected:${accepted.reason ?? "unknown"}`);
    }
    report("accepted", { duplicate: accepted.duplicate });

  };

  return { runGoal, executeScheduled, executePending };
}
