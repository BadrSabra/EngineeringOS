import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildProjectQueryObjective,
  classifyRequest,
  detectProjectQueryClaimContradictions,
  resolveProjectQueryTarget,
  resolveTurnIntent,
} from "../index.js";
import { deriveObjectiveRuntimeEdgesFromRetainedReads } from "../evidence-integrity.js";
import type { EvidenceReference } from "../task-contracts.js";

describe("target-aware project queries", () => {
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

  it("leaves a generic project question as a non-evidence project query", () => {
    const message = "ما هذا المشروع؟";
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(classification.projectTarget).toBeUndefined();
    expect(intent.kind).toBe("PROJECT_QUERY");
    expect(intent.requiresTools).toBe(true);
    expect(intent.requiresEvidence).toBe(false);
  });
});