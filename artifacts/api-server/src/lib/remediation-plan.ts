import type {
  RemediationEvidence,
  RemediationPlan,
  RemediationPlanStatus,
  RuleVerificationCheck,
} from "@workspace/db";

export const REMEDIATION_PLAN_LIMITS = {
  maxEvidence: 100,
  maxFiles: 20,
  maxSnippetLength: 240,
  maxTextLength: 2_000,
  maxVerificationSteps: 20,
} as const;

export function buildRuleVerificationChecks(
  verificationSteps: string[],
): RuleVerificationCheck[] {
  return verificationSteps.map((guidance, index) => ({
    id: `rule-verification-${index + 1}`,
    kind: "operator_attestation",
    guidance,
  }));
}

function boundedText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.slice(0, max);
}

function boundedEvidence(matches: RemediationEvidence[] | undefined): RemediationEvidence[] {
  if (!Array.isArray(matches)) return [];
  return matches.slice(0, REMEDIATION_PLAN_LIMITS.maxEvidence).map((match) => ({
    file: String(match.file).slice(0, REMEDIATION_PLAN_LIMITS.maxTextLength),
    line: Math.max(1, Math.floor(Number(match.line) || 1)),
    snippet: String(match.snippet ?? "").slice(0, REMEDIATION_PLAN_LIMITS.maxSnippetLength),
    occurrences: Math.max(0, Math.floor(Number(match.occurrences) || 0)),
  }));
}

function planStatus(
  fixDescription: string | null,
  verificationSteps: string[],
  evidence: RemediationEvidence[],
): RemediationPlanStatus {
  return fixDescription && verificationSteps.length > 0 && evidence.length > 0
    ? "ready"
    : "needs_review";
}

export interface RemediationPlanInput {
  ruleId?: string | null;
  ruleCode: string;
  ruleTitle: string;
  severity: string;
  occurrenceCount: number;
  matches?: RemediationEvidence[];
  fixDescription?: string | null;
  verificationSteps?: string[];
  source: RemediationPlan["source"];
}

export function buildRemediationPlan(input: RemediationPlanInput): RemediationPlan {
  const evidence = boundedEvidence(input.matches);
  const relatedFiles = [...new Set(evidence.map((match) => match.file))].slice(
    0,
    REMEDIATION_PLAN_LIMITS.maxFiles,
  );
  const verificationSteps = (input.verificationSteps ?? [])
    .filter((step): step is string => typeof step === "string" && step.trim().length > 0)
    .slice(0, REMEDIATION_PLAN_LIMITS.maxVerificationSteps)
    .map((step) => step.slice(0, REMEDIATION_PLAN_LIMITS.maxTextLength));
  const verificationChecks = buildRuleVerificationChecks(verificationSteps);
  const fixDescription = boundedText(
    input.fixDescription,
    REMEDIATION_PLAN_LIMITS.maxTextLength,
  );

  return {
    version: 1,
    ruleId: input.ruleId ?? null,
    ruleCode: input.ruleCode.slice(0, REMEDIATION_PLAN_LIMITS.maxTextLength),
    ruleTitle: input.ruleTitle.slice(0, REMEDIATION_PLAN_LIMITS.maxTextLength),
    severity: input.severity.slice(0, 40),
    occurrenceCount: Math.max(0, Math.min(10_000, Math.floor(input.occurrenceCount))),
    evidence,
    relatedFiles,
    fixDescription,
    verificationSteps,
    verificationChecks,
    source: {
      type: input.source.type,
      correlationId: input.source.correlationId?.slice(0, 120) ?? null,
      revision: input.source.revision?.slice(0, 128) ?? null,
      completeness: input.source.completeness ?? null,
    },
    status: planStatus(fixDescription, verificationSteps, evidence),
  };
}

export function buildRemediationPrompt(plan: RemediationPlan): string {
  const evidence = plan.evidence.length
    ? plan.evidence
        .map(
          (match) =>
            `- ${match.file}:${match.line} (${match.occurrences} occurrence(s)): ${match.snippet}`,
        )
        .join("\n")
    : "- Evidence is unavailable; do not infer affected files or code.";
  const files = plan.relatedFiles.length ? plan.relatedFiles.join(", ") : "none recorded";
  const verification = plan.verificationSteps.length
    ? plan.verificationSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")
    : "No verification steps were supplied; request human review before claiming completion.";

  return [
    "Remediate this verified rule violation using only the supplied evidence.",
    `Rule: ${plan.ruleCode} — ${plan.ruleTitle}`,
    `Severity: ${plan.severity}`,
    `Occurrences: ${plan.occurrenceCount}`,
    `Affected files: ${files}`,
    `Recommended fix: ${plan.fixDescription ?? "Not supplied; do not invent a fix."}`,
    "Evidence:",
    evidence,
    "Required verification:",
    verification,
    `Source: ${plan.source.type}; revision ${plan.source.revision ?? "not available"}.`,
    "Do not report success unless the required verification passes explicitly. If evidence or fix guidance is missing, stop and request human review.",
  ].join("\n");
}

export function markRemediationPlanVerified(
  plan: RemediationPlan | null | undefined,
  verified: boolean,
): RemediationPlan | null | undefined {
  if (!plan) return plan;
  return {
    ...plan,
    status: verified ? "verified" : plan.status === "verified" ? "ready" : plan.status,
  };
}