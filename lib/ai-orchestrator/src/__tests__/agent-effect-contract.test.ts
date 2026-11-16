import { describe, expect, it } from "vitest";
import {
  AgentActionSchema,
  AgentActionRequestedPayloadSchema,
  ApplyAuthorizationDecisionSchema,
  ApplyPreconditionReceiptSchema,
  buildApplyAuthorizationDecision,
  buildApplyPreconditionReceipt,
  AgentEffectSchema,
  EffectContractSchema,
  classifyEffect,
  hashEffectContract,
  parseAgentObservation,
  parseEffectContract,
} from "../agent-state/index.js";
import type { AgentObservation } from "../agent-state/index.js";

const contract = {
  schemaVersion: "1" as const,
  effectId: "effect-1",
  expectedStateChanges: [{ subject: "workspace", predicate: "validated", expectedValue: true }],
  observationProfile: "TEST" as const,
  requiredEvidence: ["validation-1"],
  allowedResult: "OBSERVED" as const,
};

const action = {
  schemaVersion: "1" as const,
  actionId: "action-1",
  episodeId: "episode-1",
  capabilityId: "validation",
  intent: "Run the validation capability",
  scope: { projectId: "project-1" },
  preconditions: ["workspace is available"],
  expectedEffects: ["effect-1"],
  authorization: { source: "server" },
  risk: "LOW" as const,
  idempotencyKey: "action-1",
  observationProfile: "TEST",
  failureSemantics: ["Do not claim success without a direct after observation."],
};

function observation(overrides: Partial<AgentObservation>): AgentObservation {
  return parseAgentObservation({
    schemaVersion: "1",
    observationId: "observation-1",
    projectId: "project-1",
    executionId: "execution-1",
    episodeId: "episode-1",
    kind: "EXTERNAL",
    provenance: "DIRECT_OBSERVATION",
    observationRole: "before",
    sourceType: "runtime",
    sourceId: "runtime-1",
    sourceVersion: "revision-1",
    subject: "workspace",
    predicate: "validated",
    value: false,
    sourceRefs: ["runtime:1"],
    observedAt: "2026-09-24T00:00:00.000Z",
    projectRevision: "revision-1",
    completeness: "complete",
    freshness: "fresh",
    evidenceRefs: ["evidence:1"],
    ...overrides,
  });
}

describe("agent effect contract", () => {
  it("accepts a bounded effect contract and has a stable hash", () => {
    expect(parseEffectContract(contract).effectId).toBe("effect-1");
    expect(hashEffectContract(contract)).toHaveLength(64);
  });

  it("rejects unknown effect status and oversized payloads", () => {
    expect(AgentEffectSchema.safeParse({
      schemaVersion: "1",
      effectId: "effect-1",
      projectId: "project-1",
      episodeId: "episode-1",
      executionId: "execution-1",
      attempt: 0,
      actionId: "action-1",
      capabilityId: "validation",
      effectContractHash: "hash",
      beforeObservationIds: [],
      afterObservationIds: [],
      expectedEffects: {},
      status: "proven",
      missingEffects: [],
      contradictionRefs: [],
      evidenceRefs: [],
      createdAt: "2026-09-24T00:00:00.000Z",
    }).success).toBe(false);
    expect(EffectContractSchema.safeParse({
      ...contract,
      expectedStateChanges: [{ subject: "x", predicate: "y", expectedValue: "x".repeat(17 * 1024) }],
    }).success).toBe(false);
  });

  it("requires an action to declare the effect contract it is about to execute", () => {
    expect(AgentActionSchema.safeParse(action).success).toBe(true);
  });

  it("requires request-event aliases to match the canonical action", () => {
    expect(AgentActionRequestedPayloadSchema.safeParse({
      action,
      actionId: action.actionId,
      capabilityId: action.capabilityId,
      expectedEffects: action.expectedEffects,
      actionContract: { contractVersion: 1 },
      worldTransitionIntent: {
        schemaVersion: 1,
        projectId: "project-1",
        proposalId: "proposal-1",
        goalId: "goal-1",
        planRevision: "a".repeat(64),
        parentWorldRevision: "b".repeat(64),
        parentFactRefs: ["fact-1"],
      },
    }).success).toBe(true);
    expect(AgentActionRequestedPayloadSchema.safeParse({
      action,
      actionId: "different-action",
    }).success).toBe(false);
    expect(AgentActionRequestedPayloadSchema.safeParse({
      action,
      expectedEffects: ["different-effect"],
    }).success).toBe(false);
    expect(AgentActionRequestedPayloadSchema.safeParse({
      action,
      worldTransitionIntent: {
        schemaVersion: 1,
        projectId: "project-1",
        proposalId: "proposal-1",
        goalId: "goal-1",
        planRevision: "invalid",
        parentWorldRevision: "b".repeat(64),
        parentFactRefs: ["fact-1"],
      },
    }).success).toBe(false);

  });

  it("binds versioned Apply authorization and precondition receipts while preserving legacy events", () => {
    const applyAction = {
      ...action,
      capabilityId: "approved.source-promotion",
    };
    const authorization = buildApplyAuthorizationDecision({
      schemaVersion: 1,
      decision: "ALLOW",
      actorUserId: "user-1",
      projectId: "project-1",
      projectOwnerId: "user-1",
      proposalId: "proposal-1",
      proposalRevision: 4,
      executionId: "execution-1",
      attempt: 2,
      capabilityId: "approved.source-promotion",
      approvedPathsHash: "a".repeat(64),
      proposalChangesHash: "b".repeat(64),
      changeSetHash: "c".repeat(64),
    });
    const stages = {
      PROJECT_OWNER_MATCHED: "APPLY_AUTHORIZATION_DECISION",
      PROPOSAL_ELIGIBLE: "APPLY_AUTHORIZATION_DECISION",
      EXACT_APPROVED_SUBSET: "APPLY_APPROVED_SUBSET",
      CANDIDATE_VALIDATION_PASSED: "APPLY_VALIDATION_PASSED",
      CANDIDATE_STABLE: "APPLY_CANDIDATE_STABLE",
      LIVE_ROOT_BASE_MATCHED: "APPLY_CANDIDATE_STABLE",
      EXECUTION_LEASE_OWNED: "APPLY_EXECUTION_LEASE",
      MISSION_PARENT_SNAPSHOT_BOUND: "APPLY_PARENT_SNAPSHOT",
    } as const;
    const checks = Object.entries(stages).map(([id, stage], index) => ({
      id: id as keyof typeof stages,
      outcome: "SATISFIED" as const,
      reference: {
        kind: "APPLY_JOURNAL" as const,
        id: `journal-${index}`,
        stage,
        contentHash: String(index + 1).repeat(64),
      },
    }));
    const receipt = buildApplyPreconditionReceipt({
      schemaVersion: 1,
      actionId: "action-1",
      executionId: "execution-1",
      attempt: 2,
      planRevision: "d".repeat(64),
      parentWorldRevision: "e".repeat(64),
      checks,
    });
    const intent = {
      schemaVersion: 1 as const,
      projectId: "project-1",
      proposalId: "proposal-1",
      goalId: "goal-1",
      planRevision: "d".repeat(64),
      parentWorldRevision: "e".repeat(64),
      parentFactRefs: ["fact-1"],
    };

    expect(ApplyAuthorizationDecisionSchema.safeParse(authorization).success).toBe(true);
    expect(ApplyPreconditionReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(AgentActionRequestedPayloadSchema.safeParse({
      action: applyAction,
      actionId: applyAction.actionId,
      capabilityId: applyAction.capabilityId,
      expectedEffects: applyAction.expectedEffects,
      worldTransitionIntent: intent,
      authorizationDecision: authorization,
      preconditionReceipt: receipt,
    }).success).toBe(true);

    // Old persisted ACTION_REQUESTED payloads remain parseable without v2 receipts.
    expect(AgentActionRequestedPayloadSchema.safeParse({ action: applyAction }).success).toBe(true);
    expect(AgentActionRequestedPayloadSchema.safeParse({
      action: applyAction,
      authorizationDecision: authorization,
    }).success).toBe(false);
    expect(ApplyAuthorizationDecisionSchema.safeParse({
      ...authorization,
      projectOwnerId: "another-user",
    }).success).toBe(false);
    expect(ApplyPreconditionReceiptSchema.safeParse({
      ...receipt,
      checks: [...receipt.checks.slice(1), receipt.checks[1]],
    }).success).toBe(false);
    expect(ApplyPreconditionReceiptSchema.safeParse({
      ...receipt,
      receiptHash: "f".repeat(64),
    }).success).toBe(false);
  });

  it("classifies a complete transition as observed", () => {
    expect(classifyEffect({
      contract,
      before: [observation({ value: false })],
      after: [observation({ observationId: "observation-2", observationRole: "after", value: true })],
    }).status).toBe("observed");
  });

  it("classifies mixed transitions as partial", () => {
    const second = { subject: "other", predicate: "ready", expectedValue: true };
    expect(classifyEffect({
      contract: { ...contract, expectedStateChanges: [...contract.expectedStateChanges, second] },
      before: [
        observation({ value: false }),
        observation({ observationId: "observation-3", subject: "other", predicate: "ready", value: false }),
      ],
      after: [observation({ observationId: "observation-2", observationRole: "after", value: true })],
    }).status).toBe("partial");
  });

  it("classifies missing direct evidence as not observed", () => {
    expect(classifyEffect({
      contract,
      before: [observation({ value: false, provenance: "SERVER_DERIVED" })],
      after: [],
    }).status).toBe("not_observed");
  });

  it("classifies a conflicting after observation as contradicted", () => {
    expect(classifyEffect({
      contract,
      before: [observation({ value: false })],
      after: [observation({ observationId: "observation-2", observationRole: "after", value: "wrong" })],
    }).status).toBe("contradicted");
  });

  it("classifies an unchanged state as unknown", () => {
    expect(classifyEffect({
      contract,
      before: [observation({ value: true })],
      after: [observation({ observationId: "observation-2", observationRole: "after", value: true })],
    }).status).toBe("unknown");
  });

  it("rejects before and after evidence with roles from another phase", () => {
    const result = classifyEffect({
      contract,
      before: [observation({ observationRole: "effect", value: false })],
      after: [observation({ observationId: "observation-2", observationRole: "before", value: true })],
    });

    expect(result.status).toBe("not_observed");
    expect(result.missingEffects).toEqual(["workspace.validated"]);
  });

  it("rejects reusing one observation identity for both transition sides", () => {
    const result = classifyEffect({
      contract,
      before: [observation({ observationRole: "before", value: false })],
      after: [observation({ observationRole: "after", value: true })],
    });

    expect(result.status).toBe("not_observed");
    expect(result.missingEffects).toEqual(["workspace.validated"]);
  });
});