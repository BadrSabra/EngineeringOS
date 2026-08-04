export { complete, completeRaw, completeStream, MODEL_POWERFUL, MODEL_FAST } from "./groq-client.js";
export { agentComplete, validateProviderKey } from "./agent-complete.js";
export type { AgentCompleteOpts, ProviderId } from "./agent-complete.js";
export { PROVIDER_REGISTRY, PROVIDER_PRIORITY, getProvider, loadProvider, discoverProvider, discoverProviders, registerProvider, getProviderCapabilities, getStrategy } from "./provider-registry.js";
export type { ProviderConfig } from "./provider-registry.js";
export type { ProviderStrategy, StrategyCallOptions, StrategyStreamOptions } from "./provider-strategy.js";
export type { ProviderCapabilityHints, ProviderCapabilitySummary, ProviderCostTier } from "./provider-capabilities.js";
export type { Message, GroqResponse, CompleteOptions, RawMessage, ToolCall, ToolDefinition, RawGroqResponse } from "./groq-client.js";

export type { PendingChange } from "./tools/file-tools.js";

export { buildQualityHints, buildQualityPlan, assessStructuredOutput, sortProviderIdsByQuality } from "./quality-engine.js";
export type { QualityAssessment, QualityPlan, QualityProfile, QualitySortOptions } from "./quality-engine.js";
export { buildExecutionPlan as buildModelSelectionExecutionPlan } from "./model-selection/execution-plan.js";
export type { ExecutionPlan as ModelSelectionExecutionPlan, ExecutionPlanOptions as ModelSelectionExecutionPlanOptions } from "./model-selection/execution-plan.js";
export { resolveExecutionDecision } from "./model-selection/decision-engine.js";
export type { ResolveExecutionDecisionOptions } from "./model-selection/decision-engine.js";
export { resolveExecutionProvider } from "./model-selection/provider-strategy.js";
export type { ExecutionProviderDecision } from "./model-selection/provider-strategy.js";
export { resolveExecutionModel } from "./model-selection/model-resolver.js";
export type { ExecutionModelDecision } from "./model-selection/model-resolver.js";

export { buildExecutionPlan } from "./quality/quality-planner.js";
export type { ExecutionPlan } from "./quality/quality-planner.js";
export { buildTaskProfile, inferTaskType } from "./quality/task-profile.js";
export type { TaskProfile, TaskType, ContextIntensity, MemoryMode, GraphMode, HistoryMode } from "./quality/task-profile.js";
export { decideRetry } from "./quality/retry-controller.js";
export type { RetryDecision } from "./quality/retry-controller.js";

export { GroqClientError } from "./errors.js";
export type { AgentErrorCode, GroqErrorCode } from "./errors.js";

export { resolveToolPolicy, getAllowedToolDefinitions, isToolAllowed } from "./tool-policy.js";
export type { ToolMode, ToolPolicy } from "./tool-policy.js";

export { extractJson, parseAgentResponse } from "./parsing.js";
export type { AgentParseResult } from "./parsing.js";

export {
  buildProjectContext,
  invalidateContextCache,
  setInvalidationNotifier,
  startContextInvalidationChannel,
} from "./context-builder.js";
export type { ProjectContext, BuildContextOptions } from "./context-builder.js";

export type { SliceId, AdmissionDecision, ContextSlice, ContextPlan, ContextObject } from "./context-runtime/context-object.js";
export { buildSlice, estimateTokens } from "./context-runtime/context-object.js";
export { runAdmission } from "./context-runtime/context-admission.js";
export type { SliceMetadata } from "./context-loader.js";

export { buildContextCacheKey, getCachedContext, setCachedContext } from "./context-cache-manager.js";
export type { NotifyPool, NotifyPoolClient } from "./context-cache-manager.js";
export { loadProjectContext } from "./context-loader.js";
export type { BuildProjectContextOptions, ContextLoadSection, LoadedProjectContext } from "./context-loader.js";
export { buildProjectContextFromLoadedContext } from "./context-serializer.js";
export { CONTEXT_WARN_CHARS, estimateContextSize, warnIfContextTooLarge } from "./context-compressor.js";

export * from "./schemas/index.js";

export { chat } from "./agents/chat-agent.js";
export type { ChatMessage, ChatResult } from "./agents/chat-agent.js";

export {
  resolveModel,
  resolveFallbackChain,
  buildFallbackChainFromId,
  emitModelDecisionTrace,
  FREE_MODELS,
} from "./openrouter/index.js";
export type {
  ModelCapability,
  OpenRouterFreeModel,
  ResolvedModel,
  ResolveModelOpts,
  ModelDecisionTrace,
} from "./openrouter/index.js";

export {
  fetchSessionMemories,
  writeSessionMemories,
  enrichContextWithMemories,
  formatMemoriesForPrompt,
  sweepExpiredMemories,
  startMemorySweep,
} from "./session-memory.js";
export type { MemoryRow } from "./session-memory.js";

export { analyzeScan } from "./agents/scan-analyst.js";
export type { ScanAnalysisResult } from "./agents/scan-analyst.js";

export { reviewCode } from "./agents/code-reviewer.js";
export type { CodeReviewResult } from "./agents/code-reviewer.js";

export { executeTask } from "./agents/task-agent.js";
export type { TaskAgentInput, TaskAgentResult } from "./agents/task-agent.js";
export { BaseAgent } from "./agents/base-agent.js";
export type { AgentRunResult } from "./agents/base-agent.js";

export { decide, validateDecision, executeDecision, orchestrateWorkflow } from "./agents/workflow-orchestrator.js";
export type { WorkflowState, OrchestrationDecision, WorkflowDecisionResult } from "./agents/workflow-orchestrator.js";

// PR-002: dynamic catalog
export {
  refreshDynamicCatalog,
  getDynamicModelIds,
  isDynamicCatalogLoaded,
  auditStaticCatalog,
} from "./openrouter/dynamic-catalog.js";

// PR-006: startup validator
export { validateAiProvidersAtStartup } from "./startup-validator.js";
export type { ProviderValidationResult } from "./startup-validator.js";

// PR-004/PR-007/PR-008: extended error types
export type { ProviderErrorContext } from "./errors.js";

// PR-05 / PR-011: provider metrics
export {
  recordRequest,
  recordFailure,
  recordSuccess,
  recordFallbackSuccess,
  recordInvalidModel,
  recordLatency,
  getProviderMetrics,
} from "./provider-metrics.js";
export type { ProviderMetricsSnapshot } from "./provider-metrics.js";

// PR-07: circuit breaker
export {
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
  getCircuitState,
} from "./openrouter/circuit-breaker.js";
