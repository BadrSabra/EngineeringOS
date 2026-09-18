import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildProjectQueryObjective,
  classifyRequest,
  detectProjectQueryClaimContradictions,
  deriveProjectQueryTargetMode,
  resolveActiveEvidenceContract,
  isAcceptanceCoverageRequest,
  resolveProjectQueryTarget,
  resolveTurnIntent,
} from "../index.js";
import { deriveObjectiveRuntimeEdgesFromRetainedReads } from "../evidence-integrity.js";
import type { EvidenceReference } from "../task-contracts.js";

describe("target-aware project queries", () => {
  it("resolves one active contract source without mixing probe and inferred objectives", () => {
    const message = "Analyze the embedded AI layer in the project";
    const target = resolveProjectQueryTarget(message);
    expect(target).toBeDefined();
    if (!target) return;

    const inferred = resolveActiveEvidenceContract({
      projectQueryTarget: target,
      capabilityProbeTurn: false,
      message,
    });
    expect(inferred.source).toBe("inferred");
    expect(inferred.projectQuery).toBe(target);
    expect(inferred.objective?.objectiveType).toBe("PROJECT_QUERY_EMBEDDED-AI");

    const explicitObjective = buildProjectQueryObjective(target, message);
    const explicit = resolveActiveEvidenceContract({
      explicitObjective,
      projectQueryTarget: target,
      capabilityProbeTurn: true,
      message,
    });
    expect(explicit.source).toBe("explicit");
    expect(explicit.objective).toBe(explicitObjective);
    expect(explicit.projectQuery).toBe(target);

    const probe = resolveActiveEvidenceContract({
      projectQueryTarget: target,
      capabilityProbeTurn: true,
      message,
    });
    expect(probe).toEqual({ source: "capability_probe" });

    expect(resolveActiveEvidenceContract({
      capabilityProbeTurn: false,
      message,
    })).toEqual({ source: "none" });
  });

  it("derives only the allowlisted operator source-targeting modes", () => {
    expect(deriveProjectQueryTargetMode({ targetResolution: "resolved" }))
      .toBe("resolved_target");
    expect(deriveProjectQueryTargetMode({
      targetResolution: "unresolved",
      targetFiles: ["src/a.ts"],
      targetConfidence: 0.9,
    })).toBe("bounded_unresolved_hint");
    expect(deriveProjectQueryTargetMode({
      targetResolution: "unresolved",
      targetFiles: ["src/a.ts"],
      targetConfidence: 0.7,
    })).toBe("source_first_discovery");
    expect(deriveProjectQueryTargetMode({ targetResolution: "not_applicable" }))
      .toBeUndefined();
  });

  it("recognizes the Arabic embedded-AI request and declares bounded evidence", () => {
    const message = "قم بتحليل طبقة الذكاء الاصطناعي المدمج داخل المشروع";
    const target = resolveProjectQueryTarget(message);
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(target?.id).toBe("embedded-ai");
    expect(classification.projectTarget?.id).toBe("embedded-ai");
    expect(intent.kind).toBe("PROJECT_QUERY");
    expect(intent.requiresTools).toBe(true);
    expect(intent.requiresEvidence).toBe(true);
    expect(intent.projectTarget?.requiredEvidencePaths).toContain(
      "lib/ai-orchestrator/src/turn-intent.ts",
    );
  });

  it("builds a server-owned objective with required claims and scope", () => {
    const target = resolveProjectQueryTarget("analyze the embedded AI layer");
    expect(target).toBeDefined();

    const objective = buildProjectQueryObjective(target!, "analyze the embedded AI layer");
    expect(objective.objectiveType).toBe("PROJECT_QUERY_EMBEDDED-AI");
    expect(objective.requiredEvidencePaths).toHaveLength(3);
    expect(objective.requiredClaims.map((claim) => claim.text)).toEqual([
      "The chat route resolves the turn intent before selecting the execution path.",
      "The tool-enabled chat execution enters executeToolLoop and retains its tool results before synthesis.",
      "The route dispatches provider requests through chatWithFallback before final response validation.",
    ]);
    expect(objective.requiredClaims[0]?.evidenceNeedles).toEqual([
      "resolveTurnIntent",
      "turnIntent",
    ]);
    expect(objective.requiredEvidenceEdges).toHaveLength(6);
    expect(objective.requiredEvidenceEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "lib/ai-orchestrator/src/agents/chat-agent.ts#chat",
          to: "lib/ai-orchestrator/src/turn-intent.ts#resolveTurnIntent",
        }),
        expect.objectContaining({
          from: "lib/ai-orchestrator/src/agents/chat-agent.ts#chat",
          to: "lib/ai-orchestrator/src/evidence-integrity.ts#validateFinalAnswer",
        }),
      ]),
    );
    expect(objective.scopePolicy?.forbiddenPaths).toContain("node_modules");
  });

  it("rejects a weakness conclusion that contradicts the accepted finish-reason guard", () => {
    const message = "Explain how the embedded AI agent works and identify its weaknesses.";
    const target = resolveProjectQueryTarget(message);
    const objective = buildProjectQueryObjective(target!, message);
    const providerPath = "lib/ai-orchestrator/src/openai-compatible-client.ts";
    const providerBody = readFileSync(
      path.resolve(process.cwd(), "src/openai-compatible-client.ts"),
      "utf8",
    );
    const evidence: EvidenceReference[] = [{
      source: providerPath,
      excerpt: providerBody.slice(
        providerBody.indexOf("const finishReason"),
        providerBody.indexOf("if (!msg"),
      ),
      supportsClaim: true,
      relevance: 1,
      directness: "DIRECT",
      sourceType: "IMPLEMENTATION",
      productionReachability: "PROVEN",
      evidenceClass: "BEHAVIOR_PROVEN",
    }];

    const contradictions = detectProjectQueryClaimContradictions({
      objective,
      response:
        'Weakness: the provider does not reject finish_reason="error" before tool execution.',
      evidence,
      fileContents: new Map([[providerPath, providerBody]]),
    });

    expect(contradictions).toEqual([{
      claimId: "ai-weakness-analysis",
      reason: expect.stringContaining('finish_reason="error"'),
    }]);
  });

  it("does not reject a response that acknowledges the guard and reports another weakness", () => {
    const message = "Explain how the embedded AI agent works and identify its weaknesses.";
    const target = resolveProjectQueryTarget(message);
    const objective = buildProjectQueryObjective(target!, message);
    const providerPath = "lib/ai-orchestrator/src/openai-compatible-client.ts";
    const providerBody = readFileSync(
      path.resolve(process.cwd(), "src/openai-compatible-client.ts"),
      "utf8",
    );
    const evidence: EvidenceReference[] = [{
      source: providerPath,
      excerpt: providerBody.slice(
        providerBody.indexOf("const finishReason"),
        providerBody.indexOf("if (!msg"),
      ),
      supportsClaim: true,
      relevance: 1,
      directness: "DIRECT",
      sourceType: "IMPLEMENTATION",
      productionReachability: "PROVEN",
      evidenceClass: "BEHAVIOR_PROVEN",
    }];

    const contradictions = detectProjectQueryClaimContradictions({
      objective,
      response:
        'The provider rejects finish_reason="error" before tool execution. A separate weakness is that retry behavior is difficult to observe.',
      evidence,
      fileContents: new Map([[providerPath, providerBody]]),
    });

    expect(contradictions).toEqual([]);
  });

  it("closes every declared execution edge only from the retained production caller", () => {
    const target = resolveProjectQueryTarget("analyze the embedded AI layer");
    const objective = buildProjectQueryObjective(target!, "analyze the embedded AI layer");
    const callerPath = "lib/ai-orchestrator/src/agents/chat-agent.ts";
    const callerBody = readFileSync(
      path.resolve(process.cwd(), "src/agents/chat-agent.ts"),
      "utf8",
    );
    const provenEdges = deriveObjectiveRuntimeEdgesFromRetainedReads({
      objective,
      fileContents: new Map([[callerPath, callerBody]]),
    });

    expect(provenEdges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(
      objective.requiredEvidenceEdges.map((edge) => `${edge.from}->${edge.to}`),
    );
    expect(provenEdges.every((edge) => edge.source === callerPath && edge.evidence)).toBe(true);
  });

  it("recognizes Arabic agent-mechanics questions without requiring the word تحليل", () => {
    expect(resolveProjectQueryTarget("ما هي آلية عمل وكيل الذكاء الاصطناعي؟")?.id)
      .toBe("embedded-ai");
  });

  it("routes the exact Arabic latest-session quality request to the bounded session contract", () => {
    const message =
      "تتبع مسار الجلسة الأخيرة وقم بتقييم مستوى الردود واتساقها لدى الوكيل الداخلى للمشروع";
    const target = resolveProjectQueryTarget(message);
    const objective = buildProjectQueryObjective(target!, message);

    expect(target?.id).toBe("embedded-ai");
    expect(target?.label).toBe("embedded-agent session quality");
    expect(target?.promptHint).toContain("latest non-empty");
    expect(resolveTurnIntent(message).kind).toBe("PROJECT_QUERY");
    expect(objective.requiredClaims.map((claim) => claim.claimId)).toEqual([
      "ai-routing",
      "ai-tool-loop",
      "ai-provider-dispatch",
      "ai-session-history-binding",
      "ai-session-observed-path",
      "ai-response-quality-validation",
      "ai-terminal-projection-parity",
    ]);
    expect(objective.requiredEvidencePaths).toEqual(
      expect.arrayContaining([
        "lib/db/src/schema/ai_chats.ts",
        "lib/ai-orchestrator/src/task-contracts.ts",
        "artifacts/api-server/src/lib/ai-terminal-outcome.ts",
      ]),
    );
  });

  it("routes the Arabic أحدث جلسة and الوكيل المدمج wording to the same session contract", () => {
    const message =
      "تتبع مسار أحدث جلسة للوكيل المدمج داخل EngineeringOS وقم بتقييم مستوى الردود واتساقها";
    const target = resolveProjectQueryTarget(message);
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(target?.id).toBe("embedded-ai");
    expect(target?.label).toBe("embedded-agent session quality");
    expect(classification.projectTarget?.id).toBe("embedded-ai");
    expect(classification.projectTargetResolution).toBe("resolved");
    expect(intent.kind).toBe("PROJECT_QUERY");
    expect(intent.requiresEvidence).toBe(true);
  });

  it("routes Arabic latest-session divergence tracing to the bounded root-cause contract", () => {
    const message = "تتبع مسار الجلسة الأخيرة وتتبع السبب الجذري لحدوث الانحراف";
    const target = resolveProjectQueryTarget(message);
    const objective = buildProjectQueryObjective(target!, message);

    expect(target?.label).toBe("embedded-agent session quality");
    expect(resolveTurnIntent(message).kind).toBe("PROJECT_QUERY");
    expect(objective.requiredClaims.map((claim) => claim.claimId)).toContain(
      "ai-session-divergence-root-cause",
    );
    expect(objective.requiredEvidencePaths).toEqual(
      expect.arrayContaining([
        "lib/db/src/schema/ai_chats.ts",
        "artifacts/api-server/src/lib/ai-terminal-outcome.ts",
      ]),
    );
  });

  it("routes the English equivalent without broad-audit escalation", () => {
    const message =
      "Trace the latest project-agent session and assess response quality and consistency.";
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(classification.projectTarget?.label).toBe("embedded-agent session quality");
    expect(intent.kind).toBe("PROJECT_QUERY");
    expect(intent.requiresEvidence).toBe(true);
    expect(intent.classification.taskType).toBe("BEHAVIOR_QUERY");
  });

  it("does not treat a generic session question as a latest-session quality audit", () => {
    expect(resolveProjectQueryTarget("What happened in the latest session?")).toBeUndefined();
    expect(resolveProjectQueryTarget("راجع الجلسة الأخيرة")).toBeUndefined();
  });

  it("does not route cross-task acceptance coverage to embedded AI", () => {
    const message =
      "تحقق خاص بكل نوع مهمة: acceptance coverage لكل أنواع المهام، مع objective وvalidator وsuccess criteria، بما فيها file conversion وmedia task.";
    expect(isAcceptanceCoverageRequest(message)).toBe(true);
    expect(resolveProjectQueryTarget(message)).toBeUndefined();
    expect(classifyRequest(message).projectTarget).toBeUndefined();
  });

  it("creates a bounded target and objective for an otherwise generic gap question", () => {
    const message = "ما هي الفجوات المتبقية بناءً على التقارير السابقة؟";
    const target = resolveProjectQueryTarget(message);

    expect(target?.id).toBe("gap-analysis");
    expect(target?.requiredEvidencePaths).toContain(
      "lib/ai-orchestrator/src/agents/query-planner.ts",
    );

    const objective = buildProjectQueryObjective(target!, message);
    expect(objective.objectiveType).toBe("PROJECT_QUERY_GAP-ANALYSIS");
    expect(objective.requiredClaims.map((claim) => claim.text)).toEqual([
      "resolveTurnIntent",
      "inferCompoundParts",
      "validateAnalysisEvidenceCompletion",
    ]);
  });

  it("does not weaken broad-audit scope consent for generic gap language", () => {
    expect(resolveProjectQueryTarget("راجع المشروع بالكامل وابحث عن الفجوات")).toBeUndefined();
  });

  it("marks a bounded architecture question unresolved instead of inventing a subsystem", () => {
    const message = "Analyze my project architecture.";
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(classification.projectTarget).toBeUndefined();
    expect(classification.projectTargetResolution).toBe("unresolved");
    expect(intent.projectTargetResolution).toBe("unresolved");
    expect(intent.requiresEvidence).toBe(true);
    expect(intent.kind).toBe("PROJECT_QUERY");
  });

  it("leaves a generic project question as a non-evidence project query", () => {
    const message = "ما هذا المشروع؟";
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(classification.projectTarget).toBeUndefined();
    expect(intent.kind).toBe("PROJECT_QUERY");
    expect(intent.requiresTools).toBe(true);
    expect(intent.requiresEvidence).toBe(false);
  });

  it("keeps a broad Arabic architecture brief on the orientation contract", () => {
    const message =
      "اشرح لي المعمارية الشاملة لمشروع EngineeringOS مع Dashboard وAuthentication وProject Discovery وKnowledge Graph وAI Execution وGovernance، وكل مسارات /api وملفات الإثبات والاستشهادات";
    const target = resolveProjectQueryTarget(message);
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(target).toBeUndefined();
    expect(classification.projectTargetResolution).toBe("not_applicable");
    expect(intent).toMatchObject({
      kind: "PROJECT_QUERY",
      executionTaskType: "tool_chat",
      requiresTools: true,
      requiresEvidence: false,
    });
    expect(intent.projectTarget).toBeUndefined();
  });
});