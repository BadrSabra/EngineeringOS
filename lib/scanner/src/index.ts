export { walkProject } from "./file-walker.js";
export type { ScannedFile, WalkResult } from "./file-walker.js";

export { matchRule, matchRules, checkPatternInFiles } from "./rule-matcher.js";
export type { RuleInput, RuleMatch, RuleMatchResult } from "./rule-matcher.js";

export { extractGraph } from "./graph-extractor.js";
export type { ExtractedEntity, ExtractedRelationship, GraphExtractionResult, EntityType } from "./graph-extractor.js";

export { computeMetrics } from "./metrics-calc.js";
export type { ComputedMetrics } from "./metrics-calc.js";
