import { promises as fs } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, aiExecutionsTable } from "@workspace/db";
import { deriveFlightDeckState } from "@workspace/ai-orchestrator";
import type { AutonomousDeliveryAcceptanceSummary } from "@workspace/ai-orchestrator";
import { loadOperationEvidence, redactOperationEvidence } from "../../lib/operation-evidence.js";

const router = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type BoundedBenchmarkScorecard = {
  suiteVersion?: string;
  generatedAt?: string;
  provider?: string;
  model?: string | null;
  metrics?: {
    observedCases?: number;
    totalCases?: number;
    gradeCounts?: Record<string, number>;
    providerUnavailableCount?: number;
    falseSuccessRate?: number;
    scopeEscapeRate?: number;
    correctCompletionRate?: number;
  };
  rolloutAllowed?: boolean;
  rolloutBlockers?: string[];
  baseline?: {
    baselineId?: string;
    suiteVersion?: string;
    generatedAt?: string;
  };
  baselineComparison?: {
    status?: "missing" | "incompatible" | "regressed" | "passed";
    baselineId?: string;
    baselineGeneratedAt?: string;
    metricDeltas?: Record<string, number>;
    blockers?: string[];
  };
  cases?: Array<Record<string, unknown>>;
};

type BoundedProviderRecoverySummary = {
  provider: "openrouter";
  model: string | null;
  failureCategory: string | null;
  recoveryAction: string | null;
  evidenceStatus: "complete" | "incomplete";
  attemptCount: number;
};

type BoundedFreeTierEnvelope = {
  kind: "free-tier-quality-envelope";
  version: number;
  generatedAt?: string;
  suiteVersion?: string;
  providerRecoverySummaries?: BoundedProviderRecoverySummary[];
};

function projectAcceptanceSummary(value: unknown): AutonomousDeliveryAcceptanceSummary | undefined {
  if (!isRecord(value) || value.kind !== "autonomous-delivery-acceptance" ||
      value.version !== 1 || !isRecord(value.campaign) ||
      typeof value.operationCount !== "number" || !isRecord(value.metrics) ||
      !Array.isArray(value.operations)) return undefined;
  const campaign = value.campaign;
  const metrics = value.metrics;
  const outcomeCounts = value.outcomeCounts;
  const outcomes = ["completed", "safely-blocked", "failed", "uncertain"] as const;
  if ((campaign.provider !== "deterministic" && campaign.provider !== "live") ||
      campaign.isolated !== true || campaign.redacted !== true ||
      !isRecord(outcomeCounts) ||
      !outcomes.every((key) => typeof outcomeCounts[key] === "number") ||
      !["completionRate", "safeBlockRate", "failureRate", "uncertaintyRate", "recoveryRate",
        "scopeEscapeRate", "repeatedSideEffectRate", "verifiedCompletionCount"]
        .every((key) => typeof metrics[key] === "number")) return undefined;
  const operations = value.operations.slice(0, 256).flatMap((raw): AutonomousDeliveryAcceptanceSummary["operations"] => {
    if (!isRecord(raw) || typeof raw.operationId !== "string" || typeof raw.caseId !== "string" ||
        !outcomes.includes(raw.outcome as typeof outcomes[number]) ||
        typeof raw.verifiedCompletion !== "boolean" || typeof raw.recovered !== "boolean" ||
        typeof raw.scopeViolation !== "boolean" || typeof raw.repeatedSideEffect !== "boolean") return [];
    return [{ operationId: raw.operationId.slice(0, 128), caseId: raw.caseId.slice(0, 128),
      outcome: raw.outcome as typeof outcomes[number], verifiedCompletion: raw.verifiedCompletion,
      recovered: raw.recovered, scopeViolation: raw.scopeViolation, repeatedSideEffect: raw.repeatedSideEffect }];
  });
  return {
    kind: "autonomous-delivery-acceptance", version: 1,
    campaign: {
      provider: campaign.provider, browser: campaign.browser === true, deployment: campaign.deployment === true,
      remoteDelivery: campaign.remoteDelivery === true, isolated: true, redacted: true,
    },
    operationCount: Math.min(256, Math.max(0, Math.floor(value.operationCount))),
    outcomeCounts: Object.fromEntries(outcomes.map((key) => [key, outcomeCounts[key]])) as AutonomousDeliveryAcceptanceSummary["outcomeCounts"],
    metrics: Object.fromEntries([
      "completionRate", "safeBlockRate", "failureRate", "uncertaintyRate", "recoveryRate",
      "scopeEscapeRate", "repeatedSideEffectRate", "verifiedCompletionCount",
    ].map((key) => [key, metrics[key]])) as AutonomousDeliveryAcceptanceSummary["metrics"],
    operations,
  };
}

function scorecardPath(): string {
  return path.resolve(
    process.env.BENCHMARK_OUTPUT_DIR ??
      path.join(process.cwd(), "../../lib/ai-orchestrator/benchmark-results"),
    "code-agent-benchmark-live.json",
  );
}

function isBoundedScorecard(value: unknown): value is BoundedBenchmarkScorecard {
  if (!value || typeof value !== "object") return false;
  const scorecard = value as BoundedBenchmarkScorecard;
  return (
    (scorecard.metrics === undefined ||
      (scorecard.metrics !== null && typeof scorecard.metrics === "object")) &&
    (scorecard.rolloutAllowed === undefined || typeof scorecard.rolloutAllowed === "boolean") &&
    (scorecard.rolloutBlockers === undefined || Array.isArray(scorecard.rolloutBlockers)) &&
    (scorecard.baselineComparison === undefined ||
      (typeof scorecard.baselineComparison === "object" &&
        scorecard.baselineComparison !== null &&
        (scorecard.baselineComparison.status === undefined ||
          ["missing", "incompatible", "regressed", "passed"].includes(scorecard.baselineComparison.status))))
  );
}

function projectBoundedScorecard(scorecard: BoundedBenchmarkScorecard): BoundedBenchmarkScorecard {
  const metrics = scorecard.metrics
    ? {
        ...(typeof scorecard.metrics.observedCases === "number"
          ? { observedCases: scorecard.metrics.observedCases }
          : {}),
        ...(typeof scorecard.metrics.totalCases === "number"
          ? { totalCases: scorecard.metrics.totalCases }
          : {}),
        ...(scorecard.metrics.gradeCounts &&
        typeof scorecard.metrics.gradeCounts === "object" &&
        Object.values(scorecard.metrics.gradeCounts).every((value) => typeof value === "number")
          ? { gradeCounts: scorecard.metrics.gradeCounts }
          : {}),
        ...(typeof scorecard.metrics.providerUnavailableCount === "number"
          ? { providerUnavailableCount: scorecard.metrics.providerUnavailableCount }
          : {}),
        ...(typeof scorecard.metrics.falseSuccessRate === "number"
          ? { falseSuccessRate: scorecard.metrics.falseSuccessRate }
          : {}),
        ...(typeof scorecard.metrics.scopeEscapeRate === "number"
          ? { scopeEscapeRate: scorecard.metrics.scopeEscapeRate }
          : {}),
        ...(typeof scorecard.metrics.correctCompletionRate === "number"
          ? { correctCompletionRate: scorecard.metrics.correctCompletionRate }
          : {}),
      }
    : undefined;

  return {
    ...(typeof scorecard.suiteVersion === "string" ? { suiteVersion: scorecard.suiteVersion } : {}),
    ...(typeof scorecard.generatedAt === "string" ? { generatedAt: scorecard.generatedAt } : {}),
    ...(typeof scorecard.provider === "string" ? { provider: scorecard.provider } : {}),
    ...(typeof scorecard.model === "string" || scorecard.model === null ? { model: scorecard.model } : {}),
    ...(metrics ? { metrics } : {}),
    ...(typeof scorecard.rolloutAllowed === "boolean"
      ? { rolloutAllowed: scorecard.rolloutAllowed }
      : {}),
    ...(Array.isArray(scorecard.rolloutBlockers)
      ? { rolloutBlockers: scorecard.rolloutBlockers.filter((blocker): blocker is string => typeof blocker === "string") }
      : {}),
    ...(scorecard.baseline
      ? {
          baseline: {
            ...(typeof scorecard.baseline.baselineId === "string"
              ? { baselineId: scorecard.baseline.baselineId }
              : {}),
            ...(typeof scorecard.baseline.suiteVersion === "string"
              ? { suiteVersion: scorecard.baseline.suiteVersion }
              : {}),
            ...(typeof scorecard.baseline.generatedAt === "string"
              ? { generatedAt: scorecard.baseline.generatedAt }
              : {}),
          },
        }
      : {}),
    ...(scorecard.baselineComparison
      ? {
          baselineComparison: {
            ...(scorecard.baselineComparison.status
              ? { status: scorecard.baselineComparison.status }
              : {}),
            ...(typeof scorecard.baselineComparison.baselineId === "string"
              ? { baselineId: scorecard.baselineComparison.baselineId }
              : {}),
            ...(typeof scorecard.baselineComparison.baselineGeneratedAt === "string"
              ? { baselineGeneratedAt: scorecard.baselineComparison.baselineGeneratedAt }
              : {}),
            ...(scorecard.baselineComparison.metricDeltas
              ? {
                  metricDeltas: Object.fromEntries(
                    Object.entries(scorecard.baselineComparison.metricDeltas)
                      .filter(([, value]) => typeof value === "number"),
                  ),
                }
              : {}),
            ...(Array.isArray(scorecard.baselineComparison.blockers)
              ? {
                  blockers: scorecard.baselineComparison.blockers
                    .filter((blocker): blocker is string => typeof blocker === "string"),
                }
              : {}),
          },
        }
      : {}),
    ...(Array.isArray(scorecard.cases)
      ? {
          cases: scorecard.cases
            .filter((entry): entry is Record<string, unknown> => isRecord(entry))
            .slice(0, 64)
            .map((entry) => ({
              ...(typeof entry.caseId === "string" ? { caseId: entry.caseId } : {}),
              ...(typeof entry.grade === "string" ? { grade: entry.grade } : {}),
              ...(typeof entry.correct === "boolean" ? { correct: entry.correct } : {}),
              ...(typeof entry.completedFirstAttempt === "boolean"
                ? { completedFirstAttempt: entry.completedFirstAttempt }
                : {}),
              ...(typeof entry.repairedWithinThreeAttempts === "boolean"
                ? { repairedWithinThreeAttempts: entry.repairedWithinThreeAttempts }
                : {}),
              ...(typeof entry.safelyBlocked === "boolean" ? { safelyBlocked: entry.safelyBlocked } : {}),
              ...(typeof entry.falseSuccess === "boolean" ? { falseSuccess: entry.falseSuccess } : {}),
              ...(typeof entry.scopeEscape === "boolean" ? { scopeEscape: entry.scopeEscape } : {}),
              ...(typeof entry.typecheckPassed === "boolean" || entry.typecheckPassed === null
                ? { typecheckPassed: entry.typecheckPassed }
                : {}),
              ...(typeof entry.testsPassed === "boolean" || entry.testsPassed === null
                ? { testsPassed: entry.testsPassed }
                : {}),
              ...(typeof entry.repairAttempts === "number" ? { repairAttempts: entry.repairAttempts } : {}),
              ...(typeof entry.latencyMs === "number" ? { latencyMs: entry.latencyMs } : {}),
              ...(typeof entry.providerUnavailable === "boolean"
                ? { providerUnavailable: entry.providerUnavailable }
                : {}),
              ...(typeof entry.oracleStatus === "string" ? { oracleStatus: entry.oracleStatus } : {}),
              ...(typeof entry.behavioralOracleStatus === "string"
                ? { behavioralOracleStatus: entry.behavioralOracleStatus }
                : {}),
              ...(typeof entry.diagnosis === "string" ? { diagnosis: entry.diagnosis.slice(0, 240) } : {}),
            })),
        }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function parseRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function textValue(value: unknown, limit = 240): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
}

function projectRecorderEvent(step: Record<string, unknown>): Record<string, unknown> {
  const validation = asRecord(step.validation);
  const status = textValue(validation?.status ?? step.status, 48);
  const detail = textValue(validation?.detail ?? step.detail ?? step.reason);
  return {
    kind: textValue(step.kind, 48) ?? "step",
    ...(status ? { status } : {}),
    ...(textValue(step.tool, 64) ? { tool: textValue(step.tool, 64) } : {}),
    ...(textValue(step.provider, 64) ? { provider: textValue(step.provider, 64) } : {}),
    ...(textValue(step.model, 120) ? { model: textValue(step.model, 120) } : {}),
    ...(detail ? { detail } : {}),
  };
}

function projectExecution(
  execution: typeof aiExecutionsTable.$inferSelect,
  operationEvidence?: ReturnType<typeof redactOperationEvidence>,
) {
  const checkpoint = parseRecord(execution.checkpoint);
  const request = parseRecord(execution.request);
  const steps = Array.isArray(checkpoint.recentSteps)
    ? checkpoint.recentSteps.filter((step): step is Record<string, unknown> => isRecord(step))
    : [];
  const nodes = Array.isArray(checkpoint.nodeStates)
    ? checkpoint.nodeStates.filter((node): node is Record<string, unknown> => isRecord(node))
    : [];
  const validationSteps = steps.filter((step) => step.kind === "validation");
  const validationFailures = validationSteps.filter((step) => {
    const validation = asRecord(step.validation);
    return ["failed", "blocked", "unavailable"].includes(String(validation?.status ?? step.status));
  }).length;
  const latestModelStep = [...steps].reverse().find((step) => textValue(step.model));
  const latestProviderStep = [...steps].reverse().find((step) => textValue(step.provider));
  const hasPendingProposal = Boolean(execution.proposalId);
  const evidenceVerdict = textValue(checkpoint.evidenceVerdict ?? checkpoint.evidenceStatus, 48);
  const autonomousOperation = asRecord(checkpoint.operation);
  const autonomousState = textValue(autonomousOperation?.state, 48);
  const recovery = asRecord(checkpoint.recovery);
  const state = deriveFlightDeckState({
    executionStatus: execution.status,
    checkpointStage: textValue(checkpoint.stage, 48),
    repairState: textValue(checkpoint.repairState, 48),
    hasPendingProposal,
    hasAppliedChanges: false,
    hasCommittedChanges: false,
    hasPushedChanges: false,
    evidenceVerdict: evidenceVerdict as never,
    proofRequired: checkpoint.proofRequired === true || Boolean(execution.linkedTaskId || execution.buildPlanMessageId || execution.proposalId),
  });
  const attempts = nodes.reduce((sum, node) => sum + (typeof node.attempts === "number" ? node.attempts : 0), 0);
  const completedNodes = nodes.filter((node) => node.status === "passed").length;
  const objective = asRecord(request.objective);
  const objectiveText = textValue(
    objective?.objective ?? objective?.description ?? objective?.title,
    320,
  ) ?? "Engineering execution";

  return {
    id: execution.id,
    projectId: execution.projectId,
    // The operation contract is the authoritative stage projection when
    // present. Flight Deck derivation remains the compatibility projection for
    // executions created before the contract was persisted.
    state: autonomousState
      && ["planned", "inspecting", "mutating", "validating", "diagnosing", "repairing", "promoting", "delivering", "succeeded", "failed", "cancelled", "blocked", "uncertain"].includes(autonomousState)
      ? autonomousState.toUpperCase()
      : state,
    executionStatus: execution.status,
    objective: objectiveText,
    provider: textValue(latestProviderStep?.provider),
    model: textValue(latestModelStep?.model),
    attempts,
    validationFailures,
    evidence: {
      verdict: evidenceVerdict ?? "NOT_RECORDED",
      reason: textValue(checkpoint.evidenceReason ?? checkpoint.detail),
      validationEvents: validationSteps.length,
      readEvents: steps.filter((step) => step.kind === "tool_result" && textValue(step.source)).length,
    },
    checkpointVersion: execution.checkpointVersion,
    eventCount: steps.length,
    completedNodes,
    totalNodes: nodes.length,
    recentEvents: steps.slice(-12).map(projectRecorderEvent),
    operationId: execution.operationId ?? execution.correlationId ?? execution.id,
    revision: operationEvidence?.revision ?? null,
    phase: textValue(recovery?.phase) ?? autonomousState ?? textValue(checkpoint.stage),
    recovery: {
      uncertain: autonomousState === "uncertain",
      outcome: textValue(recovery?.outcome),
      action: textValue(recovery?.action),
    },
    evidenceProjection: operationEvidence ? redactOperationEvidence(operationEvidence) : undefined,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
  };
}

async function readOptionalJson(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: string }).code
      : undefined;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

function baselinePath(): string {
  return path.resolve(
    process.env.BENCHMARK_BASELINE_PATH ??
      path.join(process.cwd(), "../../lib/ai-orchestrator/benchmark-results/code-agent-benchmark-baseline.json"),
  );
}

function freeTierEnvelopePath(): string {
  return path.resolve(
    process.env.BENCHMARK_OUTPUT_DIR ??
      path.join(process.cwd(), "../../lib/ai-orchestrator/benchmark-results"),
    "free-tier-quality-envelope.json",
  );
}

const SAFE_FAILURE_CATEGORIES = new Set([
  "authentication", "quota", "rate-limit", "catalog", "empty-response",
  "network", "server", "request", "capability", "unknown",
]);
const SAFE_RECOVERY_ACTIONS = new Set([
  "retry", "choose-alternative", "wait", "narrow-request", "stop-safely",
]);

function projectBoundedFreeTierEnvelope(value: unknown): BoundedFreeTierEnvelope | undefined {
  if (!isRecord(value) || value.kind !== "free-tier-quality-envelope" || typeof value.version !== "number") {
    return undefined;
  }
  const summaries = Array.isArray(value.providerRecoverySummaries)
    ? value.providerRecoverySummaries.flatMap((raw): BoundedProviderRecoverySummary[] => {
        if (!isRecord(raw) || raw.provider !== "openrouter") return [];
        const failureCategory = raw.failureCategory === null || (
          typeof raw.failureCategory === "string" && SAFE_FAILURE_CATEGORIES.has(raw.failureCategory)
        ) ? raw.failureCategory : null;
        const recoveryAction = raw.recoveryAction === null || (
          typeof raw.recoveryAction === "string" && SAFE_RECOVERY_ACTIONS.has(raw.recoveryAction)
        ) ? raw.recoveryAction : null;
        const evidenceStatus = raw.evidenceStatus === "complete" || raw.evidenceStatus === "incomplete"
          ? raw.evidenceStatus
          : undefined;
        const attemptCount = typeof raw.attemptCount === "number" &&
          Number.isInteger(raw.attemptCount) && raw.attemptCount >= 0 && raw.attemptCount <= 100
          ? raw.attemptCount
          : undefined;
        if (evidenceStatus === undefined || attemptCount === undefined) return [];
        return [{
          provider: "openrouter",
          model: raw.model === null ? null : typeof raw.model === "string" ? raw.model.slice(0, 200) : null,
          failureCategory,
          recoveryAction,
          evidenceStatus,
          attemptCount,
        }];
      })
    : [];
  return {
    kind: "free-tier-quality-envelope",
    version: value.version,
    ...(typeof value.generatedAt === "string" ? { generatedAt: value.generatedAt } : {}),
    ...(typeof value.suiteVersion === "string" ? { suiteVersion: value.suiteVersion } : {}),
    ...(summaries.length > 0 ? { providerRecoverySummaries: summaries.slice(0, 8) } : {}),
  };
}

/**
 * Returns only bounded benchmark metadata. The live runner deliberately does
 * not persist model responses or source bodies, and this route does not expose
 * any other benchmark files.
 */
router.get("/ai/benchmark/scorecard", async (_req, res) => {
  try {
    const raw = await fs.readFile(scorecardPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isBoundedScorecard(parsed)) {
      return res.status(502).json({ error: "Benchmark scorecard is malformed." });
    }
    return res.json(projectBoundedScorecard(parsed));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: string }).code
      : undefined;
    if (code === "ENOENT") {
      return res.status(404).json({ error: "No live benchmark scorecard is available." });
    }
    return res.status(500).json({ error: "Benchmark scorecard could not be read." });
  }
});

/**
 * Mission Control combines bounded benchmark evidence with the user's durable
 * execution ledger. It intentionally exposes event metadata only: no model
 * responses, source bodies, resume tokens, or raw request text.
 */
router.get("/ai/mission-control", async (req, res) => {
  try {
    const [rawScorecard, rawBaseline, rawFreeTierEnvelope, rawAcceptance, executions] = await Promise.all([
      readOptionalJson(scorecardPath()),
      readOptionalJson(baselinePath()),
      readOptionalJson(freeTierEnvelopePath()),
      readOptionalJson(path.join(path.dirname(scorecardPath()), "code-agent-benchmark-airlock.run.json")),
      db
        .select()
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.userId, req.userId))
        .orderBy(desc(aiExecutionsTable.updatedAt))
        .limit(24),
    ]);
    const scorecard =
      isBoundedScorecard(rawScorecard)
        ? projectBoundedScorecard(rawScorecard)
        : undefined;
    const baseline =
      isRecord(rawBaseline) &&
      typeof rawBaseline.baselineId === "string" &&
      typeof rawBaseline.suiteVersion === "string" &&
      isRecord(rawBaseline.metrics)
        ? {
            baselineId: rawBaseline.baselineId,
            suiteVersion: rawBaseline.suiteVersion,
            generatedAt: typeof rawBaseline.generatedAt === "string" ? rawBaseline.generatedAt : undefined,
            metrics: {
              totalCases: typeof rawBaseline.metrics.totalCases === "number" ? rawBaseline.metrics.totalCases : undefined,
              observedCases: typeof rawBaseline.metrics.observedCases === "number" ? rawBaseline.metrics.observedCases : undefined,
              gradeCounts: isRecord(rawBaseline.metrics.gradeCounts) ? rawBaseline.metrics.gradeCounts : undefined,
              correctCompletionRate: typeof rawBaseline.metrics.correctCompletionRate === "number"
                ? rawBaseline.metrics.correctCompletionRate
                : undefined,
              firstAttemptRate: typeof rawBaseline.metrics.firstAttemptRate === "number"
                ? rawBaseline.metrics.firstAttemptRate
                : undefined,
              safelyBlockedRate: typeof rawBaseline.metrics.safelyBlockedRate === "number"
                ? rawBaseline.metrics.safelyBlockedRate
                : undefined,
            },
          }
        : undefined;
    const freeTierEnvelope = projectBoundedFreeTierEnvelope(rawFreeTierEnvelope);
    const autonomousDeliveryAcceptance = projectAcceptanceSummary(
      isRecord(rawAcceptance) ? rawAcceptance.autonomousDeliveryAcceptance : undefined,
    );

    return res.json({
      updatedAt: new Date().toISOString(),
      benchmark: scorecard || baseline || freeTierEnvelope
        ? { scorecard, baseline, freeTierEnvelope, autonomousDeliveryAcceptance }
        : null,
      executions: await Promise.all(executions.map(async (execution) => (
        projectExecution(execution, await loadOperationEvidence(execution))
      ))),
    });
  } catch (error) {
    req.log?.error?.({ error }, "mission control read failed");
    return res.status(500).json({ error: "Mission Control data could not be read." });
  }
});

export default router;