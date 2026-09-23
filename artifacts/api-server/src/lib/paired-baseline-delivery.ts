import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CODE_AGENT_BENCHMARK_VERSION,
  getCodeAgentBenchmarkCases,
  runPairedCodeAgentBenchmark,
  type CodeAgentBenchmarkCase,
  type PairedBaselineComparison,
  type PairedBaselineRunResult,
} from "@workspace/ai-orchestrator";
import { createValidationWorkspace, runRepairValidation } from "./ai-repair-validation.js";
import { hashDeliveryTree } from "./delivery-workspace.js";

const DELIVERY_PAIRED_CASE_IDS = {
  "workspace-typecheck": "single-file-001",
  "ai-orchestrator-tests": "test-failure-001",
} as const;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function boundedDuration(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

async function measureWorkspace(args: {
  workspaceRoot: string;
  approvedPaths: readonly string[];
  maxPaths: number;
  maxTotalBytes: number;
}): Promise<{ readCount: number; totalBytes: number }> {
  if (args.approvedPaths.length > args.maxPaths) {
    throw new Error("Gate 3 paired validation path budget was exceeded.");
  }
  const root = await fs.realpath(args.workspaceRoot);
  let totalBytes = 0;
  for (const relativePath of args.approvedPaths) {
    const normalized = relativePath.replaceAll("\\", "/");
    if (
      !normalized
      || normalized.startsWith("/")
      || path.isAbsolute(relativePath)
      || normalized.split("/").some((segment) => !segment || segment === "..")
    ) {
      throw new Error("Gate 3 paired validation received an unsafe path.");
    }
    const target = path.resolve(root, normalized);
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new Error("Gate 3 paired validation path escaped its workspace.");
    }
    let cursor = target;
    while (cursor !== root && cursor.startsWith(`${root}${path.sep}`)) {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink()) {
        throw new Error("Gate 3 paired validation refuses symlink traversal.");
      }
      cursor = path.dirname(cursor);
    }
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > args.maxTotalBytes || totalBytes + stat.size > args.maxTotalBytes) {
      throw new Error("Gate 3 paired validation byte budget was exceeded.");
    }
    totalBytes += stat.size;
  }
  return { readCount: args.approvedPaths.length, totalBytes };
}

function buildTelemetry(args: {
  expectedTerminal: "READY_FOR_REVIEW" | "BLOCKED";
  expectedValidation: "typecheck" | "tests" | "tests-and-typecheck" | "unavailable";
  workspaceHash: string;
  sourceRevision: string;
  approvedPaths: readonly string[];
  validationStatuses: readonly string[];
  durationMs: number;
  profileCount: number;
}) {
  const passed = args.validationStatuses.length > 0
    && args.validationStatuses.every((status) => status === "passed");
  const unavailable = args.validationStatuses.some((status) => status === "unavailable");
  const validationStatus = passed ? "passed" as const : unavailable ? "unavailable" as const : "failed" as const;
  const readyForReview = args.expectedTerminal === "READY_FOR_REVIEW" && passed;
  const typecheckRequired = args.expectedValidation === "typecheck"
    || args.expectedValidation === "tests-and-typecheck";
  const testsRequired = args.expectedValidation === "tests"
    || args.expectedValidation === "tests-and-typecheck";
  return {
    actualTerminal: readyForReview ? "READY_FOR_REVIEW" as const : "BLOCKED" as const,
    validationStatus,
    changedPaths: readyForReview ? [...args.approvedPaths] : [],
    allowedPaths: [...args.approvedPaths],
    filesRead: args.approvedPaths.length,
    toolCalls: args.profileCount,
    repairAttempts: 0,
    rejectedChanges: 0,
    conflict: false,
    typecheckPassed: typecheckRequired ? passed : null,
    testsPassed: testsRequired ? passed : null,
    candidateHash: args.workspaceHash,
    sourceRevision: args.sourceRevision,
    evidenceCoverage: passed ? 1 : 0,
    validatorOutcome: validationStatus,
    duplicateCalls: 0,
    unauthorizedCalls: 0,
    recoveryCount: 0,
    terminalOutcome: readyForReview ? "completed" as const : "blocked" as const,
    durationMs: args.durationMs,
    costUnits: args.profileCount,
  };
}

/**
 * Run the same server-owned validation objective against two disposable,
 * revision-bound workspaces. This is the delivery adapter for Gate 3; it does
 * not accept provider output or client-provided metrics.
 */
export async function runDeliveryPairedBaseline(args: {
  replayId: string;
  candidateId: string;
  sourceRevision: string;
  baselineSourceRoot: string;
  candidateWorkspaceRoot: string;
  projectId: string;
  missionId: string;
  goalId: string;
  planRevision: string;
  activePlanRevision: string;
  objective: string;
  approvedPaths: readonly string[];
  validationProfiles: readonly ("workspace-typecheck" | "ai-orchestrator-tests")[];
  maxPaths: number;
  maxTotalBytes: number;
  expectedBaselineWorkspaceHash?: string | null;
}): Promise<{
  result: PairedBaselineRunResult;
  cleanup: () => Promise<void>;
}> {
  const candidateWorkspaceHash = await hashDeliveryTree(args.candidateWorkspaceRoot);
  const baselineWorkspace = await createValidationWorkspace(
    args.baselineSourceRoot,
    [],
    async () => undefined,
  );
  const cleanup = async () => {
    await baselineWorkspace.cleanup();
  };

  try {
    const baselineWorkspaceHash = await hashDeliveryTree(baselineWorkspace.rootPath);
    if (
      args.expectedBaselineWorkspaceHash
      && baselineWorkspaceHash !== args.expectedBaselineWorkspaceHash
    ) {
      throw new Error("Gate 3 baseline workspace does not match the persisted base tree identity.");
    }
    const objectiveDigest = digest({
      projectId: args.projectId,
      objective: args.objective,
      candidateId: args.candidateId,
    });
    const scopeDigest = digest({
      projectId: args.projectId,
      missionId: args.missionId,
      goalId: args.goalId,
      planRevision: args.planRevision,
      activePlanRevision: args.activePlanRevision,
      approvedPaths: [...args.approvedPaths].sort(),
    });
    const budgetDigest = digest({
      maxPaths: args.maxPaths,
      maxTotalBytes: args.maxTotalBytes,
      validationProfiles: [...args.validationProfiles],
    });
    const pairedCases = args.validationProfiles.map((profile) => {
      const caseId = DELIVERY_PAIRED_CASE_IDS[profile];
      const testCase = getCodeAgentBenchmarkCases().find((candidate) => candidate.id === caseId);
      if (!testCase) throw new Error(`Gate 3 delivery paired case is not registered: ${caseId}`);
      return testCase;
    });
    if (pairedCases.length === 0) {
      throw new Error("Gate 3 delivery requires at least one registered validation profile.");
    }

    const execute = (workspaceRoot: string, workspaceHash: string) => async (
      testCase: CodeAgentBenchmarkCase,
    ) => {
      const startedAt = performance.now();
      await measureWorkspace({
        workspaceRoot,
        approvedPaths: args.approvedPaths,
        maxPaths: args.maxPaths,
        maxTotalBytes: args.maxTotalBytes,
      });
      const statuses: string[] = [];
      for (const profile of args.validationProfiles) {
        const validation = await runRepairValidation(
          workspaceRoot,
          profile,
          [...args.approvedPaths],
          undefined,
          [],
        );
        statuses.push(validation.status);
      }
      return buildTelemetry({
        workspaceHash,
        sourceRevision: args.sourceRevision,
        approvedPaths: args.approvedPaths,
        validationStatuses: statuses,
        expectedTerminal: testCase.expected.terminal,
        expectedValidation: testCase.expected.validation,
        durationMs: boundedDuration(startedAt),
        profileCount: args.validationProfiles.length,
      });
    };

    const contract = {
      kind: "code-agent-benchmark-paired-contract" as const,
      version: 1 as const,
      pairId: `shadow-replay-pair:${args.replayId}`,
      suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
      sourceRevision: args.sourceRevision,
      objectiveDigest,
      scopeDigest,
      budgetDigest,
      baselineRunId: `${args.replayId}:baseline`,
      candidateRunId: `${args.replayId}:candidate`,
      baselineWorkspaceHash,
      candidateWorkspaceHash,
      candidateId: args.candidateId,
    };

    const result = await runPairedCodeAgentBenchmark({
      contract,
      cases: pairedCases,
      baseline: {
        runId: contract.baselineRunId,
        workspaceHash: baselineWorkspaceHash,
        sourceRevision: args.sourceRevision,
        objectiveDigest,
        scopeDigest,
        budgetDigest,
        executeCase: execute(baselineWorkspace.rootPath, baselineWorkspaceHash),
      },
      candidate: {
        runId: contract.candidateRunId,
        workspaceHash: candidateWorkspaceHash,
        sourceRevision: args.sourceRevision,
        objectiveDigest,
        scopeDigest,
        budgetDigest,
        executeCase: execute(args.candidateWorkspaceRoot, candidateWorkspaceHash),
      },
    });
    return { result, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export type DeliveryPairedBaselineComparison = PairedBaselineComparison;