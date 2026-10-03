import { describe, expect, it } from "vitest";
import type { RegisteredStrategyReplayCaseDefinition } from "./strategy-replay-case-registry.js";
import {
  blockedStrategyReplayNodeIds,
  matchesStoredReplayReceiptIdentity,
  type StrategyReplayCaseRunReceipt,
} from "./strategy-replay-case-runner.js";

const hash = (character: string) => character.repeat(64);

describe("Strategy Replay blocked-node diagnostic projection", () => {
  it("retains only bounded safe node IDs for failed or blocked nodes", () => {
    expect(blockedStrategyReplayNodeIds([
      { nodeId: "runtime.start", status: "passed" },
      { nodeId: "runtime.observe", status: "blocked" },
      { nodeId: "runtime.observe", status: "failed" },
      { nodeId: "not a safe id", status: "blocked" },
    ])).toEqual(["runtime.observe"]);
  });

  it("caps the diagnostic node list at 24 IDs", () => {
    const nodes = Array.from({ length: 30 }, (_, index) => ({
      nodeId: `step-${index}`,
      status: "blocked" as const,
    }));
    expect(blockedStrategyReplayNodeIds(nodes)).toHaveLength(24);
  });
});

describe("stored Strategy Replay receipt identity", () => {
  const definition = {
    schemaVersion: 1,
    caseId: "strategy-case:test",
    projectId: "project:test",
    candidateId: "candidate:test",
    candidateHash: hash("a"),
    sourceRevision: "b".repeat(40),
    sourceEpisodeId: "source-episode:test",
    sourceExecutionId: "source-execution:test",
    sourceAttempt: 3,
    acceptanceId: "source-acceptance:test",
    effectBundleId: "source-effect:test",
    sourceCanonicalProofHash: hash("c"),
    actionId: "action:test",
    capabilityId: "runtime.start",
    actionContractHash: hash("d"),
    recipeId: "runtime.start",
  } satisfies RegisteredStrategyReplayCaseDefinition;
  const runId = "strategy-replay-run:test";
  const operationId = "strategy-replay-operation:test";
  const caseRegistrationId = "strategy-replay-registration:test";
  const replayExecutionId = "replay-execution:test";
  const replayEpisodeId = "replay-episode:test";
  const replayEffectBundleId = "replay-effect:test";
  const replayCanonicalProofHash = hash("e");
  const workspaceTreeHash = hash("f");
  const replayRun = {
    id: runId,
    projectId: definition.projectId,
    caseRegistrationId,
    attemptNumber: 1,
    candidateId: definition.candidateId,
    sourceEpisodeId: definition.sourceEpisodeId,
    operationId,
    candidateHash: definition.candidateHash,
    sourceCanonicalProofHash: definition.sourceCanonicalProofHash,
    status: "proven" as const,
    replayExecutionId,
    replayEpisodeId,
    replayAttempt: 0,
    replayEffectBundleId,
    replayCanonicalProofHash,
    workspaceTreeHash,
  };
  const snapshot = { definition, runId, operationId, replayRun };
  const receipt: StrategyReplayCaseRunReceipt = {
    schemaVersion: 1,
    runId,
    operationId,
    attemptNumber: 1,
    status: "proven",
    incompleteReason: null,
    partition: "held_out",
    projectId: definition.projectId,
    caseRegistrationId,
    caseId: definition.caseId,
    candidateId: definition.candidateId,
    candidateHash: definition.candidateHash,
    sourceRevision: definition.sourceRevision,
    sourceEpisodeId: definition.sourceEpisodeId,
    sourceExecutionId: definition.sourceExecutionId,
    sourceAttempt: definition.sourceAttempt,
    sourceAcceptanceId: definition.acceptanceId,
    sourceEffectBundleId: definition.effectBundleId,
    sourceCanonicalProofHash: definition.sourceCanonicalProofHash,
    replayExecutionId,
    replayAttempt: 0,
    replayEpisodeId,
    replayAcceptanceId: "replay-acceptance:test",
    replayEffectBundleId,
    replayCanonicalProofHash,
    workspaceTreeHash,
  };

  it("accepts a receipt whose full source and replay identity matches", () => {
    expect(matchesStoredReplayReceiptIdentity(receipt, snapshot)).toBe(true);
  });

  it("keeps legacy first-attempt receipts readable without rewriting them", () => {
    const { attemptNumber: _attemptNumber, ...legacyReceipt } = receipt;
    expect(matchesStoredReplayReceiptIdentity(legacyReceipt, snapshot)).toBe(true);
  });

  it("rejects receipts with mismatched source or case identity fields", () => {
    const mismatchedReceipts: StrategyReplayCaseRunReceipt[] = [
      { ...receipt, attemptNumber: 2 },
      { ...receipt, projectId: "project:other" },
      { ...receipt, caseRegistrationId: "registration:other" },
      { ...receipt, caseId: "case:other" },
      { ...receipt, candidateId: "candidate:other" },
      { ...receipt, sourceRevision: "1".repeat(40) },
      { ...receipt, sourceEpisodeId: "episode:other" },
      { ...receipt, sourceExecutionId: "execution:other" },
      { ...receipt, sourceAttempt: receipt.sourceAttempt + 1 },
      { ...receipt, sourceAcceptanceId: "acceptance:other" },
      { ...receipt, sourceEffectBundleId: "effect:other" },
      { ...receipt, sourceCanonicalProofHash: hash("9") },
    ];

    for (const mismatchedReceipt of mismatchedReceipts) {
      expect(matchesStoredReplayReceiptIdentity(mismatchedReceipt, snapshot)).toBe(false);
    }
  });

  it("rejects a receipt whose case-attempt identity differs from its durable row", () => {
    expect(matchesStoredReplayReceiptIdentity(receipt, {
      ...snapshot,
      replayRun: { ...replayRun, attemptNumber: 2 },
    })).toBe(false);
  });

  it("rejects a replay row whose durable project or candidate identity drifted", () => {
    expect(matchesStoredReplayReceiptIdentity(receipt, {
      ...snapshot,
      replayRun: { ...replayRun, projectId: "project:other" },
    })).toBe(false);
    expect(matchesStoredReplayReceiptIdentity(receipt, {
      ...snapshot,
      replayRun: { ...replayRun, candidateId: "candidate:other" },
    })).toBe(false);
    expect(matchesStoredReplayReceiptIdentity(receipt, {
      ...snapshot,
      replayRun: { ...replayRun, sourceEpisodeId: "episode:other" },
    })).toBe(false);
  });
});