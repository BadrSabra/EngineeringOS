import { describe, expect, it } from "vitest";
import {
  AGENT_STATE_SCHEMA_VERSION,
} from "./contract-utils.js";
import {
  CODE_AGENT_BENCHMARK_VERSION,
  buildCodeAgentBenchmarkScorecard,
  getCodeAgentBenchmarkCases,
  type CodeAgentBenchmarkObservation,
} from "../benchmark/code-agent-benchmark.js";
import {
  comparePairedBaseline,
  type PairedBaselineRun,
  type PairedBaselineRunResult,
} from "../benchmark/paired-baseline.js";
import {
  strategyStatusAfterAcceptedSupport,
  type StrategyCandidate,
} from "./strategy-contract.js";
import {
  analyzeStrategyReplayEvidence,
  hashStrategyReplayCaseManifest,
  type AnalyzeStrategyReplayEvidenceInput,
  type StrategyReplayCaseProofBinding,
  type StrategyReplayCorpusRun,
} from "./strategy-replay.js";

const sourceRevision = "a".repeat(40);
const cases = getCodeAgentBenchmarkCases();

function strategyCandidate(
  overrides: Partial<StrategyCandidate> = {},
): StrategyCandidate {
  return {
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    candidateId: "strategy-candidate:replay-test",
    triggerConditions: [{ kind: "recipe-trigger", recipeId: "recipe:observe" }],
    preconditions: [{ kind: "workspace-open" }],
    recommendedActionOrder: ["recipe:observe"],
    expectedEffects: ["observation-recorded"],
    supportingEpisodeIds: ["episode:accepted-1", "episode:accepted-2"],
    contradictingEpisodeIds: [],
    applicableScopes: ["project-read-only"],
    confidence: 0,
    evaluationStatus: "discovered",
    ...overrides,
  };
}

function observation(
  caseId: string,
  candidateHash: string,
  overrides: Partial<CodeAgentBenchmarkObservation> = {},
): CodeAgentBenchmarkObservation {
  return {
    caseId,
    candidateHash,
    sourceRevision,
    grade: "A",
    correct: true,
    completedFirstAttempt: true,
    repairedWithinThreeAttempts: false,
    usefulButIncomplete: false,
    safelyBlocked: false,
    falseSuccess: false,
    scopeEscape: false,
    conflict: false,
    typecheckPassed: true,
    testsPassed: true,
    filesRead: 1,
    toolCalls: 2,
    repairAttempts: 1,
    rejectedChanges: 0,
    evidenceCoverage: 1,
    validatorOutcome: "passed",
    duplicateCalls: 0,
    unauthorizedCalls: 0,
    recoveryCount: 1,
    terminalOutcome: "completed",
    durationMs: 100,
    costUnits: 10,
    ...overrides,
  };
}

function pairedRun(args: {
  pairId: string;
  candidateId: string;
  revision: string;
  caseIds: readonly string[];
  baselineCorrect?: boolean;
  candidateCorrect?: boolean;
  candidateCost?: number;
  candidateRepairAttempts?: number;
}): PairedBaselineRunResult {
  const baselineWorkspaceHash = "b".repeat(64);
  const candidateWorkspaceHash = "c".repeat(64);
  const baselineHash = "d".repeat(64);
  const candidateHash = "e".repeat(64);
  const selectedCases = cases.filter((testCase) => args.caseIds.includes(testCase.id));
  const baselineObservations = args.caseIds.map((caseId) =>
    observation(caseId, baselineHash, {
      sourceRevision: args.revision,
      correct: args.baselineCorrect ?? true,
    }),
  );
  const candidateObservations = args.caseIds.map((caseId) =>
    observation(caseId, candidateHash, {
      sourceRevision: args.revision,
      correct: args.candidateCorrect ?? true,
      costUnits: args.candidateCost ?? 8,
      repairAttempts: args.candidateRepairAttempts ?? 0,
      recoveryCount: 0,
    }),
  );
  const baseline: PairedBaselineRun = {
    runId: `${args.pairId}:baseline`,
    workspaceHash: baselineWorkspaceHash,
    sourceRevision: args.revision,
    objectiveDigest: "objective-digest",
    scopeDigest: "scope-digest",
    budgetDigest: "budget-digest",
    scorecard: buildCodeAgentBenchmarkScorecard({
      results: baselineObservations,
      cases: selectedCases,
    }),
    observations: baselineObservations,
  };
  const candidate: PairedBaselineRun = {
    runId: `${args.pairId}:candidate`,
    workspaceHash: candidateWorkspaceHash,
    sourceRevision: args.revision,
    objectiveDigest: "objective-digest",
    scopeDigest: "scope-digest",
    budgetDigest: "budget-digest",
    scorecard: buildCodeAgentBenchmarkScorecard({
      results: candidateObservations,
      cases: selectedCases,
    }),
    observations: candidateObservations,
  };
  const contract = {
    kind: "code-agent-benchmark-paired-contract" as const,
    version: 1 as const,
    pairId: args.pairId,
    suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
    sourceRevision: args.revision,
    objectiveDigest: "objective-digest",
    scopeDigest: "scope-digest",
    budgetDigest: "budget-digest",
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    baselineWorkspaceHash,
    candidateWorkspaceHash,
    candidateId: args.candidateId,
  };
  return {
    baseline,
    candidate,
    comparison: comparePairedBaseline({ contract, baseline, candidate }),
  };
}

function corpus(args: {
  corpusId: string;
  projectId: string;
  revision: string;
  caseIds: readonly string[];
  candidateId: string;
}): StrategyReplayCorpusRun {
  const pairedRun = pairedRunForCorpus(args);
  const caseProofBindings = args.caseIds.map((caseId, index) => ({
    caseId,
    projectId: args.projectId,
    sourceRevision: args.revision,
    sourceEpisodeId: `source-episode:${args.corpusId}:${caseId}`,
    executionId: `source-execution:${args.corpusId}:${caseId}`,
    attempt: 0,
    acceptanceId: `acceptance:${args.corpusId}:${caseId}`,
    effectBundleId: `effect-bundle:${args.corpusId}:${caseId}`,
      sourceCanonicalProofHash: (index + 1).toString(16).padStart(64, "0"),
  } satisfies StrategyReplayCaseProofBinding));
  const sourceEpisodeIds = caseProofBindings.map((binding) => binding.sourceEpisodeId);
  return {
    corpusId: args.corpusId,
    projectId: args.projectId,
    sourceRevision: args.revision,
    caseManifestHash: hashStrategyReplayCaseManifest({
      corpusId: args.corpusId,
      projectId: args.projectId,
      sourceRevision: args.revision,
      suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
      caseIds: [...args.caseIds].sort(),
      sourceEpisodeIds,
      caseProofBindings,
    }),
    sourceEpisodeIds,
    caseProofBindings,
    pairedRun,
  };
}

function pairedRunForCorpus(args: {
  corpusId: string;
  projectId: string;
  revision: string;
  caseIds: readonly string[];
  candidateId: string;
}): PairedBaselineRunResult {
  return pairedRun({
    pairId: `pair:${args.corpusId}`,
    candidateId: args.candidateId,
    revision: args.revision,
    caseIds: args.caseIds,
  });
}

function completeEvidence(): AnalyzeStrategyReplayEvidenceInput {
  const candidate = strategyCandidate();
  const allCaseIds = cases.map((testCase) => testCase.id);
  const current = corpus({
    corpusId: "current:project-a",
    projectId: "project-a",
    revision: sourceRevision,
    caseIds: allCaseIds.slice(0, 1),
    candidateId: candidate.candidateId,
  });
  const heldOut = corpus({
    corpusId: "heldout:project-a",
    projectId: "project-a",
    revision: sourceRevision,
    caseIds: allCaseIds.slice(1, 31),
    candidateId: candidate.candidateId,
  });
  const crossProjectFixtures = ["project-b", "project-c", "project-d"].map(
    (projectId, index) =>
      corpus({
        corpusId: `transfer:${projectId}`,
        projectId,
        revision: String(index + 1).repeat(40),
        caseIds: [allCaseIds[31 + index]!],
        candidateId: candidate.candidateId,
      }),
  );
  return {
    candidate,
    trainingProjectId: "project-a",
    trainingSourceRevision: sourceRevision,
    current,
    heldOut,
    crossProjectFixtures,
    confidenceCalibrationEce: 0.1,
  };
}

describe("strategy replay evidence analysis", () => {
  it("queues only two distinct accepted supports and preserves later lifecycle states", () => {
    expect(strategyStatusAfterAcceptedSupport("discovered", ["episode:one"]))
      .toBe("discovered");
    expect(strategyStatusAfterAcceptedSupport("discovered", ["episode:one", "episode:one"]))
      .toBe("discovered");
    expect(strategyStatusAfterAcceptedSupport("discovered", ["episode:one", "episode:two"]))
      .toBe("pending_replay");
    expect(strategyStatusAfterAcceptedSupport("replay_failed", ["episode:one", "episode:two"]))
      .toBe("replay_failed");
  });

  it("measures only disjoint paired corpora and never advances candidate status", () => {
    const input = completeEvidence();
    const analysis = analyzeStrategyReplayEvidence(input);

    expect(analysis.readiness).toBe("meets_measured_thresholds");
    expect(analysis.authoritative).toBe(false);
    expect(analysis.candidateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(analysis.metrics).toMatchObject({
      currentCases: 1,
      heldOutCases: 30,
      transferFixtures: 3,
      heldOutCostReduction: 0.2,
      confidenceCalibrationEce: 0.1,
    });
    expect(input.candidate.evaluationStatus).toBe("discovered");
    expect(analysis).not.toHaveProperty("nextEvaluationStatus");
  });

  it("stays incomplete when independent corpus thresholds or calibration are missing", () => {
    const input = completeEvidence();
    input.heldOut = corpus({
      corpusId: "heldout:too-small",
      projectId: "project-a",
      revision: sourceRevision,
      caseIds: cases.slice(1, 10).map((testCase) => testCase.id),
      candidateId: input.candidate.candidateId,
    });
    input.crossProjectFixtures = input.crossProjectFixtures!.slice(0, 2);
    input.confidenceCalibrationEce = null;

    const analysis = analyzeStrategyReplayEvidence(input);

    expect(analysis.readiness).toBe("incomplete");
    expect(analysis.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "insufficient_held_out_cases",
        "insufficient_transfer_fixtures",
        "calibration_missing",
      ]),
    );
  });

  it("rejects training-episode leakage", () => {
    const input = completeEvidence();
    const changedBindings = [...input.heldOut!.caseProofBindings];
    changedBindings[0] = {
      ...changedBindings[0]!,
      sourceEpisodeId: "episode:accepted-1",
    };
    input.heldOut = {
      ...input.heldOut!,
      sourceEpisodeIds: changedBindings.map((binding) => binding.sourceEpisodeId),
      caseProofBindings: changedBindings,
    };

    const analysis = analyzeStrategyReplayEvidence(input);

    expect(analysis.readiness).toBe("incomplete");
    expect(analysis.blockers.map((blocker) => blocker.code)).toContain(
      "training_episode_leakage",
    );
  });

  it("requires a proof binding for every paired case and hashes the binding", () => {
    const missingBinding = completeEvidence();
    missingBinding.heldOut = {
      ...missingBinding.heldOut!,
      caseProofBindings: missingBinding.heldOut!.caseProofBindings.slice(1),
    };
    const missingBindingAnalysis = analyzeStrategyReplayEvidence(missingBinding);
    expect(missingBindingAnalysis.readiness).toBe("incomplete");
    expect(missingBindingAnalysis.blockers.map((blocker) => blocker.code)).toContain(
      "case_proof_binding_mismatch",
    );

    const changedProof = completeEvidence();
    const changedBindings = [...changedProof.heldOut!.caseProofBindings];
    changedBindings[0] = {
      ...changedBindings[0]!,
      sourceCanonicalProofHash: "f".repeat(64),
    };
    changedProof.heldOut = {
      ...changedProof.heldOut!,
      caseProofBindings: changedBindings,
    };
    const changedProofAnalysis = analyzeStrategyReplayEvidence(changedProof);
    expect(changedProofAnalysis.readiness).toBe("incomplete");
    expect(changedProofAnalysis.blockers.map((blocker) => blocker.code)).toContain(
      "case_manifest_mismatch",
    );
  });

  it("rejects case proof bindings from another project or revision", () => {
    const input = completeEvidence();
    const changedBindings = [...input.heldOut!.caseProofBindings];
    changedBindings[0] = {
      ...changedBindings[0]!,
      sourceRevision: "b".repeat(40),
    };
    input.heldOut = {
      ...input.heldOut!,
      caseProofBindings: changedBindings,
    };

    const analysis = analyzeStrategyReplayEvidence(input);

    expect(analysis.readiness).toBe("incomplete");
    expect(analysis.blockers.map((blocker) => blocker.code)).toContain(
      "case_proof_binding_mismatch",
    );
  });

  it("rejects a forged paired comparison and overlapping held-out cases", () => {
    const forged = completeEvidence();
    forged.heldOut = {
      ...forged.heldOut!,
      pairedRun: {
        ...forged.heldOut!.pairedRun,
        comparison: {
          ...forged.heldOut!.pairedRun.comparison,
          metricDeltas: {
            ...forged.heldOut!.pairedRun.comparison.metricDeltas!,
            costUnits: 999,
          },
        },
      },
    };
    const forgedAnalysis = analyzeStrategyReplayEvidence(forged);
    expect(forgedAnalysis.readiness).toBe("incomplete");
    expect(forgedAnalysis.blockers.map((blocker) => blocker.code)).toContain(
      "paired_run_invalid",
    );

    const overlapping = completeEvidence();
    const overlapCaseIds = cases.slice(0, 30).map((testCase) => testCase.id);
    overlapping.heldOut = corpus({
      corpusId: "heldout:overlap",
      projectId: "project-a",
      revision: sourceRevision,
      caseIds: overlapCaseIds,
      candidateId: overlapping.candidate.candidateId,
    });
    const overlapAnalysis = analyzeStrategyReplayEvidence(overlapping);
    expect(overlapAnalysis.readiness).toBe("incomplete");
    expect(overlapAnalysis.blockers.map((blocker) => blocker.code)).toContain(
      "case_partition_overlap",
    );
  });

  it("marks measured held-out regressions and excessive calibration error", () => {
    const input = completeEvidence();
    input.heldOut = {
      ...input.heldOut!,
      pairedRun: pairedRun({
        pairId: "pair:heldout:regressed",
        candidateId: input.candidate.candidateId,
        revision: sourceRevision,
        caseIds: cases.slice(1, 31).map((testCase) => testCase.id),
        baselineCorrect: true,
        candidateCorrect: false,
      }),
    };
    input.heldOut.caseManifestHash = hashStrategyReplayCaseManifest({
      corpusId: input.heldOut.corpusId,
      projectId: input.heldOut.projectId,
      sourceRevision: input.heldOut.sourceRevision,
      suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
      caseIds: cases.slice(1, 31).map((testCase) => testCase.id).sort(),
      sourceEpisodeIds: [...input.heldOut.sourceEpisodeIds],
      caseProofBindings: [...input.heldOut.caseProofBindings],
    });
    input.confidenceCalibrationEce = 0.2;

    const analysis = analyzeStrategyReplayEvidence(input);

    expect(analysis.readiness).toBe("regressed");
    expect(analysis.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "held_out_success_regression",
        "calibration_threshold_exceeded",
      ]),
    );
  });

  it("requires more than one accepted supporting episode", () => {
    const input = completeEvidence();
    input.candidate = strategyCandidate({
      supportingEpisodeIds: ["episode:accepted-1"],
    });

    const analysis = analyzeStrategyReplayEvidence(input);

    expect(analysis.readiness).toBe("incomplete");
    expect(analysis.blockers.map((blocker) => blocker.code)).toContain(
      "supporting_episode_threshold",
    );
  });
});