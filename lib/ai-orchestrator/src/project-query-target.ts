import type { ObjectiveContract } from "./schemas/chat.schema.js";
import { isGapAnalysisRequest } from "./task-contracts.js";

export type ProjectQueryTargetId = "embedded-ai" | "gap-analysis";

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
    evidenceNeedles?: string[];
  }>;
  promptHint: string;
};

/**
 * These are deliberately limited to direct calls made by the production
 * `chat()` orchestrator. The retained-read edge verifier binds each edge to
 * that caller's AST body; imports and same-file symbol co-occurrence cannot
 * close this contract.
 */
const EMBEDDED_AI_EXECUTION_EDGES = [
  {
    from: "lib/ai-orchestrator/src/agents/chat-agent.ts#chat",
    to: "lib/ai-orchestrator/src/turn-intent.ts#resolveTurnIntent",
    relationship: "DIRECT_INVOCATION",
  },
  {
    from: "lib/ai-orchestrator/src/agents/chat-agent.ts#chat",
    to: "lib/ai-orchestrator/src/tool-execution-engine.ts#executeToolLoop",
    relationship: "DIRECT_INVOCATION",
  },
  {
    from: "lib/ai-orchestrator/src/agents/chat-agent.ts#chat",
    to: "lib/ai-orchestrator/src/provider-strategy.ts#call",
    relationship: "DIRECT_INVOCATION",
  },
  {
    from: "lib/ai-orchestrator/src/agents/chat-agent.ts#chat",
    to: "lib/ai-orchestrator/src/provider-strategy.ts#stream",
    relationship: "DIRECT_INVOCATION",
  },
  {
    from: "lib/ai-orchestrator/src/agents/chat-agent.ts#chat",
    to: "lib/ai-orchestrator/src/agents/chat-agent.ts#finalizeObjectiveAndStream",
    relationship: "DIRECT_INVOCATION",
  },
  {
    from: "lib/ai-orchestrator/src/agents/chat-agent.ts#chat",
    to: "lib/ai-orchestrator/src/evidence-integrity.ts#validateFinalAnswer",
    relationship: "DIRECT_INVOCATION",
  },
] as const;

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
      text: "The chat route resolves the turn intent before selecting the execution path.",
      requiredEvidencePaths: [
        "artifacts/api-server/src/routes/ai/chat.ts",
        "lib/ai-orchestrator/src/turn-intent.ts",
      ],
      evidenceNeedles: ["resolveTurnIntent", "turnIntent"],
    },
    {
      claimId: "ai-tool-loop",
      text: "The tool-enabled chat execution enters executeToolLoop and retains its tool results before synthesis.",
      requiredEvidencePaths: [
        "lib/ai-orchestrator/src/agents/chat-agent.ts",
      ],
      evidenceNeedles: ["executeToolLoop", "loopResult"],
    },
    {
      claimId: "ai-provider-dispatch",
      text: "The route dispatches provider requests through chatWithFallback before final response validation.",
      requiredEvidencePaths: [
        "artifacts/api-server/src/routes/ai/chat.ts",
      ],
      evidenceNeedles: ["chatWithFallback", "provider"],
    },
  ],
  promptHint:
    "Targeted project analysis: analyze the embedded AI layer end to end. " +
    "Read and explicitly cover the server-owned behavioral claims for routing, the tool loop, " +
    "provider dispatch, and acceptance with their source paths before synthesizing. " +
    "Prove the retained production execution edges for intent routing, tool execution, " +
    "provider dispatch, synthesis/finalization, and final validation before calling the answer proven. " +
    "State each claim assertion verbatim, then explain the sequence in the requested language. " +
    "If the goal asks for weaknesses, also state the verified weakness claim about " +
    "finish_reason=\"error\" and explain why it must be rejected before tool execution. " +
    "Separate verified weakness evidence from hypotheses. Do not stop at a symbol inventory, " +
    "one provider client, or a generic project-access explanation.",
};

const EMBEDDED_AI_WEAKNESS_CLAIM = {
  claimId: "ai-weakness-analysis",
  text:
    'The provider boundary must reject finish_reason="error" before tool execution; ' +
    "otherwise content or tool calls can make an error-shaped response look successful.",
  requiredEvidencePaths: [
    "lib/ai-orchestrator/src/openai-compatible-client.ts",
    "lib/ai-orchestrator/src/tool-execution-engine.ts",
  ],
  evidenceNeedles: ["finishReason", "executeToolLoop"],
};

const GAP_ANALYSIS_TARGET: Omit<ProjectQueryTarget, "confidence"> = {
  id: "gap-analysis",
  label: "verified project gaps",
  firstEvidencePath: "lib/ai-orchestrator/src/turn-intent.ts",
  primaryPaths: [
    "lib/ai-orchestrator/src/turn-intent.ts",
    "lib/ai-orchestrator/src/agents/query-planner.ts",
    "artifacts/api-server/src/routes/ai/chat.ts",
    "artifacts/api-server/src/lib/ai-execution-state.ts",
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
    "lib/ai-orchestrator/src/turn-intent.ts",
    "lib/ai-orchestrator/src/agents/query-planner.ts",
    "artifacts/api-server/src/routes/ai/chat.ts",
    "artifacts/api-server/src/lib/ai-execution-state.ts",
  ],
  requiredClaims: [
    {
      claimId: "gap-routing",
      text: "resolveTurnIntent",
      requiredEvidencePaths: [
        "lib/ai-orchestrator/src/turn-intent.ts",
      ],
    },
    {
      claimId: "gap-planning",
      text: "inferCompoundParts",
      requiredEvidencePaths: [
        "lib/ai-orchestrator/src/agents/query-planner.ts",
      ],
    },
    {
      claimId: "gap-acceptance",
      text: "validateAnalysisEvidenceCompletion",
      requiredEvidencePaths: [
        "artifacts/api-server/src/routes/ai/chat.ts",
        "artifacts/api-server/src/lib/ai-execution-state.ts",
      ],
    },
  ],
  promptHint:
    "Targeted project gap analysis: identify only gaps supported by retained source evidence. " +
    "Read the routing, query-planning, and semantic-acceptance paths before synthesizing. " +
    "Separate verified gaps from unverified hypotheses and cite every gap to its source path.",
};

const BROAD_GAP_REQUEST_RE =
  /(?:\b(?:full|complete|comprehensive|entire|whole|repository|workspace|codebase|audit|review)\b|(?:تدقيق|دقق|شامل|بالكامل|كل\s+(?:المشروع|الكود)))/iu;

function materializeTarget(
  target: Omit<ProjectQueryTarget, "confidence">,
  confidence: number,
): ProjectQueryTarget {
  return {
    ...target,
    confidence,
    primaryPaths: [...target.primaryPaths],
    allowedExpansionPaths: [...target.allowedExpansionPaths],
    forbiddenPaths: [...target.forbiddenPaths],
    requiredEvidencePaths: [...target.requiredEvidencePaths],
    requiredClaims: target.requiredClaims.map((claim) => ({
      ...claim,
      requiredEvidencePaths: [...(claim.requiredEvidencePaths ?? [])],
    })),
  };
}

export function resolveProjectQueryTarget(message: string): ProjectQueryTarget | undefined {
  const aiSignal =
    /(?:الذكاء\s+الاصطناعي|ذكاء\s+اصطناعي|طبقة\s+(?:ال)?الذكاء\s+الاصطناعي|\bAI\b|\bLLM\b|provider|orchestrator|chat\s+agent|نموذج\s+الذكاء)/iu;
  const targetScopeSignal =
    /(?:تحليل|حلل|طبقة|داخل\s+المشروع|المشروع|embedded|integrated|architecture|layer|analy[sz]|trace|flow|وكيل|الوكيل|آلية\s+عمل|سلوك\s+الوكيل|كيف\s+يعمل)/iu;
  if (!aiSignal.test(message) || !targetScopeSignal.test(message)) {
    if (!isGapAnalysisRequest(message) || BROAD_GAP_REQUEST_RE.test(message)) {
      return undefined;
    }
    return materializeTarget(GAP_ANALYSIS_TARGET, 0.9);
  }
  return materializeTarget(EMBEDDED_AI_TARGET, 0.98);
}

export function buildProjectQueryObjective(
  target: ProjectQueryTarget,
  goal: string,
): ObjectiveContract {
  const requiredClaims = target.requiredClaims.map((claim) => ({
    claimId: claim.claimId,
    text: claim.text,
    requiredEvidencePaths: [...claim.requiredEvidencePaths],
    ...(claim.evidenceNeedles ? { evidenceNeedles: [...claim.evidenceNeedles] } : {}),
  }));
  const weaknessRequested = target.id === "embedded-ai" && isGapAnalysisRequest(goal);
  if (weaknessRequested) {
    requiredClaims.push({
      claimId: EMBEDDED_AI_WEAKNESS_CLAIM.claimId,
      text: EMBEDDED_AI_WEAKNESS_CLAIM.text,
      requiredEvidencePaths: [...EMBEDDED_AI_WEAKNESS_CLAIM.requiredEvidencePaths],
      evidenceNeedles: [...EMBEDDED_AI_WEAKNESS_CLAIM.evidenceNeedles],
    });
  }
  const requiredEvidencePaths = new Set(target.requiredEvidencePaths);
  for (const claim of requiredClaims) {
    for (const path of claim.requiredEvidencePaths) requiredEvidencePaths.add(path);
  }
  return {
    objectiveType: `PROJECT_QUERY_${target.id.toUpperCase()}`,
    requiredEvidencePaths: [...requiredEvidencePaths],
    requiredClaims,
    requiredEvidenceEdges: EMBEDDED_AI_EXECUTION_EDGES.map((edge) => ({ ...edge })),
    scopePolicy: {
      primaryPaths: [...target.primaryPaths],
      allowedExpansionPaths: [...target.allowedExpansionPaths],
      forbiddenPaths: [...target.forbiddenPaths],
    },
    // Keep the user goal available to the objective-aware tool loop.
    ...(goal.trim() ? { goal: goal.trim() } : {}),
  } as ObjectiveContract;
}