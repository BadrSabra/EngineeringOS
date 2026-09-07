import type { ObjectiveContract } from "./schemas/chat.schema.js";

export type ProjectQueryTargetId = "embedded-ai";

export type ProjectQueryTarget = {
  id: ProjectQueryTargetId;
  label: string;
  confidence: number;
  firstEvidencePath: string;
  primaryPaths: string[];
  allowedExpansionPaths: string[];
  forbiddenPaths: string[];
  requiredEvidencePaths: string[];
  requiredClaims: Array<{
    claimId: string;
    text: string;
    requiredEvidencePaths: string[];
  }>;
  promptHint: string;
};

const EMBEDDED_AI_TARGET: Omit<ProjectQueryTarget, "confidence"> = {
  id: "embedded-ai",
  label: "embedded AI layer",
  firstEvidencePath: "artifacts/api-server/src/routes/ai/chat.ts",
  primaryPaths: [
    "artifacts/api-server/src/routes/ai/chat.ts",
    "artifacts/api-server/src/lib/ai-execution-state.ts",
    "artifacts/api-server/src/lib/ai-execution-acceptance.ts",
    "lib/ai-orchestrator/src/turn-intent.ts",
    "lib/ai-orchestrator/src/agents/chat-agent.ts",
  ],
  allowedExpansionPaths: [
    "lib/ai-orchestrator/src",
    "artifacts/api-server/src/routes/ai",
    "artifacts/api-server/src/lib",
  ],
  forbiddenPaths: [
    "node_modules",
    "dist",
    "build",
  ],
  requiredEvidencePaths: [
    "artifacts/api-server/src/routes/ai/chat.ts",
    "lib/ai-orchestrator/src/turn-intent.ts",
    "lib/ai-orchestrator/src/agents/chat-agent.ts",
  ],
  requiredClaims: [
    {
      claimId: "ai-routing",
      text: "resolveTurnIntent",
      requiredEvidencePaths: [
        "artifacts/api-server/src/routes/ai/chat.ts",
        "lib/ai-orchestrator/src/turn-intent.ts",
      ],
    },
    {
      claimId: "ai-tool-loop",
      text: "executeToolLoop",
      requiredEvidencePaths: [
        "lib/ai-orchestrator/src/agents/chat-agent.ts",
      ],
    },
    {
      claimId: "ai-provider-dispatch",
      text: "chatWithFallback",
      requiredEvidencePaths: [
        "artifacts/api-server/src/routes/ai/chat.ts",
      ],
    },
  ],
  promptHint:
    "Targeted project analysis: analyze the embedded AI layer end to end. " +
    "Read and explicitly cover resolveTurnIntent, chatWithFallback, and executeToolLoop " +
    "with their source paths before synthesizing. Do not stop at one provider client or a generic project-access explanation.",
};

export function resolveProjectQueryTarget(message: string): ProjectQueryTarget | undefined {
  const aiSignal =
    /(?:الذكاء\s+الاصطناعي|ذكاء\s+اصطناعي|طبقة\s+(?:ال)?الذكاء\s+الاصطناعي|\bAI\b|\bLLM\b|provider|orchestrator|chat\s+agent|نموذج\s+الذكاء)/iu;
  const targetScopeSignal =
    /(?:تحليل|حلل|طبقة|داخل\s+المشروع|المشروع|embedded|integrated|architecture|layer|analy[sz]|trace|flow)/iu;
  if (!aiSignal.test(message) || !targetScopeSignal.test(message)) {
    return undefined;
  }
  return {
    ...EMBEDDED_AI_TARGET,
    confidence: 0.98,
    primaryPaths: [...EMBEDDED_AI_TARGET.primaryPaths],
    allowedExpansionPaths: [...EMBEDDED_AI_TARGET.allowedExpansionPaths],
    forbiddenPaths: [...EMBEDDED_AI_TARGET.forbiddenPaths],
    requiredEvidencePaths: [...EMBEDDED_AI_TARGET.requiredEvidencePaths],
    requiredClaims: EMBEDDED_AI_TARGET.requiredClaims.map((claim) => ({
      ...claim,
      requiredEvidencePaths: [...claim.requiredEvidencePaths],
    })),
  };
}

export function buildProjectQueryObjective(
  target: ProjectQueryTarget,
  goal: string,
): ObjectiveContract {
  return {
    objectiveType: `PROJECT_QUERY_${target.id.toUpperCase()}`,
    requiredEvidencePaths: [...target.requiredEvidencePaths],
    requiredClaims: target.requiredClaims.map((claim) => ({
      claimId: claim.claimId,
      text: claim.text,
      requiredEvidencePaths: [...claim.requiredEvidencePaths],
    })),
    requiredEvidenceEdges: [],
    scopePolicy: {
      primaryPaths: [...target.primaryPaths],
      allowedExpansionPaths: [...target.allowedExpansionPaths],
      forbiddenPaths: [...target.forbiddenPaths],
    },
    // Keep the user goal available to the objective-aware tool loop.
    ...(goal.trim() ? { goal: goal.trim() } : {}),
  } as ObjectiveContract;
}