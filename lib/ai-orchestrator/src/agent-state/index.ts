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
  parseAgentAction,
} from "./action-contract.js";
export type { AgentAction, AgentActionRisk } from "./action-contract.js";

export {
  AgentEffectSchema,
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
  StrategyCandidateSchema,
  StrategyEvaluationStatusSchema,
  hashStrategyCandidate,
  parseStrategyCandidate,
  strategyStatusAfterAcceptedSupport,
} from "./strategy-contract.js";
export type { StrategyCandidate, StrategyEvaluationStatus } from "./strategy-contract.js";

export {
  STRATEGY_REPLAY_POLICY,
  StrategyReplayEvidenceAnalysisSchema,
  analyzeStrategyReplayEvidence,
  hashStrategyReplayCaseManifest,
} from "./strategy-replay.js";
export type {
  AnalyzeStrategyReplayEvidenceInput,
  StrategyReplayCaseManifestInput,
  StrategyReplayCorpusRun,
  StrategyReplayEvidenceAnalysis,
} from "./strategy-replay.js";