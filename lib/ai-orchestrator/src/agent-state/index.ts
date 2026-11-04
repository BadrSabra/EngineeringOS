export {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  canonicalJson,
  canonicalJsonHash,
  canonicalizeJson,
  boundedJsonSchema,
  parseBoundedJson,
} from "./contract-utils.js";
export type { JsonValue } from "./contract-utils.js";

export {
  AgentEpisodeSchema,
  AgentEpisodeEventSchema,
  EpisodeEventTypeSchema,
  EpisodeStateSchema,
  EpisodeVerdictSchema,
  parseAgentEpisode,
  parseAgentEpisodeEvent,
  toPublicAgentEpisode,
} from "./episode-contract.js";
export type {
  AgentEpisode,
  AgentEpisodeEvent,
  EpisodeEventType,
  EpisodeState,
  EpisodeVerdict,
  PublicAgentEpisode,
} from "./episode-contract.js";

export {
  AgentObservationSchema,
  ObservationCompletenessSchema,
  ObservationFreshnessSchema,
  ObservationKindSchema,
  hashObservationValue,
  parseAgentObservation,
} from "./observation-contract.js";
export type {
  AgentObservation,
  ObservationCompleteness,
  ObservationFreshness,
  ObservationProvenance,
  ObservationKind,
} from "./observation-contract.js";

export {
  AgentActionRiskSchema,
  AgentActionSchema,
  AgentActionRequestedPayloadSchema,
  parseAgentAction,
  parseAgentActionRequestedPayload,
} from "./action-contract.js";
export type {
  AgentAction,
  AgentActionRequestedPayload,
  AgentActionRisk,
} from "./action-contract.js";

export {
  AgentEffectSchema,
  classifyExpectedStateChanges,
  classifyEffect,
  EffectAllowedResultSchema,
  EffectContractSchema,
  EffectObservationProfileSchema,
  EffectStatusSchema,
  hashEffectContract,
  parseAgentEffect,
  parseEffectContract,
} from "./effect-contract.js";
export type {
  AgentEffect,
  EffectAllowedResult,
  EffectContract,
  EffectClassification,
  EffectObservationEvidence,
  EffectObservationProfile,
  EffectStatus,
} from "./effect-contract.js";

export {
  FailureDiagnosisSchema,
  FailureDiagnosisSummarySchema,
  FailureNextActionCodeSchema,
  FailureKindSchema,
  FailureReasonCodeSchema,
  parseFailureDiagnosis,
  toFailureDiagnosisSummary,
  toPublicFailureDiagnosis,
} from "./failure-contract.js";
export type {
  FailureDiagnosis,
  FailureDiagnosisSummary,
  FailureKind,
  FailureNextActionCode,
  FailureReasonCode,
  PublicFailureDiagnosis,
} from "./failure-contract.js";

export { diagnoseFailure, tryDiagnoseFailure } from "./failure-diagnosis.js";
export type { DiagnoseFailureInput } from "./failure-diagnosis.js";

export {
  DecisionConfidenceSchema,
  DecisionEvidenceRefSchema,
  DecisionKnowledgeClassSchema,
  DecisionResultSchema,
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionDecisionTraceSchema,
  MissionStrategyAlternativeSchema,
  MissionStrategyEvaluationSchema,
  MissionStrategyOutcomeEvaluationSchema,
  MissionStrategyPlanOutcomeEvaluationSchema,
  StrategyDifferenceSchema,
  StrategyEvaluationDimensionSchema,
  hashMissionDecisionContext,
  hashMissionDecisionTrace,
  hashMissionStrategyAlternative,
} from "./mission-decision-contract.js";
export * from "./mission-strategy-outcome-evaluation.js";
export * from "./mission-strategy-plan-outcome-evaluation.js";
export type {
  DecisionConfidence,
  DecisionEvidenceRef,
  DecisionKnowledgeClass,
  DecisionResult,
  MissionDecisionContext,
  MissionDecisionTrace,
  MissionStrategyAlternative,
  MissionStrategyEvaluation,
  MissionStrategyOutcomeEvaluation,
  MissionStrategyPlanOutcomeEvaluation,
  StrategyDifference,
  StrategyEvaluationDimension,
} from "./mission-decision-contract.js";

export {
  compareMissionStrategyAlternatives,
  generateMissionStrategyAlternatives,
} from "./mission-strategy-generation.js";
export {
  evaluateMissionStrategies,
  MISSION_STRATEGY_EVALUATOR_VERSION,
} from "./mission-strategy-evaluation.js";
export {
  buildMissionStrategyShadowComparison,
  MISSION_STRATEGY_SHADOW_POLICY_VERSION,
  MissionStrategyShadowComparisonSchema,
} from "./mission-strategy-shadow.js";
export type {
  MissionStrategyShadowBuildResult,
  MissionStrategyShadowComparison,
} from "./mission-strategy-shadow.js";
export type {
  MissionStrategyEvaluationResult,
  StrategyPairwiseComparison,
} from "./mission-strategy-evaluation.js";
export type {
  MissionStrategyGenerationResult,
  StrategyGenerationInput,
} from "./mission-strategy-generation.js";

export {
  StrategyCandidateSchema,
  StrategyEvaluationStatusSchema,
  hashStrategyCandidate,
  parseStrategyCandidate,
  strategyStatusAfterAcceptedSupport,
} from "./strategy-contract.js";
export type { StrategyCandidate, StrategyEvaluationStatus } from "./strategy-contract.js";

export {
  STRATEGY_REPLAY_POLICY,
  StrategyReplayCaseProofBindingSchema,
  StrategyReplayEvidenceAnalysisSchema,
  analyzeStrategyReplayEvidence,
  hashStrategyReplayCaseManifest,
} from "./strategy-replay.js";
export type {
  AnalyzeStrategyReplayEvidenceInput,
  StrategyReplayCaseProofBinding,
  StrategyReplayCaseManifestInput,
  StrategyReplayCorpusRun,
  StrategyReplayEvidenceAnalysis,
} from "./strategy-replay.js";