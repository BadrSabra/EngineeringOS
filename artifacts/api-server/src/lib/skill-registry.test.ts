import { describe, expect, it } from "vitest";
import {
  buildSkillShadowScore,
  parseShadowReplayRegistryReceipt,
  SkillRegistryIdentitySchema,
  SkillShadowScoreSchema,
} from "./skill-registry.js";

const replayId = "replay-1";
const candidateId = "skill-candidate:proposal-1:aaaaaaaa";
const candidateTreeHash = "a".repeat(64);
const baselineTreeHash = "b".repeat(64);

function comparison(overrides: Record<string, unknown> = {}) {
  return {
    kind: "code-agent-benchmark-paired-comparison",
    version: 1,
    status: "passed",
    promotionAllowed: true,
    contract: {
      kind: "code-agent-benchmark-paired-contract",
      version: 1,
      pairId: `shadow-replay-pair:${replayId}`,
      suiteVersion: "flight-deck-v2",
      sourceRevision: "revision-1",
      objectiveDigest: "c".repeat(64),
      scopeDigest: "d".repeat(64),
      budgetDigest: "e".repeat(64),
      baselineRunId: `${replayId}:baseline`,
      candidateRunId: `${replayId}:candidate`,
      baselineWorkspaceHash: baselineTreeHash,
      candidateWorkspaceHash: candidateTreeHash,
      candidateId,
    },
    baselineRunId: `${replayId}:baseline`,
    candidateRunId: `${replayId}:candidate`,
    baselineWorkspaceHash: baselineTreeHash,
    candidateWorkspaceHash: candidateTreeHash,
    metricDeltas: {
      evidenceCoverage: 0,
      validatorPassRate: 0,
      duplicateCalls: 0,
      unauthorizedCalls: 0,
      recoveryCount: 0,
      durationMs: 0,
      costUnits: 0,
    },
    terminalMismatchCount: 0,
    cases: [{ caseId: "blocked-004" }],
    blockers: [],
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    runId: replayId,
    candidateId,
    projectId: "project-1",
    sourceRevision: "revision-1",
    candidateTreeHash,
    proof: {
      receiptId: "replay-acceptance-1",
      trajectoryDigest: "f".repeat(64),
      verdict: "PROVEN",
    },
    productionExecution: false,
    replayId,
    replayExecutionId: "execution-1",
    status: "completed",
    preTreeHash: candidateTreeHash,
    postTreeHash: candidateTreeHash,
    workspaceIsolated: true,
    workspaceCleaned: true,
    pairedBaseline: comparison(),
    ...overrides,
  };
}

describe("skill registry Gate 4 contract", () => {
  it("accepts only a passing, identity-bound paired baseline", () => {
    const score = buildSkillShadowScore({
      comparison: comparison(),
      replayId,
      candidateId,
      candidateTreeHash,
      baselineTreeHash,
    });

    expect(score).toMatchObject({
      contractVersion: 1,
      status: "passed",
      promotionAllowed: true,
      pairId: `shadow-replay-pair:${replayId}`,
      suiteVersion: "flight-deck-v2",
      baselineWorkspaceHash: baselineTreeHash,
      candidateWorkspaceHash: candidateTreeHash,
    });
    expect(SkillShadowScoreSchema.safeParse(score).success).toBe(true);
  });

  it.each([
    ["incomplete comparison", { status: "incomplete" }],
    ["regressed comparison", { status: "regressed" }],
    ["promotion denied", { promotionAllowed: false }],
    ["candidate mismatch", {
      candidateWorkspaceHash: "9".repeat(64),
    }],
    ["pair mismatch", {
      contract: {
        ...comparison().contract,
        pairId: "shadow-replay-pair:other",
      },
    }],
  ])("rejects %s", (_label, overrides) => {
    expect(buildSkillShadowScore({
      comparison: comparison(overrides),
      replayId,
      candidateId,
      candidateTreeHash,
      baselineTreeHash,
    })).toBeNull();
  });

  it("parses only completed isolated replay receipts", () => {
    expect(parseShadowReplayRegistryReceipt(receipt())).not.toBeNull();
    expect(parseShadowReplayRegistryReceipt(receipt({ workspaceCleaned: false }))).toBeNull();
    expect(parseShadowReplayRegistryReceipt(receipt({ productionExecution: true }))).toBeNull();
  });

  it("keeps skill identifiers bounded and server-parseable", () => {
    expect(SkillRegistryIdentitySchema.parse({
      skillId: "repo-review",
      skillVersion: "1.0.0",
    })).toEqual({
      skillId: "repo-review",
      skillVersion: "1.0.0",
    });
    expect(() => SkillRegistryIdentitySchema.parse({
      skillId: "repo review",
      skillVersion: "1.0.0",
    })).toThrow();
  });
});