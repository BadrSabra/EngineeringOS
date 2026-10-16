import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAiTaskExecutionReceipt,
  classifyTaskExecutionFailure,
  missionObservationAnswerAttestationIsValid,
  missionObservationEvidenceBindingsFromSourceSnapshot,
  missionObservationEvidenceBindingsMatchSourceSnapshot,
  MissionToolOutcomeUncertainError,
  missionPlanRevisionHash,
} from "./task-execution-service.js";
import { missionObjectiveContract } from "./mission-execution-profile.js";

function result(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Completed review at /home/runner/workspace/src/app.ts; token=super-secret",
    confidence: "high",
    needsHumanReview: false,
    steps: Array.from({ length: 80 }, (_, index) =>
      `step ${index} /tmp/internal-${index}.ts password=hunter2`,
    ),
    ...overrides,
  } as never;
}

describe("AI task execution receipts", () => {
  it("does not accept deterministic fallback as a proven Mission observation answer", () => {
    const objective = missionObjectiveContract({
      objective: "Can the report say COMPLETED without matching PROVEN proof?",
      profile: "mission_observe",
      targetPaths: ["src/report.mjs"],
    });
    const response = "A complete-looking answer.";
    const sourceRevision = "project-context-v1:0123456789abcdef";
    const excerpt = "export function reportStatus() {}";
    const evidenceBindings = objective.requiredClaims.map((claim) => ({
      claimId: claim.claimId,
      source: claim.requiredEvidencePaths?.[0] ?? "src/report.mjs",
      startLine: 1,
      endLine: 1,
      excerptHash: createHash("sha256").update(excerpt, "utf8").digest("hex"),
    }));
    const evidenceBindingHash = createHash("sha256")
      .update(JSON.stringify(evidenceBindings), "utf8")
      .digest("hex");
    const outputFor = (responseSource: "provider_synthesis" | "deterministic_fallback") => ({
      objective,
      response,
      projectQueryResponseSource: responseSource,
      evidenceGraph: { sourceRevision },
      projectQueryAnswerAttestation: {
        version: 2 as const,
        sourceRevision,
        responseHash: createHash("sha256").update(response, "utf8").digest("hex"),
        responseSource,
        claimIds: objective.requiredClaims.map((claim) => claim.claimId),
        evidenceBindings,
        evidenceBindingHash,
        ...(responseSource === "provider_synthesis"
          ? {
              synthesisAttemptId: "attempt-1",
              synthesisProvider: "openrouter",
              synthesisModel: "openai/gpt-4.1-mini",
            }
          : {}),
      },
    });

    expect(missionObservationAnswerAttestationIsValid({
      output: outputFor("deterministic_fallback") as never,
      objective,
      sourceRevision,
    })).toBe(false);
    expect(missionObservationAnswerAttestationIsValid({
      output: outputFor("provider_synthesis") as never,
      objective,
      sourceRevision,
    })).toBe(true);
  });

  it("validates each answer binding against the fresh scoped source snapshot", () => {
    const objective = missionObjectiveContract({
      objective: "Can the report say COMPLETED without matching PROVEN proof?",
      profile: "mission_observe",
      targetPaths: ["src/report.mjs"],
    });
    const sourceRevision = "project-context-v1:0123456789abcdef";
    const body = "export function reportStatus() {}\n";
    const excerpt = body.split("\n")[0]!.trim();
    const evidenceBindings = objective.requiredClaims.map((claim) => ({
      claimId: claim.claimId,
      source: claim.requiredEvidencePaths?.[0] ?? "src/report.mjs",
      startLine: 1,
      endLine: 1,
      excerptHash: createHash("sha256").update(excerpt, "utf8").digest("hex"),
    }));
    const attestation = {
      version: 2 as const,
      sourceRevision,
      responseHash: "a".repeat(64),
      responseSource: "provider_synthesis" as const,
      claimIds: objective.requiredClaims.map((claim) => claim.claimId),
      evidenceBindings,
      evidenceBindingHash: createHash("sha256")
        .update(JSON.stringify(evidenceBindings), "utf8")
        .digest("hex"),
      synthesisAttemptId: "attempt-1",
      synthesisProvider: "openrouter",
      synthesisModel: "openai/gpt-4.1-mini",
    };
    const params = {
      attestation,
      objective,
      targetPaths: ["src/report.mjs"],
      sourceRevision,
      reads: [{
        path: "src/report.mjs",
        body,
        complete: true,
        truncated: false,
      }],
    };

    expect(missionObservationEvidenceBindingsMatchSourceSnapshot(params)).toBe(true);
    expect(missionObservationEvidenceBindingsFromSourceSnapshot(params)?.map((binding) => ({
      claimId: binding.claimId,
      excerpt: binding.excerpt,
    }))).toEqual(objective.requiredClaims.map((claim) => ({
      claimId: claim.claimId,
      excerpt,
    })));
    expect(missionObservationEvidenceBindingsMatchSourceSnapshot({
      ...params,
      reads: [{ ...params.reads[0]!, body: "export function reportStatus() { return false; }\n" }],
    })).toBe(false);
    expect(missionObservationEvidenceBindingsMatchSourceSnapshot({
      ...params,
      sourceRevision: "project-context-v1:changed",
    })).toBe(false);
  });

  it("keeps a bounded, safe structured success receipt", () => {
    const receipt = buildAiTaskExecutionReceipt({
      executionId: "execution-1",
      correlationId: "correlation-1",
      revision: "2026-08-23T00:00:00.000Z",
      provider: "openrouter",
      attempt: 0,
      attempts: 2,
      durationMs: 42,
      stages: ["claim", "context", "provider_call", "provider_fallback", "finalize"],
      result: result(),
    });

    expect(Buffer.byteLength(JSON.stringify(receipt), "utf8")).toBeLessThanOrEqual(8_000);
    expect(receipt.terminalStatus).toBe("SUCCEEDED");
    expect(receipt.attempts).toBe(2);
    expect(receipt.provider).toBe("openrouter");
    expect(receipt.model).toBeTruthy();
    expect(receipt.summary).not.toContain("/home/runner");
    expect(receipt.summary).not.toContain("super-secret");
    expect(receipt.steps).toHaveLength(24);
    expect(JSON.stringify(receipt)).not.toContain("hunter2");
  });

  it("preserves server-owned UUID identities for receipt projection", () => {
    const executionId = "c3b8a0d6-ef37-4a53-a701-58d6990f3231";
    const correlationId = "a7c98e31-55b4-46b6-8c98-ea027e8c4742";
    const synthesisAttemptId = "607439a1-68ca-4e96-b23a-12ea70cb4dfe";
    const receipt = buildAiTaskExecutionReceipt({
      executionId,
      correlationId,
      revision: "sha256:0123456789abcdef",
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      attempt: 1,
      durationMs: 125,
      stages: ["claim", "evidence", "synthesis", "finalize"],
      result: result({ summary: "Evidence-bound answer.", steps: [] }),
      answerProof: {
        version: 3,
        status: "PROVEN",
        executionId,
        attempt: 1,
        projectId: "e60be3b7-134b-49ab-b938-13870fb46a62",
        sourceRevision: "workspace-tree-v1:0123456789abcdef",
        workspaceRevision: "workspace-tree-v1:0123456789abcdef",
        responseHash: "a".repeat(64),
        responseSource: "provider_synthesis",
        claimCount: 2,
        claimIdsHash: "b".repeat(64),
        evidenceBindings: [{
          claimId: "claim-1",
          source: "src/report.mjs",
          startLine: 1,
          endLine: 1,
          excerptHash: "d".repeat(64),
          excerpt: "return safeValue;\napiKey=sk-provider-secret-123456789;",
        }, {
          claimId: "claim-2",
          source: "src/acceptance.mjs",
          startLine: 2,
          endLine: 4,
          excerptHash: "e".repeat(64),
          excerpt: "acceptance is validated",
        }],
        evidenceBindingHash: "c".repeat(64),
        synthesisAttemptId,
        synthesisProvider: "openrouter",
        synthesisModel: "openai/gpt-4.1-mini",
      },
    });

    expect(receipt.operationId).toBe(executionId);
    expect(receipt.correlationId).toBe(correlationId);
    expect(receipt.revision).toBe("sha256:0123456789abcdef");
    expect(receipt.answerProof?.executionId).toBe(executionId);
    expect(receipt.answerProof?.attempt).toBe(1);
    expect(receipt.answerProof?.workspaceRevision).toBe("workspace-tree-v1:0123456789abcdef");
    expect(receipt.answerProof?.synthesisAttemptId).toBe(synthesisAttemptId);
    expect(receipt.answerProof?.evidenceBindings[0]?.excerpt).not.toContain("sk-provider-secret");
    expect(receipt.answerProof?.evidenceBindings[0]?.excerptRedacted).toBe(true);
    expect(receipt.answerProof?.evidenceBindings[0]?.excerpt).toContain("return safeValue;");
    expect(receipt.answerProof?.evidenceBindings[1]?.excerpt).toBe("acceptance is validated");
  });

  it("retains proof-bound answer text beyond the old two-thousand-character cap", () => {
    const summary =
      `${"The verified implementation flow is consistent. ".repeat(48)} ` +
      "reportStatus=COMPLETED in src/report.mjs requires matching PROVEN acceptance.";
    const receipt = buildAiTaskExecutionReceipt({
      executionId: "execution-answer-proof",
      correlationId: "correlation-answer-proof",
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      attempt: 1,
      durationMs: 125,
      stages: ["claim", "evidence", "synthesis", "finalize"],
      result: result({ summary, steps: [] }),
      answerProof: {
        version: 3,
        status: "PROVEN",
        executionId: "execution-answer-proof",
        attempt: 1,
        projectId: "e60be3b7-134b-49ab-b938-13870fb46a62",
        sourceRevision: "workspace-tree-v1:0123456789abcdef",
        workspaceRevision: "workspace-tree-v1:0123456789abcdef",
        responseHash: "a".repeat(64),
        responseSource: "provider_synthesis",
        claimCount: 2,
        claimIdsHash: "b".repeat(64),
        evidenceBindings: [{
          claimId: "claim-1",
          source: "src/report.mjs",
          startLine: 1,
          endLine: 1,
          excerptHash: "d".repeat(64),
        }, {
          claimId: "claim-2",
          source: "src/acceptance.mjs",
          startLine: 2,
          endLine: 4,
          excerptHash: "e".repeat(64),
        }],
        evidenceBindingHash: "c".repeat(64),
        synthesisAttemptId: "attempt-1",
        synthesisProvider: "openrouter",
        synthesisModel: "openai/gpt-4.1-mini",
      },
    });

    expect(receipt.summary?.length).toBeGreaterThan(2_000);
    expect(receipt.summary).toContain("reportStatus=COMPLETED");
    expect(receipt.summary).toContain("src/report.mjs");
    expect(receipt.answerProof?.summaryTruncated).toBe(false);
    expect(receipt.answerProof?.summaryHash).toBe(
      createHash("sha256").update(receipt.summary ?? "", "utf8").digest("hex"),
    );
    expect(Buffer.byteLength(JSON.stringify(receipt), "utf8")).toBeLessThanOrEqual(8_000);
  });

  it("omits display excerpts rather than exceeding the bounded receipt size", () => {
    const executionId = "execution-large-proof";
    const receipt = buildAiTaskExecutionReceipt({
      executionId,
      correlationId: "correlation-large-proof",
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      attempt: 1,
      durationMs: 125,
      stages: ["claim", "evidence", "synthesis", "finalize"],
      result: result({ summary: "Evidence-bound answer.", steps: [] }),
      answerProof: {
        version: 3,
        status: "PROVEN",
        executionId,
        attempt: 1,
        projectId: "e60be3b7-134b-49ab-b938-13870fb46a62",
        sourceRevision: "workspace-tree-v1:0123456789abcdef",
        workspaceRevision: "workspace-tree-v1:0123456789abcdef",
        responseHash: "a".repeat(64),
        responseSource: "provider_synthesis",
        claimCount: 12,
        claimIdsHash: "b".repeat(64),
        evidenceBindings: Array.from({ length: 12 }, (_, index) => ({
          claimId: `claim-${index}`,
          source: `src/module-${index}.mjs`,
          startLine: 1,
          endLine: 4,
          excerptHash: "d".repeat(64),
          excerpt: `export function reportStatus() {\n${"  return 'COMPLETED';\n".repeat(30)}`,
        })),
        evidenceBindingHash: "c".repeat(64),
        synthesisAttemptId: "attempt-large-proof",
        synthesisProvider: "openrouter",
        synthesisModel: "openai/gpt-4.1-mini",
      },
    });

    expect(Buffer.byteLength(JSON.stringify(receipt), "utf8")).toBeLessThanOrEqual(8_000);
    expect(receipt.answerProof?.evidenceBindings.every((binding) =>
      binding.excerpt === undefined && binding.excerptUnavailableReason === "receipt_size_limit",
    )).toBe(true);
  });

  it("represents blocked results without storing model payloads", () => {
    const receipt = buildAiTaskExecutionReceipt({
      executionId: "execution-2",
      correlationId: "correlation-2",
      provider: "groq",
      attempt: 1,
      durationMs: 1_000_000_000,
      stages: ["claim", "provider_call"],
      result: result({
        summary: "Needs operator approval",
        needsHumanReview: true,
        steps: ["Review proposed change"],
      }),
    });

    expect(receipt.terminalStatus).toBe("BLOCKED");
    expect(receipt.terminalReason).toBe("human_review_required");
    expect(receipt.durationMs).toBe(86_400_000);
    expect(receipt.evidenceRefs).toEqual([]);
  });
});

describe("AI task execution failure classification", () => {
  it("keeps provider failures recoverable and distinct from generic execution failures", () => {
    expect(classifyTaskExecutionFailure({
      stage: "provider_call",
      cancelled: false,
    })).toEqual({
      code: "provider_call_failed",
      failureClass: "provider",
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      retryable: true,
    });
  });

  it("classifies context failures separately", () => {
    expect(classifyTaskExecutionFailure({
      stage: "context",
      cancelled: false,
    })).toEqual({
      code: "context_build_failed",
      failureClass: "context",
      reasonCode: "CONTEXT_BUILD_FAILED",
      retryable: true,
    });
  });

  it("never retries cancellation as a provider or execution failure", () => {
    expect(classifyTaskExecutionFailure({
      stage: "provider_call",
      cancelled: true,
    })).toEqual({
      code: "cancelled",
      failureClass: "internal",
      reasonCode: "EXECUTION_CANCELLED",
      retryable: false,
    });
  });

  it("fails closed on uncertain started-tool outcomes without treating them as cancellation", () => {
    const error = new MissionToolOutcomeUncertainError();
    expect(classifyTaskExecutionFailure({
      stage: "provider_call",
      cancelled: false,
      error,
    })).toEqual({
      code: "mission_tool_outcome_uncertain",
      failureClass: "tool",
      reasonCode: "MISSION_TOOL_OUTCOME_UNCERTAIN",
      retryable: false,
    });
    expect(classifyTaskExecutionFailure({
      stage: "provider_call",
      cancelled: true,
      error,
    })).toEqual({
      code: "cancelled",
      failureClass: "internal",
      reasonCode: "EXECUTION_CANCELLED",
      retryable: false,
    });
  });
});

describe("Mission episode identity", () => {
  it("derives the active plan revision from the goal outcome contract", () => {
    expect(missionPlanRevisionHash({
      outcomeContract: { planRevision: { hash: " outcome-plan-1 " } },
      successCriteria: {},
    } as never)).toBe("outcome-plan-1");
  });

  it("falls back to the goal success criteria plan revision", () => {
    expect(missionPlanRevisionHash({
      outcomeContract: {},
      successCriteria: { planRevision: { hash: "success-plan-1" } },
    } as never)).toBe("success-plan-1");
  });

  it("rejects missing or malformed plan revisions", () => {
    expect(missionPlanRevisionHash(undefined)).toBeUndefined();
    expect(missionPlanRevisionHash({
      outcomeContract: { planRevision: { hash: 42 } },
      successCriteria: {},
    } as never)).toBeUndefined();
  });
});
