import { createHash } from "node:crypto";

export const EMPIRICAL_QUALITY_VERSION = "empirical-quality-v1";
export const EMPIRICAL_QUALITY_CORPUS_VERSION = 2 as const;
export const EMPIRICAL_QUALITY_LEGACY_CORPUS_VERSION = 1 as const;

const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,159}$/i;
const SAFE_RELATIVE_FILE = /^(?!\/)(?!.*(?:^|\/)\.\.)(?:[a-z0-9._-]+\/)*[a-z0-9._-]+$/i;
const SAFE_GITHUB_REPOSITORY = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const SAFE_GIT_REVISION = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
export type EmpiricalIssueType = "bug" | "security" | "performance" | "style" | "architecture";
export type EmpiricalSeverity = "critical" | "high" | "medium" | "low";
export type EmpiricalRepositoryLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "ruby"
  | "php";
export type EmpiricalReviewPattern = "single-file" | "multi-file";
const ISSUE_TYPES = new Set<EmpiricalIssueType>(["bug", "security", "performance", "style", "architecture"]);
const SEVERITIES = new Set<EmpiricalSeverity>(["critical", "high", "medium", "low"]);
const REPOSITORY_LANGUAGES = new Set<EmpiricalRepositoryLanguage>([
  "javascript", "typescript", "python", "go", "rust", "java", "csharp", "ruby", "php",
]);
const REVIEW_PATTERNS = new Set<EmpiricalReviewPattern>(["single-file", "multi-file"]);

export type EmpiricalGroundTruthFinding = {
  id: string;
  file: string;
  lineStart: number;
  lineEnd?: number;
  type: EmpiricalIssueType;
  severity: EmpiricalSeverity;
};

export type EmpiricalCorpusCaseMetadata = {
  language: EmpiricalRepositoryLanguage;
  caseType: "defect" | "clean";
  reviewPattern: EmpiricalReviewPattern;
  issueTypes: readonly EmpiricalIssueType[];
  severities: readonly EmpiricalSeverity[];
};

export type EmpiricalCorpusCase = {
  id: string;
  repositoryId: string;
  repositoryUrl: string;
  sourceRevision: string;
  selectedFiles: readonly string[];
  outcome: "defect" | "clean";
  expectedVerdict: "findings" | "clean";
  expectedGateDecision: "accept" | "reject";
  findings: readonly EmpiricalGroundTruthFinding[];
  metadata?: EmpiricalCorpusCaseMetadata;
};

export type EmpiricalQualityCoverage = {
  minimumCasesPerOutcome: number;
  requiredLanguages: readonly EmpiricalRepositoryLanguage[];
  requiredReviewPatterns: readonly EmpiricalReviewPattern[];
  requiredIssueTypes: readonly EmpiricalIssueType[];
  requiredSeverities: readonly EmpiricalSeverity[];
};

export type EmpiricalQualityCorpus = {
  kind: "empirical-ai-quality-corpus";
  version: typeof EMPIRICAL_QUALITY_LEGACY_CORPUS_VERSION | typeof EMPIRICAL_QUALITY_CORPUS_VERSION;
  corpusRevision: string;
  cases: readonly EmpiricalCorpusCase[];
  coverage?: EmpiricalQualityCoverage;
};

export type EmpiricalObservedFinding = {
  file: string;
  lineStart?: number;
  lineEnd?: number;
  type: EmpiricalIssueType;
  severity: EmpiricalSeverity;
  citationValid: boolean;
  citationSupported: boolean;
};

export type EmpiricalNormalizationCounters = {
  changedFindingType: number;
  changedSeverity: number;
  droppedCitation: number;
};

export type EmpiricalCaseObservation = {
  caseId: string;
  outcome: "COMPLETE" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "ERROR";
  contractPassed: boolean;
  qualityGateAccepted: boolean;
  semanticVerdict: "findings" | "clean" | "blocked" | "unknown";
  observedFindings: readonly EmpiricalObservedFinding[];
  normalization?: Partial<EmpiricalNormalizationCounters>;
  latencyMs?: number;
  errorCode?: "PROVIDER_UNAVAILABLE" | "RATE_LIMITED" | "TIMEOUT" | "EXECUTION_ERROR" | "INCOMPLETE_EVIDENCE";
};

export type EmpiricalCaseScore = {
  caseId: string;
  outcome: EmpiricalCaseObservation["outcome"];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  citationCoveredFindings: number;
  unsupportedCitations: number;
  expectedFindings: number;
  observedFindings: number;
  contractPassed: boolean;
  semanticVerdictConsistent: boolean;
  qualityGateAccepted: boolean;
  falseAcceptance: boolean;
  falseRejection: boolean;
  normalization: EmpiricalNormalizationCounters;
  latencyMs?: number;
  errorCode?: EmpiricalCaseObservation["errorCode"];
};

export type EmpiricalQualityMetrics = {
  totalCases: number;
  completedCases: number;
  incompleteCases: number;
  providerUnavailableCount: number;
  timeoutCount: number;
  errorCount: number;
  truePositiveCount: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  precision: number;
  recall: number;
  f1: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  citationCoverage: number;
  unsupportedCitationRate: number;
  contractAcceptanceRate: number;
  semanticVerdictConsistencyRate: number;
  qualityGateAcceptanceRate: number;
  falseAcceptanceRate: number;
  falseRejectionRate: number;
  normalizationCounters: EmpiricalNormalizationCounters;
  highScoreLowCoverageCount: number;
  latencyMs: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  throughputPerSecond: number | null;
};

export type EmpiricalQualityScorecard = {
  kind: "empirical-ai-quality-scorecard";
  version: 1;
  generatedAt: string;
  corpusRevision: string;
  provider: string;
  model: string | null;
  measurementOnly: true;
  status: "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE";
  empiricalQualityStatus: "PROVEN" | "MEASURED" | "INCOMPLETE" | "UNAVAILABLE";
  cases: EmpiricalCaseScore[];
  metrics: EmpiricalQualityMetrics;
  blockers: string[];
};

export type EmpiricalQualityExecutor = (
  testCase: EmpiricalCorpusCase,
  signal: AbortSignal,
) => Promise<Omit<EmpiricalCaseObservation, "caseId">>;

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value.trim());
}

function isSafeRelativeFile(value: unknown): value is string {
  return typeof value === "string" && SAFE_RELATIVE_FILE.test(value.trim());
}

function isSafeRepositoryUrl(value: unknown): value is string {
  if (typeof value !== "string" || !SAFE_GITHUB_REPOSITORY.test(value.trim())) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "";
  } catch {
    return false;
  }
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isGroundTruthFinding(value: unknown): value is EmpiricalGroundTruthFinding {
  if (!value || typeof value !== "object") return false;
  const finding = value as Partial<EmpiricalGroundTruthFinding>;
  return hasOnlyKeys(value, ["id", "file", "lineStart", "lineEnd", "type", "severity"])
    && isSafeIdentifier(finding.id)
    && isSafeRelativeFile(finding.file)
    && isIntegerInRange(finding.lineStart, 1, 10_000_000)
    && (finding.lineEnd === undefined || isIntegerInRange(finding.lineEnd, finding.lineStart, 10_000_000))
    && typeof finding.type === "string"
    && ISSUE_TYPES.has(finding.type)
    && typeof finding.severity === "string"
    && SEVERITIES.has(finding.severity);
}

function isUniqueEnumArray<T extends string>(
  value: unknown,
  values: ReadonlySet<T>,
): value is readonly T[] {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && values.has(entry as T))
    && new Set(value).size === value.length;
}

function sameEnumMembers<T extends string>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((entry) => right.includes(entry));
}

function validateCoverage(value: unknown, cases: readonly EmpiricalCorpusCase[]): EmpiricalQualityCoverage {
  if (!value || typeof value !== "object" ||
      !hasOnlyKeys(value, [
        "minimumCasesPerOutcome", "requiredLanguages", "requiredReviewPatterns",
        "requiredIssueTypes", "requiredSeverities",
      ])) {
    throw new Error("Empirical corpus coverage metadata is unsupported.");
  }
  const coverage = value as Partial<EmpiricalQualityCoverage>;
  if (!isIntegerInRange(coverage.minimumCasesPerOutcome, 1, 128) ||
      !isUniqueEnumArray(coverage.requiredLanguages, REPOSITORY_LANGUAGES) ||
      !isUniqueEnumArray(coverage.requiredReviewPatterns, REVIEW_PATTERNS) ||
      !isUniqueEnumArray(coverage.requiredIssueTypes, ISSUE_TYPES) ||
      !isUniqueEnumArray(coverage.requiredSeverities, SEVERITIES) ||
      coverage.requiredLanguages.length === 0 ||
      coverage.requiredReviewPatterns.length === 0 ||
      coverage.requiredIssueTypes.length === 0 ||
      coverage.requiredSeverities.length === 0) {
    throw new Error("Empirical corpus coverage metadata is malformed.");
  }

  const defectCount = cases.filter((entry) => entry.outcome === "defect").length;
  const cleanCount = cases.length - defectCount;
  if (defectCount !== cleanCount) {
    throw new Error("Empirical corpus defect and clean controls must be balanced.");
  }
  if (defectCount < coverage.minimumCasesPerOutcome) {
    throw new Error("Empirical corpus does not meet its minimum balanced outcome coverage.");
  }
  const languageCounts = new Map<EmpiricalRepositoryLanguage, number>();
  const patternCounts = new Map<EmpiricalReviewPattern, number>();
  const issueTypes = new Set<EmpiricalIssueType>();
  const severities = new Set<EmpiricalSeverity>();
  for (const testCase of cases) {
    const metadata = testCase.metadata!;
    languageCounts.set(metadata.language, (languageCounts.get(metadata.language) ?? 0) + 1);
    patternCounts.set(metadata.reviewPattern, (patternCounts.get(metadata.reviewPattern) ?? 0) + 1);
    metadata.issueTypes.forEach((type) => issueTypes.add(type));
    metadata.severities.forEach((severity) => severities.add(severity));
  }
  if (coverage.requiredLanguages.some((language) => !languageCounts.has(language)) ||
      coverage.requiredReviewPatterns.some((pattern) => !patternCounts.has(pattern)) ||
      coverage.requiredIssueTypes.some((type) => !issueTypes.has(type)) ||
      coverage.requiredSeverities.some((severity) => !severities.has(severity))) {
    throw new Error("Empirical corpus does not meet its required coverage matrix.");
  }
  return {
    minimumCasesPerOutcome: coverage.minimumCasesPerOutcome,
    requiredLanguages: [...coverage.requiredLanguages],
    requiredReviewPatterns: [...coverage.requiredReviewPatterns],
    requiredIssueTypes: [...coverage.requiredIssueTypes],
    requiredSeverities: [...coverage.requiredSeverities],
  };
}

export function validateEmpiricalQualityCorpus(value: unknown): EmpiricalQualityCorpus {
  if (!value || typeof value !== "object") throw new Error("Empirical corpus must be an object.");
  const corpus = value as Partial<EmpiricalQualityCorpus>;
  if (!hasOnlyKeys(value, ["kind", "version", "corpusRevision", "cases", "coverage"]) ||
      corpus.kind !== "empirical-ai-quality-corpus" ||
      (corpus.version !== EMPIRICAL_QUALITY_LEGACY_CORPUS_VERSION &&
       corpus.version !== EMPIRICAL_QUALITY_CORPUS_VERSION)) {
    throw new Error("Empirical corpus kind or version is unsupported.");
  }
  if (corpus.version === EMPIRICAL_QUALITY_CORPUS_VERSION && corpus.coverage === undefined) {
    throw new Error("Empirical corpus v2 requires coverage metadata.");
  }
  if (corpus.version === EMPIRICAL_QUALITY_LEGACY_CORPUS_VERSION && corpus.coverage !== undefined) {
    throw new Error("Empirical corpus coverage metadata requires corpus version 2.");
  }
  if (!isSafeIdentifier(corpus.corpusRevision)) {
    throw new Error("Empirical corpus revision is missing or unsafe.");
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0 || corpus.cases.length > 128) {
    throw new Error("Empirical corpus must contain between 1 and 128 cases.");
  }

  const ids = new Set<string>();
  const cases = corpus.cases.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Empirical corpus case is malformed.");
    const testCase = entry as Partial<EmpiricalCorpusCase>;
    if (!hasOnlyKeys(testCase, [
      "id", "repositoryId", "repositoryUrl", "sourceRevision", "selectedFiles",
      "outcome", "expectedVerdict", "expectedGateDecision", "findings", "metadata",
    ])) {
      throw new Error(`Empirical corpus case ${testCase.id ?? "unknown"} has unsupported metadata.`);
    }
    if (!isSafeIdentifier(testCase.id) || ids.has(testCase.id)) {
      throw new Error("Empirical corpus case IDs must be unique safe identifiers.");
    }
    if (!isSafeIdentifier(testCase.repositoryId) || !isSafeIdentifier(testCase.sourceRevision)) {
      throw new Error(`Empirical corpus case ${testCase.id} has unsafe repository provenance.`);
    }
    if (!isSafeRepositoryUrl(testCase.repositoryUrl)) {
      throw new Error(`Empirical corpus case ${testCase.id} must identify a public HTTPS GitHub repository.`);
    }
    if (!SAFE_GIT_REVISION.test(testCase.sourceRevision!.trim())) {
      throw new Error(`Empirical corpus case ${testCase.id} must pin an immutable Git revision.`);
    }
    if (!Array.isArray(testCase.selectedFiles) || testCase.selectedFiles.length === 0 ||
        testCase.selectedFiles.length > 5 ||
        !testCase.selectedFiles.every(isSafeRelativeFile)) {
      throw new Error(`Empirical corpus case ${testCase.id} has invalid selected files.`);
    }
    if (testCase.outcome !== "defect" && testCase.outcome !== "clean") {
      throw new Error(`Empirical corpus case ${testCase.id} has an invalid outcome.`);
    }
    if (testCase.expectedVerdict !== (testCase.outcome === "defect" ? "findings" : "clean")) {
      throw new Error(`Empirical corpus case ${testCase.id} has an inconsistent expected verdict.`);
    }
    if (testCase.expectedGateDecision !== "accept" && testCase.expectedGateDecision !== "reject") {
      throw new Error(`Empirical corpus case ${testCase.id} has an invalid gate decision.`);
    }
    if (!Array.isArray(testCase.findings) || testCase.findings.length > 64 ||
        !testCase.findings.every(isGroundTruthFinding)) {
      throw new Error(`Empirical corpus case ${testCase.id} has incomplete ground truth.`);
    }
    if (testCase.outcome === "defect" && testCase.findings.length === 0) {
      throw new Error(`Empirical defect case ${testCase.id} must have ground-truth findings.`);
    }
    if (testCase.outcome === "clean" && testCase.findings.length > 0) {
      throw new Error(`Empirical clean case ${testCase.id} cannot have ground-truth findings.`);
    }
    let metadata: EmpiricalCorpusCaseMetadata | undefined;
    if (testCase.metadata !== undefined) {
      if (!testCase.metadata || typeof testCase.metadata !== "object" ||
          !hasOnlyKeys(testCase.metadata, [
            "language", "caseType", "reviewPattern", "issueTypes", "severities",
          ])) {
        throw new Error(`Empirical corpus case ${testCase.id} has unsupported metadata.`);
      }
      const candidate = testCase.metadata as Partial<EmpiricalCorpusCaseMetadata>;
      if (typeof candidate.language !== "string" || !REPOSITORY_LANGUAGES.has(candidate.language) ||
          candidate.caseType !== testCase.outcome ||
          typeof candidate.reviewPattern !== "string" || !REVIEW_PATTERNS.has(candidate.reviewPattern) ||
          candidate.reviewPattern !== (testCase.selectedFiles.length === 1 ? "single-file" : "multi-file") ||
          !isUniqueEnumArray(candidate.issueTypes, ISSUE_TYPES) ||
          !isUniqueEnumArray(candidate.severities, SEVERITIES)) {
        throw new Error(`Empirical corpus case ${testCase.id} has unsupported metadata.`);
      }
      const findingTypes = [...new Set(testCase.findings.map((finding) => finding.type))];
      const findingSeverities = [...new Set(testCase.findings.map((finding) => finding.severity))];
      if (!sameEnumMembers(candidate.issueTypes, findingTypes) ||
          !sameEnumMembers(candidate.severities, findingSeverities)) {
        throw new Error(`Empirical corpus case ${testCase.id} metadata does not match ground truth.`);
      }
      metadata = {
        language: candidate.language,
        caseType: candidate.caseType,
        reviewPattern: candidate.reviewPattern,
        issueTypes: [...candidate.issueTypes],
        severities: [...candidate.severities],
      };
    } else if (corpus.version === EMPIRICAL_QUALITY_CORPUS_VERSION) {
      throw new Error(`Empirical corpus case ${testCase.id} is missing required metadata.`);
    }
    const findingIds = new Set<string>();
    for (const finding of testCase.findings) {
      if (findingIds.has(finding.id)) throw new Error(`Empirical case ${testCase.id} has duplicate finding IDs.`);
      if (!testCase.selectedFiles!.includes(finding.file)) {
        throw new Error(`Empirical case ${testCase.id} has a finding outside its selected files.`);
      }
      findingIds.add(finding.id);
    }
    ids.add(testCase.id);
    return {
      id: testCase.id,
      repositoryId: testCase.repositoryId!,
      repositoryUrl: testCase.repositoryUrl!.trim(),
      sourceRevision: testCase.sourceRevision!,
      selectedFiles: testCase.selectedFiles!.map((file) => file.trim()),
      outcome: testCase.outcome,
      expectedVerdict: testCase.expectedVerdict,
      expectedGateDecision: testCase.expectedGateDecision,
      findings: testCase.findings.map((finding) => ({ ...finding })),
      ...(metadata ? { metadata } : {}),
    };
  });

  if (!cases.some((entry) => entry.outcome === "defect") || !cases.some((entry) => entry.outcome === "clean")) {
    throw new Error("Empirical corpus must include both defect and clean controls.");
  }
  const coverage = corpus.version === EMPIRICAL_QUALITY_CORPUS_VERSION
    ? validateCoverage(corpus.coverage, cases)
    : undefined;
  return {
    kind: "empirical-ai-quality-corpus",
    version: corpus.version,
    corpusRevision: corpus.corpusRevision.trim(),
    cases,
    ...(coverage ? { coverage } : {}),
  };
}

function sameFindingLocation(expected: EmpiricalGroundTruthFinding, observed: EmpiricalObservedFinding): boolean {
  if (expected.file !== observed.file || expected.type !== observed.type) return false;
  if (expected.lineStart === undefined || observed.lineStart === undefined) return true;
  return expected.lineStart === observed.lineStart;
}

function emptyNormalization(): EmpiricalNormalizationCounters {
  return { changedFindingType: 0, changedSeverity: 0, droppedCitation: 0 };
}

function safeNormalization(value: Partial<EmpiricalNormalizationCounters> | undefined): EmpiricalNormalizationCounters {
  return {
    changedFindingType: Math.max(0, Math.min(128, Math.floor(value?.changedFindingType ?? 0))),
    changedSeverity: Math.max(0, Math.min(128, Math.floor(value?.changedSeverity ?? 0))),
    droppedCitation: Math.max(0, Math.min(128, Math.floor(value?.droppedCitation ?? 0))),
  };
}

function safeLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  return /^[a-z0-9][a-z0-9._:/-]{0,199}$/i.test(trimmed)
    ? trimmed
    : `${fallback}-${createHash("sha256").update(trimmed).digest("hex").slice(0, 16)}`;
}

export function scoreEmpiricalQualityCase(
  testCase: EmpiricalCorpusCase,
  observation: EmpiricalCaseObservation,
): EmpiricalCaseScore {
  const expectedFindings = [...testCase.findings];
  const observedFindings = [...observation.observedFindings];
  const matchedExpected = new Set<string>();
  let truePositives = 0;
  let citationCoveredFindings = 0;
  let unsupportedCitations = 0;

  for (const observed of observedFindings) {
    const match = expectedFindings.find((expected) =>
      !matchedExpected.has(expected.id) && sameFindingLocation(expected, observed));
    if (match) {
      matchedExpected.add(match.id);
      truePositives += 1;
      if (observed.citationValid && observed.citationSupported) citationCoveredFindings += 1;
    } else if (!observed.citationValid || !observed.citationSupported) {
      unsupportedCitations += 1;
    }
  }

  const falseNegatives = expectedFindings.length - matchedExpected.size;
  const falsePositives = observedFindings.length - truePositives;
  const semanticVerdictConsistent =
    observation.semanticVerdict === testCase.expectedVerdict;
  const falseAcceptance =
    observation.qualityGateAccepted && testCase.expectedGateDecision === "reject";
  const falseRejection =
    !observation.qualityGateAccepted && testCase.expectedGateDecision === "accept";

  return {
    caseId: testCase.id,
    outcome: observation.outcome,
    truePositives,
    falsePositives,
    falseNegatives,
    citationCoveredFindings,
    unsupportedCitations,
    expectedFindings: expectedFindings.length,
    observedFindings: observedFindings.length,
    contractPassed: observation.contractPassed,
    semanticVerdictConsistent,
    qualityGateAccepted: observation.qualityGateAccepted,
    falseAcceptance,
    falseRejection,
    normalization: safeNormalization(observation.normalization),
    ...(observation.latencyMs === undefined ? {} : {
      latencyMs: Math.max(0, Math.floor(observation.latencyMs)),
    }),
    ...(observation.errorCode ? { errorCode: observation.errorCode } : {}),
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function percentile(values: readonly number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

export function buildEmpiricalQualityScorecard(args: {
  corpus: EmpiricalQualityCorpus;
  results: readonly EmpiricalCaseScore[];
  provider: string;
  model?: string | null;
  generatedAt?: string;
}): EmpiricalQualityScorecard {
  const results = [...args.results].slice(0, args.corpus.cases.length);
  const completed = results.filter((result) => result.outcome === "COMPLETE");
  const latencies = completed.flatMap((result) => result.latencyMs === undefined ? [] : [result.latencyMs]);
  const tp = completed.reduce((sum, result) => sum + result.truePositives, 0);
  const fp = completed.reduce((sum, result) => sum + result.falsePositives, 0);
  const fn = completed.reduce((sum, result) => sum + result.falseNegatives, 0);
  const expectedFindings = completed.reduce((sum, result) => sum + result.expectedFindings, 0);
  const observedFindings = completed.reduce((sum, result) => sum + result.observedFindings, 0);
  const citationCovered = completed.reduce((sum, result) => sum + result.citationCoveredFindings, 0);
  const unsupportedCitations = completed.reduce((sum, result) => sum + result.unsupportedCitations, 0);
  const normalization = completed.reduce((total, result) => ({
    changedFindingType: total.changedFindingType + result.normalization.changedFindingType,
    changedSeverity: total.changedSeverity + result.normalization.changedSeverity,
    droppedCitation: total.droppedCitation + result.normalization.droppedCitation,
  }), emptyNormalization());
  const qualityGateCases = completed.length;
  const falseAcceptanceCount = completed.filter((result) => result.falseAcceptance).length;
  const falseRejectionCount = completed.filter((result) => result.falseRejection).length;
  const completeWithoutGateError = completed.filter((result) =>
    result.contractPassed && result.semanticVerdictConsistent).length;
  const highScoreLowCoverageCount = completed.filter((result) =>
    result.expectedFindings > 0 &&
    result.citationCoveredFindings === 0 &&
    result.qualityGateAccepted).length;
  const totalDurationMs = latencies.reduce((sum, value) => sum + value, 0);
  const status = results.length === args.corpus.cases.length && completed.length === args.corpus.cases.length
    ? "COMPLETE"
    : completed.length === 0 ? "UNAVAILABLE" : "INCOMPLETE";
  const blockers: string[] = [];
  if (results.length !== args.corpus.cases.length) blockers.push("corpus cases incomplete");
  if (results.some((result) => result.outcome === "PROVIDER_UNAVAILABLE")) blockers.push("provider unavailable");
  if (results.some((result) => result.outcome === "TIMEOUT")) blockers.push("campaign timeout");
  if (results.some((result) => result.outcome === "ERROR")) blockers.push("campaign execution error");
  if (completed.some((result) => !result.contractPassed)) blockers.push("contract acceptance failure");
  if (falseAcceptanceCount > 0) blockers.push("false acceptance detected");
  if (falseRejectionCount > 0) blockers.push("false rejection detected");

  const empiricalQualityStatus =
    status === "UNAVAILABLE" ? "UNAVAILABLE" :
      status !== "COMPLETE" ? "INCOMPLETE" :
        blockers.length === 0 && completeWithoutGateError === completed.length ? "PROVEN" : "MEASURED";

  return {
    kind: "empirical-ai-quality-scorecard",
    version: 1,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    corpusRevision: args.corpus.corpusRevision,
    provider: safeLabel(args.provider, "redacted-provider"),
    model: args.model === null || args.model === undefined ? null : safeLabel(args.model, "redacted-model"),
    measurementOnly: true,
    status,
    empiricalQualityStatus,
    cases: results,
    metrics: {
      totalCases: args.corpus.cases.length,
      completedCases: completed.length,
      incompleteCases: args.corpus.cases.length - completed.length,
      providerUnavailableCount: results.filter((result) => result.outcome === "PROVIDER_UNAVAILABLE").length,
      timeoutCount: results.filter((result) => result.outcome === "TIMEOUT").length,
      errorCount: results.filter((result) => result.outcome === "ERROR").length,
      truePositiveCount: tp,
      falsePositiveCount: fp,
      falseNegativeCount: fn,
      precision: rate(tp, tp + fp),
      recall: rate(tp, tp + fn),
      f1: rate(2 * tp, 2 * tp + fp + fn),
      falsePositiveRate: rate(fp, observedFindings),
      falseNegativeRate: rate(fn, expectedFindings),
      citationCoverage: rate(citationCovered, expectedFindings),
      unsupportedCitationRate: rate(unsupportedCitations, observedFindings),
      contractAcceptanceRate: rate(completed.filter((result) => result.contractPassed).length, qualityGateCases),
      semanticVerdictConsistencyRate: rate(completed.filter((result) => result.semanticVerdictConsistent).length, qualityGateCases),
      qualityGateAcceptanceRate: rate(completed.filter((result) => result.qualityGateAccepted).length, qualityGateCases),
      falseAcceptanceRate: rate(falseAcceptanceCount, qualityGateCases),
      falseRejectionRate: rate(falseRejectionCount, qualityGateCases),
      normalizationCounters: normalization,
      highScoreLowCoverageCount,
      latencyMs: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
      },
      throughputPerSecond: totalDurationMs > 0 ? completed.length / (totalDurationMs / 1000) : null,
    },
    blockers,
  };
}

export async function runEmpiricalQualityCampaign(args: {
  corpus: EmpiricalQualityCorpus;
  executeCase: EmpiricalQualityExecutor;
  provider: string;
  model?: string | null;
  caseTimeoutMs?: number;
  campaignTimeoutMs?: number;
  generatedAt?: string;
}): Promise<EmpiricalQualityScorecard> {
  const results: EmpiricalCaseScore[] = [];
  const caseTimeoutMs = args.caseTimeoutMs ?? 90_000;
  const campaignDeadline = args.campaignTimeoutMs === undefined
    ? undefined
    : Date.now() + args.campaignTimeoutMs;
  for (const testCase of args.corpus.cases) {
    const controller = new AbortController();
    const startedAt = Date.now();
    const remainingCampaignMs = campaignDeadline === undefined
      ? caseTimeoutMs
      : Math.min(caseTimeoutMs, campaignDeadline - startedAt);
    if (remainingCampaignMs <= 0) {
      results.push(scoreEmpiricalQualityCase(testCase, {
        caseId: testCase.id,
        outcome: "TIMEOUT",
        contractPassed: false,
        qualityGateAccepted: false,
        semanticVerdict: "unknown",
        observedFindings: [],
        errorCode: "TIMEOUT",
        latencyMs: 0,
      }));
      continue;
    }
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const observation = await Promise.race([
        args.executeCase(testCase, controller.signal),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            controller.abort();
            reject(new Error("EMPIRICAL_CAMPAIGN_TIMEOUT"));
          }, remainingCampaignMs);
        }),
      ]);
      results.push(scoreEmpiricalQualityCase(testCase, {
        ...observation,
        caseId: testCase.id,
        latencyMs: observation.latencyMs ?? Date.now() - startedAt,
      }));
    } catch (error) {
      const timedOut = controller.signal.aborted ||
        (error instanceof Error && error.message === "EMPIRICAL_CAMPAIGN_TIMEOUT");
      results.push(scoreEmpiricalQualityCase(testCase, {
        caseId: testCase.id,
        outcome: timedOut ? "TIMEOUT" : "ERROR",
        contractPassed: false,
        qualityGateAccepted: false,
        semanticVerdict: "unknown",
        observedFindings: [],
        errorCode: timedOut ? "TIMEOUT" : "EXECUTION_ERROR",
        latencyMs: Date.now() - startedAt,
      }));
      void error;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
  return buildEmpiricalQualityScorecard({
    corpus: args.corpus,
    results,
    provider: args.provider,
    model: args.model,
    generatedAt: args.generatedAt,
  });
}