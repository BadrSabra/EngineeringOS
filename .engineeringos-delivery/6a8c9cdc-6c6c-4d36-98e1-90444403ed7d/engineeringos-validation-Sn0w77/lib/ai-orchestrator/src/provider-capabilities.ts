/**
 * Provider capability helpers.
 *
 * This layer keeps provider selection logic declarative without forcing the
 * rest of the orchestrator to know the provider-specific transport details.
 */

export type ProviderCostTier = "low" | "medium" | "high";

export type ProviderCapabilitySummary = {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsJsonMode: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportsFunctionCalling: boolean;
  supportsThinking: boolean;
  maxContext: number | null;
  maxOutput: number | null;
  costTier: ProviderCostTier;
};

export type ProviderCapabilityHints = {
  requireStreaming?: boolean;
  requireTools?: boolean;
  requireJsonMode?: boolean;
  requireVision?: boolean;
  requireReasoning?: boolean;
  requireFunctionCalling?: boolean;
  requireThinking?: boolean;
  minimumContext?: number;
  minimumOutput?: number;
  preferredCostTier?: ProviderCostTier;
};

export const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilitySummary = {
  supportsStreaming: false,
  supportsTools: false,
  supportsJsonMode: false,
  supportsVision: false,
  supportsReasoning: false,
  supportsFunctionCalling: false,
  supportsThinking: false,
  maxContext: null,
  maxOutput: null,
  costTier: "medium",
};

export function providerMatchesHints(
  capabilities: ProviderCapabilitySummary,
  hints?: ProviderCapabilityHints,
): boolean {
  if (!hints) return true;
  if (hints.requireStreaming && !capabilities.supportsStreaming) return false;
  if (hints.requireTools && !capabilities.supportsTools) return false;
  if (hints.requireJsonMode && !capabilities.supportsJsonMode) return false;
  if (hints.requireVision && !capabilities.supportsVision) return false;
  if (hints.requireReasoning && !capabilities.supportsReasoning) return false;
  if (hints.requireFunctionCalling && !capabilities.supportsFunctionCalling) return false;
  if (hints.requireThinking && !capabilities.supportsThinking) return false;
  if (hints.minimumContext != null) {
    if (capabilities.maxContext == null || capabilities.maxContext < hints.minimumContext) return false;
  }
  if (hints.minimumOutput != null) {
    if (capabilities.maxOutput == null || capabilities.maxOutput < hints.minimumOutput) return false;
  }
  return true;
}

export function scoreProviderCapabilities(
  capabilities: ProviderCapabilitySummary,
  hints?: ProviderCapabilityHints,
): number {
  if (!hints) return 0;
  let score = 0;
  if (hints.requireStreaming) score += capabilities.supportsStreaming ? 10 : -1000;
  if (hints.requireTools) score += capabilities.supportsTools ? 10 : -1000;
  if (hints.requireJsonMode) score += capabilities.supportsJsonMode ? 6 : -1000;
  if (hints.requireVision) score += capabilities.supportsVision ? 6 : -1000;
  if (hints.requireReasoning) score += capabilities.supportsReasoning ? 6 : -1000;
  if (hints.requireFunctionCalling) score += capabilities.supportsFunctionCalling ? 6 : -1000;
  if (hints.requireThinking) score += capabilities.supportsThinking ? 6 : -1000;
  if (hints.minimumContext != null && capabilities.maxContext != null) {
    score += Math.min(12, Math.floor(capabilities.maxContext / Math.max(hints.minimumContext, 1)));
  }
  if (hints.minimumOutput != null && capabilities.maxOutput != null) {
    score += Math.min(6, Math.floor(capabilities.maxOutput / Math.max(hints.minimumOutput, 1)));
  }
  if (hints.preferredCostTier) {
    const rank: Record<ProviderCostTier, number> = { low: 3, medium: 2, high: 1 };
    score += rank[capabilities.costTier] >= rank[hints.preferredCostTier] ? 2 : 0;
  }
  return score;
}
