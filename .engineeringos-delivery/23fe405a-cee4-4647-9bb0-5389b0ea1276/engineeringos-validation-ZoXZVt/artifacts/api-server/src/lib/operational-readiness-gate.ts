import type { EvidenceCompleteness, OperationEvidenceProjection } from "./operation-evidence.js";
import { redactUserFacingText } from "./ai-route-helpers.js";

export const OPERATIONAL_READINESS_VERSION = 1;

export type ReadinessCheckStatus = "passed" | "failed" | "not-applicable";
export type ReadinessCheck = {
  id: string;
  status: ReadinessCheckStatus;
  blocking: boolean;
  detail: string;
  recoveryAction?: string;
};

export type ReadinessCampaignFinding = {
  id: string;
  status: "passed" | "failed" | "not-applicable";
  blocking: boolean;
  detail: string;
  recoveryAction?: string;
};

export type OperationalReadinessInput = {
  operationId: string;
  projectId: string;
  projectRevision: string | null;
  candidateRevision?: string | null;
  candidateIdentity?: string | null;
  approvedScope: readonly string[];
  operationState: string;
  evidenceCompleteness: EvidenceCompleteness;
  evidenceRefs: readonly string[];
  terminalVerdict?: string | null;
  requiredNodes: readonly { id: string; status: string; evidenceRefs?: readonly string[] }[];
  campaign?: {
    operationId: string;
    revision: string | null;
    findings: readonly ReadinessCampaignFinding[];
  };
};

export type OperationalReadinessDecision = {
  kind: "operational-readiness-decision";
  version: typeof OPERATIONAL_READINESS_VERSION;
  operationId: string;
  projectId: string;
  status: "proven" | "incomplete" | "blocked" | "failed";
  releaseRecommendation: "ready" | "not-ready";
  deterministicProof: "proven" | "not-proven";
  optionalExternalObservation: "not-evaluated" | "evaluated";
  evaluatedAt: string;
  checks: ReadinessCheck[];
  blockers: string[];
  recoveryActions: string[];
};

const ACTIONS = {
  objective: "Recreate the operation with a machine-checkable objective and required acceptance checks.",
  scope: "Bind the operation to an explicitly approved server-owned scope before retrying.",
  revision: "Refresh the operation and candidate from the current project revision.",
  candidate: "Rebuild and validate the immutable candidate workspace before promotion.",
  nodes: "Resume or repair the failed validation nodes within their existing retry budget.",
  evidence: "Retain redacted operation evidence and rerun the required checks.",
  terminal: "Reconcile the operation to a terminal server-owned verdict; do not infer success from model text.",
  campaign: "Run the affected campaign cases in an isolated fixture and attach their redacted findings.",
} as const;

function check(
  id: string,
  ok: boolean,
  detail: string,
  blocking = true,
  recoveryAction?: string,
): ReadinessCheck {
  return { id, status: ok ? "passed" : "failed", blocking, detail: redactUserFacingText(detail).slice(0, 500), ...(ok ? {} : { recoveryAction }) };
}

export function evaluateOperationalReadiness(
  input: OperationalReadinessInput,
  options: { evaluatedAt?: string } = {},
): OperationalReadinessDecision {
  const checks: ReadinessCheck[] = [];
  checks.push(check("objective-and-acceptance", input.requiredNodes.length > 0,
    input.requiredNodes.length > 0 ? "Required execution nodes are bound." : "No executable acceptance nodes are retained.", true, ACTIONS.objective));
  checks.push(check("approved-scope", input.approvedScope.length > 0,
    input.approvedScope.length > 0 ? "Approved target scope is retained." : "No approved target scope is retained.", true, ACTIONS.scope));
  checks.push(check("project-revision", Boolean(input.projectRevision),
    input.projectRevision ? "Project revision is retained." : "Project revision is missing.", true, ACTIONS.revision));
  const candidateMatchesProject = Boolean(
    input.candidateRevision && input.candidateIdentity && input.candidateRevision === input.projectRevision,
  );
  checks.push(check("candidate-revision", candidateMatchesProject,
    input.candidateRevision && input.candidateIdentity
      ? candidateMatchesProject
        ? "Candidate identity and revision match the project."
        : "Candidate revision does not match the project revision."
      : "Candidate identity or revision is missing.", true, ACTIONS.candidate));
  const nodesPassed = input.requiredNodes.length > 0 && input.requiredNodes.every((node) => node.status === "passed");
  checks.push(check("required-validation-nodes", nodesPassed,
    nodesPassed ? "All required execution nodes passed." : "One or more required execution nodes did not pass.", true, ACTIONS.nodes));
  const evidenceOkay = input.evidenceCompleteness === "complete" && input.evidenceRefs.length > 0;
  checks.push(check("retained-redacted-evidence", evidenceOkay,
    evidenceOkay ? "Complete redacted evidence is retained." : `Evidence is ${input.evidenceCompleteness} or has no retained references.`, true, ACTIONS.evidence));
  const terminal = ["succeeded", "completed"].includes(input.operationState.toLowerCase());
  const verdictOkay = terminal && input.terminalVerdict === "PROVEN";
  checks.push(check("terminal-proven-verdict", verdictOkay,
    verdictOkay ? "The server recorded a terminal PROVEN verdict." : "A terminal PROVEN verdict is not recorded.", true, ACTIONS.terminal));

  if (input.campaign) {
    const bound = input.campaign.operationId === input.operationId && input.campaign.revision === input.projectRevision;
    checks.push(check("campaign-binding", bound, bound ? "Campaign findings match operation and revision." : "Campaign findings are stale or bound to another operation.", true, ACTIONS.campaign));
    for (const finding of input.campaign.findings) {
      checks.push({
        id: `campaign:${finding.id}`,
        status: finding.status,
        blocking: finding.blocking,
        detail: redactUserFacingText(finding.detail).slice(0, 500),
        ...(finding.status === "failed" ? { recoveryAction: finding.recoveryAction ?? ACTIONS.campaign } : {}),
      });
    }
  } else {
    checks.push({ id: "campaign-observation", status: "not-applicable", blocking: false, detail: "Optional external campaign observation was not evaluated." });
  }

  const blockers = checks.filter((item) => item.status === "failed" && item.blocking).map((item) => item.id);
  const recoveryActions = [...new Set(checks.flatMap((item) => item.status === "failed" && item.recoveryAction ? [item.recoveryAction] : []))];
  const cancelled = ["cancelled", "cancelling"].includes(input.operationState.toLowerCase()) || input.evidenceCompleteness === "cancelled";
  const failed = ["failed", "error"].includes(input.operationState.toLowerCase()) || input.evidenceCompleteness === "failed";
  const status = blockers.length === 0
    ? "proven"
    : failed ? "failed"
      : cancelled || ["partial", "retained-with-gaps", "uncertain"].includes(input.evidenceCompleteness) ? "incomplete"
        : "blocked";
  return {
    kind: "operational-readiness-decision",
    version: OPERATIONAL_READINESS_VERSION,
    operationId: input.operationId,
    projectId: input.projectId,
    status,
    releaseRecommendation: status === "proven" ? "ready" : "not-ready",
    deterministicProof: status === "proven" ? "proven" : "not-proven",
    optionalExternalObservation: input.campaign ? "evaluated" : "not-evaluated",
    evaluatedAt: options.evaluatedAt ?? new Date().toISOString(),
    checks,
    blockers,
    recoveryActions,
  };
}

export function evaluateReadinessFromEvidence(
  evidence: OperationEvidenceProjection,
  input: Pick<OperationalReadinessInput, "approvedScope" | "candidateRevision" | "candidateIdentity" | "requiredNodes" | "terminalVerdict" | "campaign">,
  options: { evaluatedAt?: string } = {},
): OperationalReadinessDecision {
  return evaluateOperationalReadiness({
    operationId: evidence.operationId,
    projectId: evidence.projectId,
    projectRevision: evidence.revision,
    operationState: evidence.terminalState,
    evidenceCompleteness: evidence.completeness,
    evidenceRefs: evidence.receipts.map((receipt) => `${receipt.kind}:${receipt.timestamp}`),
    ...input,
  }, options);
}