import type { ObjectiveContract } from "./schemas/chat.schema.js";
import {
  isGapAnalysisRequest,
  type EvidenceReference,
} from "./task-contracts.js";

export type ProjectQueryTargetId = "embedded-ai" | "gap-analysis";
export type ProjectQueryTargetResolution =
  | "resolved"
  | "unresolved"
  | "not_applicable";

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
    evidenceNeedlesByPath?: Record<string, string[]>;
  }>;
  promptHint: string;
};

const SESSION_QUALITY_LATEST_RE =
  /(?:\b(?:latest|most\s+recent)(?:[-\s]+\w+){0,3}\s+session\b|آخر\s+(?:جلسة|جلسه)|الجلسة\s+(?:الأخيرة|الاخيرة))/iu;
const SESSION_QUALITY_AGENT_RE =
  /(?:\b(?:internal|embedded)\s+(?:AI\s+)?agent\b|\bproject[-\s]agent\b|\bagent\s+(?:of|inside)\s+the\s+project\b|الوكيل\s+(?:الداخلي|الداخلى)\s+(?:للمشروع|داخل\s+المشروع)|وكيل\s+المشروع)/iu;
const SESSION_QUALITY_DIMENSIONS_RE =
  /(?:\b(?:response|answer)\s+quality\b|\bquality\s+of\s+(?:the\s+)?responses?\b|\bconsistency\b|\bconsistent\b|\broot\s+cause\b|\bdivergence\b|\bdeviation\b|جودة\s+(?:الردود|الإجابات)|مستوى\s+(?:الردود|الإجابات)|اتساق(?:ها|هما|الردود|الإجابات)?|السبب\s+الجذري|الانحراف|الانحرافات)/iu;
const SESSION_QUALITY_DIVERGENCE_RE =
  /(?:\broot\s+cause\b|\bdivergence\b|\bdeviation\b|السبب\s+الجذري|الانحراف|الانحرافات)/iu;
const SESSION_QUALITY_TRACE_RE =
  /(?:\b(?:trace|track|follow)\s+(?:the\s+)?(?:path|flow)\b|تتبع\s+مسار|تتبّع\s+مسار)/iu;

/**
 * This is intentionally narrower than a generic session question. It requires
 * a latest-session binding, an embedded project-agent reference, and an
 * explicit quality/consistency deliverable. Generic questions about sessions
 * remain ordinary project queries or chat.
 */
export function isSessionQualityAuditRequest(message: string): boolean {
  const latestSession = SESSION_QUALITY_LATEST_RE.test(message);
  const qualityAudit =
    SESSION_QUALITY_AGENT_RE.test(message)
    && SESSION_QUALITY_DIMENSIONS_RE.test(message);
  const divergenceAudit =
    SESSION_QUALITY_TRACE_RE.test(message)
    && SESSION_QUALITY_DIVERGENCE_RE.test(message);
  return latestSession && (qualityAudit || divergenceAudit);
}

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
    "lib/db/src/schema",
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
  evidenceNeedlesByPath: {
    "lib/ai-orchestrator/src/openai-compatible-client.ts": ["finishReason"],
    "lib/ai-orchestrator/src/tool-execution-engine.ts": ["executeToolLoop"],
  },
};

const SESSION_QUALITY_CLAIMS: ProjectQueryTarget["requiredClaims"] = [
  {
    claimId: "ai-session-history-binding",
    text:
      "The latest-session quality audit is bound to a non-empty project-scoped chat session before history is loaded and does not fall back to a new blank session.",
    requiredEvidencePaths: [
      "artifacts/api-server/src/routes/ai/chat.ts",
    ],
    evidenceNeedles: [
      "resolveLatestProjectChatSession",
      "historyRows",
      "sessionIdToUse",
    ],
  },
  {
    claimId: "ai-session-observed-path",
    text:
      "The persisted chat turn retains the observed message, intent, tool/evidence trace, execution identity, and terminal outcome as separate server-owned fields.",
    requiredEvidencePaths: [
      "artifacts/api-server/src/routes/ai/chat.ts",
      "lib/db/src/schema/ai_chats.ts",
    ],
    evidenceNeedlesByPath: {
      "artifacts/api-server/src/routes/ai/chat.ts": [
        "toolTrace",
        "executionId",
        "outcome",
      ],
      "lib/db/src/schema/ai_chats.ts": [
        "toolTrace",
        "executionId",
        "outcome",
      ],
    },
  },
  {
    claimId: "ai-response-quality-validation",
    text:
      "Response quality and language/contract checks are server-owned and run before the turn is finalized.",
    requiredEvidencePaths: [
      "lib/ai-orchestrator/src/task-contracts.ts",
      "lib/ai-orchestrator/src/agents/chat-agent.ts",
    ],
    evidenceNeedlesByPath: {
      "lib/ai-orchestrator/src/task-contracts.ts": [
        "validateResponseLanguage",
        "TaskValidationResult",
      ],
      "lib/ai-orchestrator/src/agents/chat-agent.ts": [
        "_qualityError",
        "validateFinalAnswer",
      ],
    },
  },
  {
    claimId: "ai-terminal-projection-parity",
    text:
      "Direct JSON, streamed SSE, persisted messages, and history reloads use the same server-owned session and terminal outcome identity.",
    requiredEvidencePaths: [
      "artifacts/api-server/src/routes/ai/chat.ts",
      "artifacts/api-server/src/lib/ai-terminal-outcome.ts",
      "lib/db/src/schema/ai_chats.ts",
    ],
    evidenceNeedlesByPath: {
      "artifacts/api-server/src/routes/ai/chat.ts": [
        "serializeAiSseEvent",
        "persistFailedChatTurn",
        "terminalProjection",
      ],
      "artifacts/api-server/src/lib/ai-terminal-outcome.ts": [
        "AiTerminalProjection",
        "outcome",
      ],
      "lib/db/src/schema/ai_chats.ts": [
        "sessionId",
        "outcome",
        "executionId",
      ],
    },
  },
];

const SESSION_DIVERGENCE_CLAIMS: ProjectQueryTarget["requiredClaims"] = [
  {
    claimId: "ai-session-divergence-root-cause",
    text:
      "The first session divergence and its root cause are identified by comparing the server-owned intent, history/tool/evidence trace, execution identity, and terminal outcome; unsupported causal explanations remain hypotheses.",
    requiredEvidencePaths: [
      "artifacts/api-server/src/routes/ai/chat.ts",
      "lib/ai-orchestrator/src/turn-intent.ts",
      "lib/ai-orchestrator/src/agents/chat-agent.ts",
      "lib/db/src/schema/ai_chats.ts",
      "artifacts/api-server/src/lib/ai-terminal-outcome.ts",
    ],
    evidenceNeedlesByPath: {
      "artifacts/api-server/src/routes/ai/chat.ts": [
        "resolvedTurnIntent",
        "analysisCorrelation",
        "sessionIdToUse",
      ],
      "lib/ai-orchestrator/src/turn-intent.ts": [
        "resolveTurnIntent",
        "TurnIntent",
      ],
      "lib/ai-orchestrator/src/agents/chat-agent.ts": [
        "executeToolLoop",
        "validateFinalAnswer",
      ],
      "lib/db/src/schema/ai_chats.ts": [
        "toolTrace",
        "executionId",
        "outcome",
      ],
      "artifacts/api-server/src/lib/ai-terminal-outcome.ts": [
        "AiTerminalProjection",
        "sessionId",
        "executionId",
      ],
    },
  },
];

const SESSION_QUALITY_PROMPT_HINT =
  "Targeted embedded-agent session-quality analysis: bind the audit to the latest non-empty " +
  "project-scoped session before reading its history. Explain the observed message, intent, " +
  "tool/evidence, execution, and terminal sequence separately from response-quality and " +
  "consistency findings. When divergence or root-cause tracing is requested, identify the " +
  "first server-observed divergence before proposing a cause. Compare direct JSON, streamed SSE, persisted message, and history " +
  "projections only from server-owned evidence. Keep verified observations, limitations, " +
  "and unverified hypotheses separate, and return ANALYSIS_INCOMPLETE when any required " +
  "session, quality, or projection claim is not proven. Use the requested language.";

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

const AMBIGUOUS_PROJECT_SCOPE_RE =
  /(?:\b(?:project|workspace|repository|repo|codebase|system|architecture|module|service|component|layer|workflow|pipeline|flow|function|class|handler|endpoint|implementation|source|code)\b|مشروع|المشروع|المستودع|الريبو|قاعدة\s+(?:الكود|الشفرة|المصدر)|النظام|المعمارية|الهندسة|الوحدة|الخدمة|المكوّن|المكون|الطبقة|سير\s+العمل|التدفق|الدالة|الفئة|المعالج|النقطة|التنفيذ|المصدر|الكود|الشفرة)/iu;

const AMBIGUOUS_PROJECT_ANALYSIS_RE =
  /(?:\b(?:analy[sz]e|analysis|review|assess|explain|describe|understand|trace|investigate|how|why|what)\b|تحليل|حلل|حلّل|راجع|مراجعة|قيّم|قيم|اشرح|شرح|صف|افهم|فهم|تتبع|تحقيق|كيف|لماذا|ما(?:ذا)?|أين)/iu;

const PROJECT_ORIENTATION_RE =
  /^(?:ما(?:\s+هو)?\s+(?:اسم\s+)?(?:هذا\s+)?المشروع|ماذا\s+(?:يفعل|يقدم|يحتوي)\s+(?:هذا\s+)?المشروع|عن\s+ماذا\s+يدور\s+(?:هذا\s+)?المشروع|[اأ]شرح(?:\s+لي)?\s+(?:هذا\s+)?المشروع(?:\s+(?:بصورة\s+)?(?:مبسطة|ببساطة))?|ساعدني(?:\s+في)?\s+(?:فهم|أفهم)(?:\s+هذا)?\s+المشروع|ممكن\s+تساعدني(?:\s+أن)?\s+(?:أفهم\s+)?المشروع|هل\s+(?:هذا\s+)?المشروع\s+(?:شغال|يعمل)(?:\s+حاليًا)?|what(?:'s| is)\s+(?:the\s+)?(?:this\s+)?project(?:'s\s+name|\s+status)?|what\s+does\s+(?:this\s+)?project\s+do|(?:explain|describe)\s+(?:this\s+)?project|help\s+me\s+understand\s+(?:this\s+)?project|is\s+(?:this\s+)?project\s+running|(?:ما|ماذا)\s+(?:هي|هو)?\s*(?:حالة|وضع)\s+(?:هذا\s+)?المشروع)[؟?!.\s]*$/iu;

/**
 * An evidence-shaped question can still lack a safe subsystem target. Keep
 * this detector conservative: broad audits retain their separate consent
 * boundary, while a bounded project/architecture question enters the
 * source-first evidence path instead of being answered from the graph alone.
 */
export function isAmbiguousProjectQuery(message: string): boolean {
  if (BROAD_GAP_REQUEST_RE.test(message)) return false;
  if (PROJECT_ORIENTATION_RE.test(message.trim())) return false;
  if (resolveProjectQueryTarget(message)) return false;
  if (
    /(?:^|[\s`"'(])(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html)\b/iu.test(
      message,
    )
  ) {
    return false;
  }
  return (
    AMBIGUOUS_PROJECT_SCOPE_RE.test(message) &&
    AMBIGUOUS_PROJECT_ANALYSIS_RE.test(message)
  );
}

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
  if (isSessionQualityAuditRequest(message)) {
    return materializeTarget(
      {
        ...EMBEDDED_AI_TARGET,
        label: "embedded-agent session quality",
        promptHint: SESSION_QUALITY_PROMPT_HINT,
      },
      0.99,
    );
  }
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

export function resolveProjectQueryTargetResolution(
  message: string,
): ProjectQueryTargetResolution {
  return resolveProjectQueryTarget(message)
    ? "resolved"
    : isAmbiguousProjectQuery(message)
      ? "unresolved"
      : "not_applicable";
}

export function buildProjectQueryObjective(
  target: ProjectQueryTarget,
  goal: string,
): ObjectiveContract {
  const requiredClaims: ProjectQueryTarget["requiredClaims"] = target.requiredClaims.map((claim) => ({
    claimId: claim.claimId,
    text: claim.text,
    requiredEvidencePaths: [...claim.requiredEvidencePaths],
    ...(claim.evidenceNeedles ? { evidenceNeedles: [...claim.evidenceNeedles] } : {}),
    ...(claim.evidenceNeedlesByPath
      ? {
          evidenceNeedlesByPath: Object.fromEntries(
            Object.entries(claim.evidenceNeedlesByPath).map(
              ([path, needles]) => [path, [...needles]],
            ),
          ),
        }
      : {}),
  }));
  if (isSessionQualityAuditRequest(goal)) {
    for (const claim of SESSION_QUALITY_CLAIMS) {
      requiredClaims.push({
        claimId: claim.claimId,
        text: claim.text,
        requiredEvidencePaths: [...claim.requiredEvidencePaths],
        ...(claim.evidenceNeedles ? { evidenceNeedles: [...claim.evidenceNeedles] } : {}),
        ...(claim.evidenceNeedlesByPath
          ? {
              evidenceNeedlesByPath: Object.fromEntries(
                Object.entries(claim.evidenceNeedlesByPath).map(
                  ([path, needles]) => [path, [...needles]],
                ),
              ),
            }
          : {}),
      });
    }
    if (
      SESSION_QUALITY_TRACE_RE.test(goal)
      && SESSION_QUALITY_DIVERGENCE_RE.test(goal)
    ) {
      for (const claim of SESSION_DIVERGENCE_CLAIMS) {
        requiredClaims.push({
          claimId: claim.claimId,
          text: claim.text,
          requiredEvidencePaths: [...claim.requiredEvidencePaths],
          ...(claim.evidenceNeedles ? { evidenceNeedles: [...claim.evidenceNeedles] } : {}),
          ...(claim.evidenceNeedlesByPath
            ? {
                evidenceNeedlesByPath: Object.fromEntries(
                  Object.entries(claim.evidenceNeedlesByPath).map(
                    ([path, needles]) => [path, [...needles]],
                  ),
                ),
              }
            : {}),
        });
      }
    }
  }
  const weaknessRequested = target.id === "embedded-ai" && isGapAnalysisRequest(goal);
  if (weaknessRequested) {
    requiredClaims.push({
      claimId: EMBEDDED_AI_WEAKNESS_CLAIM.claimId,
      text: EMBEDDED_AI_WEAKNESS_CLAIM.text,
      requiredEvidencePaths: [...EMBEDDED_AI_WEAKNESS_CLAIM.requiredEvidencePaths],
      evidenceNeedlesByPath: Object.fromEntries(
        Object.entries(EMBEDDED_AI_WEAKNESS_CLAIM.evidenceNeedlesByPath).map(
          ([path, needles]) => [path, [...needles]],
        ),
      ),
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

export type ProjectQueryClaimContradiction = {
  claimId: string;
  reason: string;
};

function normalizeProjectSourcePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

/**
 * This is deliberately structural rather than a keyword-only check. The
 * source must show the finish-reason extraction, an explicit error comparison,
 * and the provider-response rejection in that order. A response is
 * contradictory only when it also makes a scoped negative assertion about
 * that guard in the same sentence/paragraph.
 */
function sourceProvesFinishReasonGuard(source: string): boolean {
  const binding = source.search(
    /\b(?:const|let|var)\s+finishReason\s*=[\s\S]{0,160}\bfinish_reason\b/,
  );
  const comparison = source.search(
    /\bif\s*\(\s*finishReason\s*===\s*["']error["']\s*\)/,
  );
  const rejection = source.search(
    /\bthrow\s+new\b[\s\S]{0,180}\bINVALID_PROVIDER_RESPONSE\b/,
  );
  return binding >= 0
    && comparison > binding
    && rejection > comparison;
}

function responseDeniesFinishReasonGuard(response: string): boolean {
  const concept =
    /\b(?:finish[_\s]?reason|finishReason|error[-\s]?shaped\s+response)\b/iu;
  const units = response
    .split(/(?:\r?\n){2,}|(?<=[.!?؟])\s+/u)
    .map((unit) => unit.trim())
    .filter(Boolean);

  return units.some((unit) => {
    if (!concept.test(unit)) return false;
    const deniesGuard =
      /(?:does\s+not|doesn't|did\s+not|didn't|fails?\s+to|failed\s+to|never|without|missing|absent|lacks?|lack\s+of|absence\s+of|no)\b[\s\S]{0,120}\b(?:reject|check|handle|process|validate|guard|throw)\b/iu.test(unit)
      || /\b(?:reject|check|handle|process|validate|guard|throw)\b[\s\S]{0,120}(?:does\s+not|doesn't|did\s+not|didn't|fails?\s+to|failed\s+to|never|without|missing|absent|lacks?|lack\s+of|absence\s+of|no)\b/iu.test(unit)
      || /(?:لا|لم|ليس|غير|يفتقد|غياب|عدم(?:\s+وجود)?|لا\s+(?:يوجد|توجد|يتم))[\s\S]{0,120}(?:فحص|تحقق|رفض|معالجة|حماية|يتعامل|يتحقق|يرفض)/u.test(unit)
      || /(?:فحص|تحقق|رفض|معالجة|حماية|يتعامل|يتحقق|يرفض)[\s\S]{0,120}(?:لا|لم|ليس|غير|يفتقد|غياب|عدم(?:\s+وجود)?)/u.test(unit);
    return deniesGuard;
  });
}

export function detectProjectQueryClaimContradictions(input: {
  objective: ObjectiveContract;
  response: string;
  evidence?: readonly EvidenceReference[];
  fileContents: ReadonlyMap<string, string>;
}): ProjectQueryClaimContradiction[] {
  if (!input.objective.objectiveType.startsWith("PROJECT_QUERY_")) return [];
  const weaknessClaim = input.objective.requiredClaims.find(
    (claim) => claim.claimId === "ai-weakness-analysis",
  );
  if (!weaknessClaim || !responseDeniesFinishReasonGuard(input.response)) return [];

  const providerPath = "lib/ai-orchestrator/src/openai-compatible-client.ts";
  const acceptedProviderEvidence = (input.evidence ?? []).some(
    (item) =>
      item.supportsClaim
      && normalizeProjectSourcePath(item.source) === providerPath
      && Boolean(item.excerpt?.trim()),
  );
  if (!acceptedProviderEvidence) return [];

  const providerBody = input.fileContents.get(providerPath) ?? "";
  if (!sourceProvesFinishReasonGuard(providerBody)) return [];

  return [{
    claimId: weaknessClaim.claimId,
    reason:
      'accepted source evidence proves finish_reason="error" is rejected before tool execution, but the answer asserts that this guard is absent',
  }];
}