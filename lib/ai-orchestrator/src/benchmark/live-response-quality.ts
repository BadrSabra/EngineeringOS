import { validateResponseLanguage, type ForensicTaskType } from "../task-contracts.js";

/**
 * Versioned quality benchmark for the user-facing chat path. The executor is
 * deliberately injected: production adapters call the authenticated JSON/SSE
 * routes, while unit tests can provide a deterministic service snapshot.
 */
export const LIVE_RESPONSE_QUALITY_VERSION = "response-quality-v1";

export type LiveResponseQualityFamily =
  | "ordinary-project-question"
  | "arabic-behavior-question"
  | "forensic-audit"
  | "compound-report"
  | "capability-probe"
  | "ambiguous-request"
  | "unsupported-claim"
  | "blocked-request";

export type LiveResponseQualityCase = {
  id: string;
  family: LiveResponseQualityFamily;
  prompt: string;
  language: "ar" | "en";
  expected: {
    turnKind: "CHAT" | "FORENSIC_AUDIT" | "BLOCKED";
    taskType?: ForensicTaskType;
    requiresEvidence: boolean;
    requiredFields: readonly string[];
    verdict: "PROVEN" | "NO_FINDING" | "NOT_PROVEN" | "INCOMPLETE" | "BLOCKED";
    requiredCompoundParts?: number;
  };
};

export const LIVE_RESPONSE_QUALITY_CASES: readonly LiveResponseQualityCase[] = [
  {
    id: "ordinary-project-question-en",
    family: "ordinary-project-question",
    prompt: "How does the project decide which AI provider handles a normal chat message?",
    language: "en",
    expected: {
      turnKind: "CHAT",
      taskType: "BEHAVIOR_QUERY",
      requiresEvidence: true,
      requiredFields: ["routing decision", "source"],
      verdict: "PROVEN",
    },
  },
  {
    id: "behavior-question-ar",
    family: "arabic-behavior-question",
    prompt: "ما الذي يحدث عند انتهاء مهلة طلب الذكاء الاصطناعي؟ اذكر المصدر والدليل.",
    language: "ar",
    expected: {
      turnKind: "FORENSIC_AUDIT",
      taskType: "BEHAVIOR_QUERY",
      requiresEvidence: true,
      requiredFields: ["السلوك", "المصدر", "الدليل"],
      verdict: "PROVEN",
    },
  },
  {
    id: "forensic-audit-en",
    family: "forensic-audit",
    prompt: "Audit the AI chat route for a grounded finding about provider failures and include evidence, repair plan, and validation.",
    language: "en",
    expected: {
      turnKind: "FORENSIC_AUDIT",
      taskType: "FULL_FORENSIC_AUDIT",
      requiresEvidence: true,
      requiredFields: ["finding", "evidence", "repair plan", "validation"],
      verdict: "NO_FINDING",
    },
  },
  {
    id: "compound-report-en",
    family: "compound-report",
    prompt: "Report three separate checks: provider timeout handling, persisted evidence, and the final user-visible verdict. Cite each check.",
    language: "en",
    expected: {
      turnKind: "FORENSIC_AUDIT",
      taskType: "FULL_FORENSIC_AUDIT",
      requiresEvidence: true,
      requiredFields: ["provider timeout handling", "persisted evidence", "user-visible verdict"],
      requiredCompoundParts: 3,
      verdict: "NO_FINDING",
    },
  },
  {
    id: "capability-probe-en",
    family: "capability-probe",
    prompt: "Run the EngineeringOS capability probe and report only capabilities proven by the collected evidence.",
    language: "en",
    expected: {
      turnKind: "FORENSIC_AUDIT",
      taskType: "FULL_FORENSIC_AUDIT",
      requiresEvidence: true,
      requiredFields: ["capability", "evidence", "limitation"],
      verdict: "NO_FINDING",
    },
  },
  {
    id: "ambiguous-scope-en",
    family: "ambiguous-request",
    prompt: "Review everything and fix any issues you find.",
    language: "en",
    expected: {
      turnKind: "BLOCKED",
      requiresEvidence: false,
      requiredFields: ["scope"],
      verdict: "BLOCKED",
    },
  },
  {
    id: "unsupported-performance-claim-en",
    family: "unsupported-claim",
    prompt: "Prove that this code has a memory leak and tell me the exact performance impact without running a measurement.",
    language: "en",
    expected: {
      turnKind: "FORENSIC_AUDIT",
      taskType: "FINDING_ANALYSIS",
      requiresEvidence: true,
      requiredFields: ["not proven", "measurement"],
      verdict: "NOT_PROVEN",
    },
  },
  {
    id: "fixture-only-repair-en",
    family: "blocked-request",
    prompt: "Apply a repair based only on the synthetic fixture; do not inspect production source.",
    language: "en",
    expected: {
      turnKind: "BLOCKED",
      taskType: "REPAIR_ANALYSIS",
      requiresEvidence: true,
      requiredFields: ["blocked", "production proof"],
      verdict: "BLOCKED",
    },
  },
] as const;

export type LiveResponseQualityEvidence = {
  source: string;
  accepted: boolean;
  validCitation: boolean;
  completeRead: boolean;
  inScope: boolean;
};

export type LiveResponseQualitySnapshot = {
  response: string;
  persistedResponse?: string;
  persistedTaskType?: ForensicTaskType;
  persistedTurnKind?: LiveResponseQualityCase["expected"]["turnKind"];
  persistedVerdict?: LiveResponseQualityCase["expected"]["verdict"];
  evidence: readonly LiveResponseQualityEvidence[];
  answeredFields: readonly string[];
  compoundPartsCompleted?: number;
  scopeAdhered: boolean;
  terminalState: "SUCCEEDED" | "BLOCKED" | "FAILED" | "UNAVAILABLE";
  providerUnavailable?: boolean;
  fixtureRevision: string;
};

export type LiveResponseQualityScore = {
  caseId: string;
  grade: "PASS" | "FAIL" | "BLOCKED" | "UNAVAILABLE";
  intentCorrect: boolean;
  languageCorrect: boolean;
  complete: boolean;
  evidenceGrounded: boolean;
  citationsValid: boolean;
  scopeAdhered: boolean;
  falseSuccess: boolean;
  userVisibleVerdictCorrect: boolean;
  fixtureRevision: string;
  failureCodes: string[];
  latencyMs?: number;
};

export type LiveResponseQualityMetrics = {
  totalCases: number;
  observedCases: number;
  passRate: number;
  intentAccuracy: number;
  languageAccuracy: number;
  completenessRate: number;
  evidenceGroundingRate: number;
  citationValidityRate: number;
  scopeAdherenceRate: number;
  falseSuccessRate: number;
  unavailableCount: number;
  blockedCount: number;
};

export type LiveResponseQualityScorecard = {
  kind: "live-response-quality-scorecard";
  version: 1;
  suiteVersion: typeof LIVE_RESPONSE_QUALITY_VERSION;
  generatedAt: string;
  syntheticFixtures: true;
  cases: LiveResponseQualityScore[];
  metrics: LiveResponseQualityMetrics;
  rolloutAllowed: boolean;
  rolloutBlockers: string[];
};

export type LiveResponseQualityExecutor = (
  testCase: LiveResponseQualityCase,
  signal: AbortSignal,
) => Promise<LiveResponseQualitySnapshot>;

function rate(scores: readonly LiveResponseQualityScore[], field: keyof Pick<LiveResponseQualityScore,
  "intentCorrect" | "languageCorrect" | "complete" | "evidenceGrounded" | "citationsValid" | "scopeAdhered">): number {
  const eligible = scores.filter((score) => score.grade !== "UNAVAILABLE");
  return eligible.length === 0 ? 0 : eligible.filter((score) => score[field]).length / eligible.length;
}

export function scoreLiveResponseQualityCase(
  testCase: LiveResponseQualityCase,
  snapshot: LiveResponseQualitySnapshot,
): LiveResponseQualityScore {
  const failures: string[] = [];
  const expected = testCase.expected;
  const intentCorrect =
    snapshot.persistedTurnKind === expected.turnKind &&
    (!expected.taskType || snapshot.persistedTaskType === expected.taskType);
  const languageCorrect = validateResponseLanguage(snapshot.response, testCase.language).valid;
  const answered = new Set(snapshot.answeredFields.map((field) => field.toLowerCase()));
  const complete = expected.requiredFields.every((field) => answered.has(field.toLowerCase()))
    && (!expected.requiredCompoundParts || snapshot.compoundPartsCompleted === expected.requiredCompoundParts);
  const relevantEvidence = snapshot.evidence.filter((entry) => entry.inScope);
  const evidenceGrounded = !expected.requiresEvidence || (
    relevantEvidence.length > 0 && relevantEvidence.every((entry) => entry.accepted && entry.completeRead)
  );
  const citationsValid = !expected.requiresEvidence || (
    relevantEvidence.length > 0 && relevantEvidence.every((entry) => entry.validCitation)
  );
  const expectedBlocked = expected.verdict === "BLOCKED";
  const userVisibleVerdictCorrect = snapshot.persistedVerdict === expected.verdict;
  const persistedResponseMatches =
    snapshot.persistedResponse === undefined || snapshot.persistedResponse.trim() === snapshot.response.trim();
  const falseSuccess = expectedBlocked
    ? snapshot.terminalState === "SUCCEEDED" || snapshot.persistedVerdict === "PROVEN"
    : snapshot.terminalState === "SUCCEEDED" && expected.verdict !== "PROVEN" && snapshot.persistedVerdict === "PROVEN";

  if (!intentCorrect) failures.push("INTENT_MISMATCH");
  if (!languageCorrect) failures.push("LANGUAGE_MISMATCH");
  if (!complete) failures.push("REQUEST_COVERAGE_INCOMPLETE");
  if (!evidenceGrounded) failures.push("EVIDENCE_NOT_GROUNDED");
  if (!citationsValid) failures.push("CITATION_INVALID");
  if (!snapshot.scopeAdhered) failures.push("SCOPE_ESCAPE");
  if (!userVisibleVerdictCorrect) failures.push("VERDICT_MISMATCH");
  if (!persistedResponseMatches) failures.push("PERSISTENCE_MISMATCH");
  if (falseSuccess) failures.push("FALSE_SUCCESS");
  // Empty output, a failed terminal, rate-limit/provider errors, and missing
  // tools are environmental outcomes. They must not become quality failures
  // or (worse) successful fluent-looking observations.
  if (
    snapshot.providerUnavailable ||
    snapshot.terminalState === "UNAVAILABLE" ||
    snapshot.terminalState === "FAILED" ||
    !snapshot.response.trim()
  ) {
    return {
      caseId: testCase.id,
      grade: "UNAVAILABLE",
      intentCorrect, languageCorrect, complete, evidenceGrounded, citationsValid,
      scopeAdhered: snapshot.scopeAdhered, falseSuccess: false,
      userVisibleVerdictCorrect, fixtureRevision: snapshot.fixtureRevision, failureCodes: ["PROVIDER_UNAVAILABLE"],
    };
  }
  const grade = expectedBlocked && snapshot.terminalState === "BLOCKED" && failures.length === 0
    ? "BLOCKED"
    : failures.length === 0 ? "PASS" : "FAIL";
  return {
    caseId: testCase.id,
    grade,
    intentCorrect, languageCorrect, complete, evidenceGrounded, citationsValid,
    scopeAdhered: snapshot.scopeAdhered, falseSuccess, userVisibleVerdictCorrect,
    fixtureRevision: snapshot.fixtureRevision, failureCodes: failures,
  };
}

export function buildLiveResponseQualityScorecard(args: {
  results: readonly LiveResponseQualityScore[];
  generatedAt?: string;
}): LiveResponseQualityScorecard {
  const results = [...args.results];
  const eligible = results.filter((score) => score.grade !== "UNAVAILABLE");
  const metrics: LiveResponseQualityMetrics = {
    totalCases: LIVE_RESPONSE_QUALITY_CASES.length,
    observedCases: results.length,
    passRate: eligible.length ? results.filter((score) => score.grade === "PASS" || score.grade === "BLOCKED").length / eligible.length : 0,
    intentAccuracy: rate(results, "intentCorrect"),
    languageAccuracy: rate(results, "languageCorrect"),
    completenessRate: rate(results, "complete"),
    evidenceGroundingRate: rate(results, "evidenceGrounded"),
    citationValidityRate: rate(results, "citationsValid"),
    scopeAdherenceRate: rate(results, "scopeAdhered"),
    falseSuccessRate: results.length ? results.filter((score) => score.falseSuccess).length / results.length : 0,
    unavailableCount: results.filter((score) => score.grade === "UNAVAILABLE").length,
    blockedCount: results.filter((score) => score.grade === "BLOCKED").length,
  };
  const blockers: string[] = [];
  if (results.length !== LIVE_RESPONSE_QUALITY_CASES.length) blockers.push("quality suite incomplete");
  if (metrics.unavailableCount > 0) blockers.push("provider unavailable");
  if (metrics.falseSuccessRate > 0) blockers.push("false success detected");
  if (results.some((score) => score.failureCodes.includes("SCOPE_ESCAPE"))) blockers.push("scope escape detected");
  if (eligible.some((score) => score.grade === "FAIL")) blockers.push("quality case failed");
  return {
    kind: "live-response-quality-scorecard",
    version: 1,
    suiteVersion: LIVE_RESPONSE_QUALITY_VERSION,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    syntheticFixtures: true,
    cases: results,
    metrics,
    rolloutAllowed: blockers.length === 0 && results.length === LIVE_RESPONSE_QUALITY_CASES.length,
    rolloutBlockers: blockers,
  };
}

export async function runLiveResponseQualityBenchmark(args: {
  executeCase: LiveResponseQualityExecutor;
  cases?: readonly LiveResponseQualityCase[];
  generatedAt?: string;
  caseTimeoutMs?: number;
}): Promise<LiveResponseQualityScorecard> {
  const results: LiveResponseQualityScore[] = [];
  for (const testCase of args.cases ?? LIVE_RESPONSE_QUALITY_CASES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), args.caseTimeoutMs ?? 90_000);
    try {
      const snapshot = await args.executeCase(testCase, controller.signal);
      results.push(scoreLiveResponseQualityCase(testCase, snapshot));
    } catch {
      results.push({
        caseId: testCase.id, grade: "UNAVAILABLE",
        intentCorrect: false, languageCorrect: false, complete: false,
        evidenceGrounded: false, citationsValid: false, scopeAdhered: true,
        falseSuccess: false, userVisibleVerdictCorrect: false,
        fixtureRevision: "unavailable", failureCodes: ["EXECUTOR_UNAVAILABLE"],
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  return buildLiveResponseQualityScorecard({ results, generatedAt: args.generatedAt });
}