/**
 * Child process used by the Mission restart-recovery integration test. It is
 * the "API worker": on startup it runs the production expired-lease recovery,
 * then the production dispatch reconciler with the bounded executor injected
 * through its `runGoal` seam, then the production outcome reconciler.
 *
 * It must be started with the runtime egress guard and a loopback-only
 * disposable DATABASE_URL (the parent test enforces both).
 */
import { reconcileAiExecutions } from "../lib/ai-execution-state.js";
import { reconcileStaleAiTasks } from "../lib/job-reconciliation.js";
import { reconcileApprovedMissionDecisionDispatches } from "../lib/mission-auto-replan.js";
import { reconcilePendingMissionPlanOutcomes } from "../lib/mission-strategy-plan-outcome-store.js";
import {
  createBoundedEffectExecutor,
  type BoundedEffectCrashPoint,
} from "./mission-bounded-effect-executor.js";

function emit(event: string, detail: Record<string, unknown> = {}): void {
  process.stdout.write(`BOUNDED_EFFECT:${JSON.stringify({ event, ...detail })}\n`);
}

async function assertNetworkBlocked(): Promise<void> {
  const guard = (globalThis as Record<symbol, unknown>)[
    Symbol.for("engineeringos.runtime-egress-guard")
  ] as { installed?: boolean } | undefined;
  if (guard?.installed !== true) throw new Error("egress_guard_not_installed");
  let blocked = false;
  try {
    await fetch("https://example.com/");
  } catch (error) {
    blocked = /egress blocked/u.test(String(error));
  }
  if (!blocked) throw new Error("egress_guard_did_not_block_external_fetch");
  emit("network_blocked");
}

async function main(): Promise<void> {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)) {
    throw new Error("bounded_effect_worker_requires_loopback_database");
  }
  await assertNetworkBlocked();
  const phase = process.env.BOUNDED_EFFECT_PHASE;
  const workerId = process.env.BOUNDED_EFFECT_WORKER_ID;
  const projectId = process.env.BOUNDED_EFFECT_PROJECT_ID;
  const crashPoint = (process.env.BOUNDED_EFFECT_CRASH_POINT ?? "none") as BoundedEffectCrashPoint;
  if (!workerId || !projectId || (phase !== "first" && phase !== "restart")) {
    throw new Error("bounded_effect_worker_configuration_invalid");
  }

  if (phase === "restart") {
    emit("expired_leases_reconciled", { count: await reconcileAiExecutions({ expiredOnly: true }) });
    emit("stale_tasks_reconciled", { count: await reconcileStaleAiTasks() });
  }
  const executor = createBoundedEffectExecutor({
    workerId,
    crashPoint,
    report: (step, detail) => emit(step, detail),
  });
  // The dispatch reconciler fails closed and logs only a code; keep the cause visible.
  const observedRunGoal: typeof executor.runGoal = async (input) => {
    try {
      return await executor.runGoal(input);
    } catch (error) {
      emit("executor_error", { message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  emit("dispatch_recorded", {
    count: await reconcileApprovedMissionDecisionDispatches(16, observedRunGoal as never),
  });
  // The scheduled execution runs after its dispatch is recorded, as in production.
  try {
    emit("executions_run", { count: await executor.executePending(projectId) });
  } catch (error) {
    emit("executor_error", { message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  if (phase === "restart") {
    emit("outcomes_reconciled", {
      count: await reconcilePendingMissionPlanOutcomes(16, projectId),
    });
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
