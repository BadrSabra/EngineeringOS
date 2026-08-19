export { complete, completeRaw, completeStream, MODEL_POWERFUL, MODEL_FAST } from "./groq-client.js";
export type { AgentStep, AgentDiagnosticCode, SourceRetrievalTelemetry, ReadStatus } from "./tool-execution-engine.js";
export {
  buildProjectFileManifest,
  buildProjectFileSources,
  formatProjectFileManifest,
  formatProjectFileSources,
  ProjectFileManifestSchema,
  ProjectFileSourceSchema,
  ProjectFileSourcesSchema,
} from "./filesystem-manifest.js";
export type {
  ProjectFileManifest,
  ProjectFileSource,
  ProjectFileSources,
} from "./filesystem-manifest.js";
export { classifyReadStatus, EMPTY_SOURCE_RETRIEVAL_TELEMETRY, ReadStatusSchema } from "./tool-execution-engine.js";
export { buildForensicEvidencePackets } from "./forensic-evidence-packets.js";
export type { ForensicEvidencePacket } from "./forensic-evidence-packets.js";
export { mergeForensicRecoveryEnvelopes } from "./forensic-recovery.js";
export type { ForensicRecoveryEnvelope } from "./forensic-recovery.js";
export { agentComplete, validateProviderKey } from "./agent-complete.js";
export type { AgentCompleteOpts, ProviderId } from "./agent-complete.js";
export { PROVIDER_REGISTRY, PROVIDER_PRIORITY, getProvider, loadProvider, discoverProvider, discoverProviders, registerProvider, getProviderCapabilities, getStrategy } from "./provider-registry.js";
export {
  probeProviderHealth,
  PROBE_TOOL_NAME,
  type ProviderHealthProbeOptions,
  type ProviderHealthProbeResult,
  type ProviderHealthStatus,
  type ProviderHealthFailureCode,
} from "./benchmark/provider-health-probe.js";
export {
  BENCHMARK_AIRLOCK_VERSION,
  runCodeAgentBenchmarkAirlock,
  type BenchmarkAirlockProvider,
  type BenchmarkAirlockObservation,
  type BenchmarkAirlockRun,
} from "./benchmark/benchmark-airlock.js";
export {
  getBenchmarkCampaignStatus,
  getBenchmarkRecoveryCaseIds,
  isCleanWitnessScorecard,
  summarizeBenchmarkCampaign,
  type BenchmarkCampaignCaseRecord,
  type BenchmarkCampaignMode,
  type BenchmarkCampaignSummary,
} from "./benchmark/benchmark-campaign.js";
export type { ProviderConfig } from "./provider-registry.js";
export type { ProviderStrategy, StrategyCallOptions, StrategyStreamOptions } from "./provider-strategy.js";
export type { ProviderCapabilityHints, ProviderCapabilitySummary, ProviderCostTier } from "./provider-capabilities.js";
export type { Message, GroqResponse, CompleteOptions, RawMessage, ToolCall, ToolDefinition, RawGroqResponse } from "./groq-client.js";

export type { PendingChange } from "./tools/file-tools.js";
export { buildPatchHunks, hashPatchBase, rebasePatchHunks } from "./patch-contract.js";
export type { FilePatchHunk, PatchRebaseResult } from "./patch-contract.js";
export {
  deriveFlightDeckState,
  type FlightDeckState,
  type FlightDeckStateInput,
  type FlightDeckEvidenceVerdict,
} from "./flight-deck-state.js";
export {
  executeExecutionNodePlan,
} from "./execution-node-coordinator.js";
export type {
  ExecutionNodeCoordinatorEvent,
  ExecutionNodeCoordinatorOptions,
  ExecutionNodeCoordinatorResult,
  ExecutionNodeOutcome,
  ExecutionNodeRunContext,
} from "./execution-node-coordinator.js";

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

export { EXECUTION_LIMITS, runBoundedCommand } from "./execution-kernel.js";
export type {
  BoundedCommandSpec,
  BoundedCommandStatus,
  BoundedCommandResult,
} from "./execution-kernel.js";
export type { RepairLoopState, ValidationRunner, ValidationToolResult } from "./tools/execution-tools.js";
export {
  hasValidationEvidence,
  isProvenValidation,
} from "./validation-result.js";
export type {
  ValidationEvidence,
  ValidationFailure,
  ValidationResult,
  ValidationStatus,
} from "./validation-result.js";

export { resolveToolPolicy, getAllowedToolDefinitions, isToolAllowed } from "./tool-policy.js";
export type { ToolMode, ToolPolicy } from "./tool-policy.js";

export { extractJson, parseAgentResponse } from "./parsing.js";
export type { AgentParseResult } from "./parsing.js";

export {
  buildProjectContext,
  invalidateContextCache,
  invalidateContextSlice,
  hashExecutionPlan,
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
export {
  ActiveTaskStateSchema,
  ActiveTaskExecutionPlanSchema,
  ExecutionNodeSchema,
  ExecutionPlanClaimSchema,
  ExecutionPlanBoundariesSchema,
  buildActiveTaskState,
  buildActiveTaskExecutionPlan,
  buildExecutionNodes,
  getRunnableExecutionNodes,
  transitionExecutionNode,
  mergeActiveTaskEvidence,
  isResumableTaskType,
  isTaskContinuationRequest,
  parseActiveTaskState,
  resumeActiveTaskClassification,
  serializeActiveTaskState,
  touchActiveTaskState,
} from "./task-session-state.js";
export type {
  ActiveTaskExecutionPlan,
  ActiveTaskState,
  ExecutionPlanClaim,
  ExecutionPlanBoundaries,
  ExecutionNode,
} from "./task-session-state.js";

// Wave 2: context lifetime management
export { applyLifetime, DEFAULT_LIFETIME_POLICY } from "./context-runtime/context-lifetime.js";
export type { SliceLifetimePolicy, LifetimePolicy, SliceLifetimeState, LifetimeResult } from "./context-runtime/context-lifetime.js";

// Wave 2: context snapshot & diff
export { takeSnapshot, diffSnapshots, snapshotsContentEqual } from "./context-runtime/context-diff.js";
export type { SliceFingerprint, ContextSnapshot, SliceChangeKind, SliceDelta, ContextDelta } from "./context-runtime/context-diff.js";
export { loadProjectContext } from "./context-loader.js";
export type { BuildProjectContextOptions, ContextLoadSection, LoadedProjectContext } from "./context-loader.js";
export { buildProjectContextFromLoadedContext } from "./context-serializer.js";
export { CONTEXT_WARN_CHARS, estimateContextSize, warnIfContextTooLarge } from "./context-compressor.js";

export {
  AgentContextSchema,
  PendingChangeSchema,
  FilePatchHunkSchema,
  PatchEvidenceLinkSchema,
  ValidationProfileSchema,
  ChatResponseSchema,
  ChatOutputSchema,
  ChatTaskResultSchema,
  CodeExtractionResultSchema,
  BehaviorAnswerResultSchema,
  FindingResultSchema,
  ForensicReportResultSchema,
  RepairResultSchema,
  ImplementationPlanSchema,
  ImplementationPlanStepSchema,
  RepairPlanMetadataSchema,
  ObjectiveContractSchema,
  ObjectiveRequiredClaimSchema,
  ObjectiveEvidenceEdgeSchema,
  CodeIssueTypeSchema,
  SeveritySchema,
  CodeIssueSchema,
  CodeReviewResultSchema,
  ScanInsightSchema,
  ScanSummarySchema,
  TaskRecommendationSchema,
  WorkflowPhaseSchema,
  WorkflowActionSchema,
  WorkflowDecisionSchema,
  parseWorkflowPhases,
} from "./schemas/index.js";
export type {
  AgentContext,
  PatchEvidenceLink,
  ValidationProfile,
  RepairPlanMetadata,
  ChatOutput,
  ChatTaskResult,
  ObjectiveContract,
  ObjectiveRequiredClaim,
  ObjectiveEvidenceEdge,
  CodeExtractionResult,
  BehaviorAnswerResult,
  FindingResult,
  ForensicReportResult,
  RepairResult,
  ImplementationPlan,
  ImplementationPlanStep,
  CodeIssue,
  CodeReviewOutput,
  ScanInsight,
  ScanAnalysisOutput,
  TaskAgentOutput,
  WorkflowPhase,
  WorkflowAction,
  WorkflowDecision,
} from "./schemas/index.js";

export {
  chat,
  buildConversationHistoryWindow,
  CONVERSATION_HISTORY_TURNS,
  CONVERSATION_HISTORY_FETCH_TURNS,
  CONVERSATION_HISTORY_FETCH_MESSAGES,
  isImmediateExecutionRequest,
  isReportRegenerationRequest,
  isRepairPlanExecutionRequest,
  extractPriorRepairPlan,
  extractPriorRepairPlanMetadata,
  extractExecutionFilePaths,
} from "./agents/chat-agent.js";
export type { ChatMessage, ChatResult } from "./agents/chat-agent.js";
export type { ActiveTask } from "./prompts/chat.prompt.js";

export { classifyRequest, isSocialGreeting } from "./prompts/profile-classifier.js";
export type { ClassifiedRequest, RequestCategory } from "./prompts/profile-classifier.js";
export {
  AnalysisModeSchema,
  BehaviorAnswerSchema,
  capBudgetForTask,
  CodeExtractionSchema,
  EvidenceReferenceSchema,
  FindingAnalysisSchema,
  ForensicReportSchema,
  ForensicTaskTypeSchema,
  OutputContractSchema,
  RepairAnalysisSchema,
  classifyForensicTask,
  buildTaskValidationFallback,
  getTaskOutputContract,
  routeTask,
  scoreEvidenceRelevance,
  SemanticBehaviorAnswerSchema,
  validateTaskResponse,
} from "./task-contracts.js";
export type {
  AnalysisMode,
  BehaviorAnswer,
  BehaviorEvidenceValidation,
  CodeExtraction,
  EvidenceReference,
  FindingAnalysis,
  ForensicReport,
  ForensicTaskType,
  OutputContract,
  RepairAnalysis,
  TaskRoute,
  TaskValidator,
  TaskValidationResult,
  QuestionCoverage,
  SemanticBehaviorAnswer,
  TaskExecutionBudget,
} from "./task-contracts.js";
export {
  evaluateBehaviorRequiredClaims,
  decomposeObjectiveClaims,
  closeObjectiveClaimsFromEdges,
  closeObjectiveClaimsFromEvidence,
} from "./required-claims.js";
export type {
  RequiredClaim,
  RequiredClaimClosure,
  RequiredClaimStatus,
} from "./required-claims.js";
export {
  ScopeExpansionKindSchema,
  ObjectiveScopePolicySchema,
  classifyObjectiveScopePath,
  normalizeObjectivePath,
} from "./objective-scope.js";
export type {
  ScopeExpansionKind,
  ObjectiveScopePolicy,
  ScopeExpansion,
} from "./objective-scope.js";
export {
  buildCrossFileSemanticTrace,
  buildProductionReachabilityTrace,
  CrossFileSemanticTraceSchema,
  ProductionReachabilityTraceSchema,
  SemanticTraceEdgeSchema,
  SemanticTraceNodeSchema,
  TraceStageSchema,
  TraceStatusSchema,
  // AI-OBJ-004: ReachabilityEdge proof model
  ReachabilityRelationshipSchema,
  ReachabilityEdgeSchema,
  classifyReachabilityEdge,
  buildReachabilityProofSummary,
} from "./semantic-trace.js";
export type {
  CrossFileSemanticTrace,
  ProductionReachabilityTrace,
  SemanticGraphEdge,
  SemanticGraphNode,
  ProductionTraceLink,
  SemanticTraceEdge,
  SemanticTraceNode,
  TraceStage,
  TraceStatus,
  // AI-OBJ-004
  ReachabilityRelationship,
  ReachabilityEdge,
  ReachabilityProofStatus,
  ReachabilityProofSummary,
} from "./semantic-trace.js";
export {
  AuditStateSchema,
  ForensicDecisionTraceSchema,
  RecoveryFailureKindSchema,
  VerificationStageSchema,
  VerificationTraceSchema,
  // AI-OBJ-012: objective verdict kinds
  ObjectiveVerdictKindSchema,
  classifyObjectiveVerdict,
} from "./audit-telemetry.js";
export type {
  AuditState,
  ForensicDecisionTrace,
  RecoveryFailureKind,
  VerificationStage,
  VerificationTrace,
  // AI-OBJ-012
  ObjectiveVerdictKind,
} from "./audit-telemetry.js";
export { detectDeterministicBehavioralFindings } from "./forensic-deterministic-findings.js";

export {
  getForensicBenchmarkCases,
  runDeterministicForensicBenchmark,
  runLiveForensicBenchmark,
  scorecardToMarkdown,
  writeScorecardFiles,
} from "./benchmark/forensic-benchmark.js";
export type {
  BenchmarkCase,
  BenchmarkCaseId,
  BenchmarkCaseResult,
  BenchmarkScorecard,
} from "./benchmark/forensic-benchmark.js";
export {
  CODE_AGENT_BENCHMARK_CASE_COUNT,
  CODE_AGENT_BENCHMARK_MAX_QUALITY_REGRESSION,
  CODE_AGENT_BENCHMARK_VERSION,
  applyCodeAgentBenchmarkBaselineGate,
  buildCodeAgentBenchmarkScorecard,
  buildCodeAgentBenchmarkReplayRecord,
  codeAgentBenchmarkManifestToMarkdown,
  codeAgentBenchmarkScorecardToMarkdown,
  getCodeAgentBenchmarkCases,
  getCodeAgentBenchmarkCategoryCounts,
  getCodeAgentBenchmarkTargetProfileCases,
  getTargetedCodeAgentBenchmarkCases,
  CODE_AGENT_BENCHMARK_TARGET_PROFILES,
  TARGETED_CODE_AGENT_BENCHMARK_CASE_IDS,
  observationFromCodeAgentExecution,
  runCodeAgentBenchmark,
  runCodeAgentBenchmarkReplay,
  validateCodeAgentBenchmarkManifest,
} from "./benchmark/code-agent-benchmark.js";
export type {
  CodeAgentBenchmarkCase,
  CodeAgentBenchmarkCaseComplete,
  CodeAgentBenchmarkBaseline,
  CodeAgentBenchmarkBaselineComparison,
  CodeAgentBenchmarkCategory,
  CodeAgentBenchmarkExecutor,
  CodeAgentBenchmarkGrade,
  CodeAgentBenchmarkMetrics,
  CodeAgentBenchmarkObservation,
  CodeAgentBenchmarkReplayEntry,
  CodeAgentBenchmarkReplayRecord,
  CodeAgentBenchmarkScorecard,
  CodeAgentBenchmarkTelemetryComplete,
  CodeAgentBenchmarkTargetProfile,
  CodeAgentExecutionTelemetry,
  CodeAgentExpectedTerminal,
  CodeAgentProjectShape,
  CodeAgentValidationKind,
} from "./benchmark/code-agent-benchmark.js";
export { createChatCodeAgentBenchmarkExecutor } from "./benchmark/live-code-agent-benchmark.js";
export {
  getCodeAgentBenchmarkFixture,
  validateCodeAgentBenchmarkFixtureContracts,
} from "./benchmark/code-agent-benchmark-fixtures.js";
export type {
  CodeAgentBenchmarkFixture,
  CodeAgentBenchmarkFixtureOracleResult,
} from "./benchmark/code-agent-benchmark-fixtures.js";
export { evaluateCodeAgentBenchmarkContract } from "./benchmark/contract-oracle.js";
export type { CodeAgentBenchmarkContractOracleResult } from "./benchmark/contract-oracle.js";
export {
  benchmarkShardLabel,
  parseBenchmarkShardConfig,
  selectBenchmarkShard,
} from "./benchmark/benchmark-shards.js";
export type { BenchmarkShardConfig } from "./benchmark/benchmark-shards.js";
export {
  FREE_TIER_QUALITY_ENVELOPE_VERSION,
  buildFreeTierQualityEnvelope,
  buildFreeTierQualityEnvelopeFromRuns,
  buildFreeTierReplayCorpus,
} from "./benchmark/free-tier-quality-envelope.js";
export type {
  FreeTierQualityEnvelope,
  FreeTierReplayCorpus,
  FreeTierReplayEntry,
} from "./benchmark/free-tier-quality-envelope.js";
export { buildFreeTierFailureAnalysis } from "./benchmark/free-tier-failure-analysis.js";
export type {
  FreeTierFailureAnalysis,
  FreeTierFailureRootCause,
} from "./benchmark/free-tier-failure-analysis.js";
export type { ChatCodeAgentBenchmarkExecutorOptions } from "./benchmark/live-code-agent-benchmark.js";
export { selectFreeOnlyBenchmarkModels } from "./benchmark/free-only-policy.js";
export type {
  FreeOnlyModelSelection,
  FreeOnlyModelSelectionOptions,
} from "./benchmark/free-only-policy.js";
export {
  approveCodeAgentBenchmarkBaseline,
} from "./benchmark/baseline-approval.js";
export type { BaselineApprovalOptions } from "./benchmark/baseline-approval.js";

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

// Behavioral model routing scorecards
export {
  getBehavioralScorecards,
  getBehavioralScorecard,
  isModelBehaviorallyDemoted,
  recordBehavioralFailure,
  recordBehavioralModelCall,
} from "./behavioral-scorecard.js";
export type {
  BehavioralFailureKind,
  BehavioralScorecard,
} from "./behavioral-scorecard.js";

// PR-07: circuit breaker
export {
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
  getCircuitState,
} from "./openrouter/circuit-breaker.js";

// EI-001…EI-023: Evidence Integrity & Claim Verification
export {
  createEvidenceRecord,
  validateEvidenceLineage,
  classifyEvidenceStrength,
  createClaim,
  selectEvidenceForClaim,
  rankEvidenceForClaim,
  bindClaimToEvidence,
  validateClaim,
  guardFinalJudgment,
  buildBehaviorFindingStatus,
  buildRunLedger,
  validateTelemetry,
  buildEvidenceBackedAnswer,
  buildClaimOrientedEvidenceMap,
  planEvidenceRecovery,
  tagRecoveredEvidence,
  evidenceSpanFromContent,
  classifySourceScope,
  deriveVerdictScope,
  deriveScopedFindingStatus,
  evidenceScopeSupportsClaimScope,
  scopedRepairGate,
  extractClaimSymbol,
  objectiveCompletionGate,
  // AI-OBJ-007: evidence relevance gate
  evidenceRelevanceGate,
  // AI-OBJ-010: final answer validator
  validateFinalAnswer,
} from "./evidence-integrity.js";
export type {
  EvidenceReadType,
  EvidenceSourceType,
  EvidenceSourceScope,
  VerdictScope,
  ScopedFindingStatus,
  EvidencePhase,
  EvidenceRecord,
  EvidenceStrength,
  ClaimStatus,
  ClaimRecord,
  ClaimEvidenceBinding,
  ClaimValidationResult,
  ClaimValidation,
  BehaviorStatus,
  FindingStatus,
  BehaviorFindingStatus,
  RunLedger,
  TelemetryReconciliation,
  EvidenceBackedAnswer,
  FinalJudgmentGuard,
  ScopedRepairGate,
  RepairBlockReason,
  ObjectiveCompletionStatus,
  ObjectiveEvidenceEdgeRef,
  ObjectiveCompletionGateResult,
  // AI-OBJ-007
  ClaimCategory,
  EvidenceRelevanceVerdict,
  // AI-OBJ-010
  FinalAnswerValidation,
} from "./evidence-integrity.js";
