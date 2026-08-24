export { walkProject } from "./file-walker.js";
export type { ScannedFile, WalkResult, RevisionManifest, RevisionManifestFile } from "./file-walker.js";

export { matchRule, matchRules, checkPatternInFiles } from "./rule-matcher.js";
export type { RuleInput, RuleMatch, RuleMatchResult } from "./rule-matcher.js";

export { extractGraph } from "./graph-extractor.js";
export type {
  ExtractedEntity,
  ExtractedRelationship,
  GraphExtractionResult,
  EntityType,
  GraphEvidence,
  GraphEdgeType,
  ExtractionMethod,
  EntityProvenance,
  RelationshipProvenance,
} from "./graph-extractor.js";

export { computeMetrics } from "./metrics-calc.js";
export type { ComputedMetrics } from "./metrics-calc.js";

/**
 * GAP-2 fix: Semver of the scanner's extraction logic.
 * Bump this constant (and lib/scanner/package.json) whenever AST extraction
 * rules, confidence scoring, or entity/relationship shapes change — so stored
 * provenance records are distinguishable by the logic version that produced them.
 */
export const SCANNER_VERSION = "1.0.0";
