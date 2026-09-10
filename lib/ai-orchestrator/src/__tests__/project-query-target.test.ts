import { describe, expect, it } from "vitest";
import {
  buildProjectQueryObjective,
  classifyRequest,
  resolveProjectQueryTarget,
  resolveTurnIntent,
} from "../index.js";

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
      "resolveTurnIntent",
      "executeToolLoop",
      "chatWithFallback",
    ]);
    expect(objective.scopePolicy?.forbiddenPaths).toContain("node_modules");
  });

  it("recognizes Arabic agent-mechanics questions without requiring the word تحليل", () => {
    expect(resolveProjectQueryTarget("ما هي آلية عمل وكيل الذكاء الاصطناعي؟")?.id)
      .toBe("embedded-ai");
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