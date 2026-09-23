/**
 * Server-owned decision for a validated delivery candidate.
 *
 * This is intentionally narrower than capability autonomy. Capability policy
 * decides whether a registered operation may run; this module decides whether
 * an already materialized file candidate is safe enough to be eligible for a
 * future automatic promotion. It never grants write authority by itself.
 */
import type { PairedBaselineComparison } from "@workspace/ai-orchestrator";

export const DELIVERY_PROMOTION_DECISIONS = [
  "AUTO_PROMOTE_ELIGIBLE",
  "REVIEW_REQUIRED",
  "BLOCKED",
] as const;

export type DeliveryPromotionDecision = typeof DELIVERY_PROMOTION_DECISIONS[number];

export type DeliveryPromotionReason =
  | "candidate_integrity_missing"
  | "candidate_drift"
  | "change_set_drift"
  | "validation_missing"
  | "validation_failed"
  | "approval_required"
  | "sensitive_path"
  | "scope_not_auto_promotable"
  | "change_set_too_large"
  | "paired_baseline_missing"
  | "paired_baseline_incomplete"
  | "paired_baseline_regressed"
  | "eligible";

export type PromotionChange = {
  path: string;
  newContent: string;
  originalContent?: string | null;
};

export type PromotionValidation = {
  status?: string;
  evidence?: {
    candidateHash?: string;
    candidateTreeHash?: string;
    changeSetHash?: string;
    treeDigestVersion?: string;
  };
};

export type DeliveryPromotionInput = {
  changes: readonly PromotionChange[];
  validationResults: readonly PromotionValidation[];
  expectedCandidateTreeHash?: string | null;
  observedCandidateTreeHash?: string | null;
  expectedChangeSetHash?: string | null;
  observedChangeSetHash?: string | null;
  expectedTreeDigestVersion?: string | null;
  observedTreeDigestVersion?: string | null;
  approvalRequired: boolean;
  /**
   * Legacy/manual delivery callers may omit this. Callers entering the
   * explicit Gate 3 path must provide a server-owned comparison.
   */
  pairedBaseline?: Pick<PairedBaselineComparison, "status" | "promotionAllowed">;
  requirePairedBaseline?: boolean;
};

export type DeliveryPromotionResult = {
  decision: DeliveryPromotionDecision;
  reasons: readonly DeliveryPromotionReason[];
};

const MAX_AUTO_PROMOTION_FILES = 5;
const MAX_AUTO_PROMOTION_BYTES = 100_000;

const SENSITIVE_PATH_RE =
  /(?:^|\/)(?:\.env(?:\..*)?|\.git(?:\/|$)|\.ssh(?:\/|$)|\.github\/workflows(?:\/|$)|secrets?(?:\/|$)|credentials?(?:\/|$)|certificates?(?:\/|$)|keys?(?:\/|$)|.*\.(?:pem|key|p12|pfx|crt|cer|der|pub|rsa|dsa))/iu;

const SAFE_EXTENSION_RE = /\.(?:md|mdx|txt|test\.[cm]?[jt]sx?|spec\.[cm]?[jt]sx?)$/iu;
const SAFE_DIRECTORY_RE = /^(?:docs?|tests?|__tests__|specs?)(?:\/|$)/iu;

function normalizePath(filePath: string): string {
  return filePath.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isAutoPromotablePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!normalized || SENSITIVE_PATH_RE.test(normalized)) return false;
  const basename = normalized.split("/").at(-1) ?? normalized;
  return (
    /^README(?:\.[^/]+)?$/iu.test(basename)
    || SAFE_DIRECTORY_RE.test(normalized) && SAFE_EXTENSION_RE.test(normalized)
  );
}

function hasMatchingCandidateEvidence(
  validation: PromotionValidation,
  input: DeliveryPromotionInput,
): boolean {
  const evidence = validation.evidence;
  if (!evidence) return false;
  if (
    input.expectedTreeDigestVersion
    && evidence.treeDigestVersion !== input.expectedTreeDigestVersion
  ) return false;
  const candidateEvidence = evidence.candidateTreeHash ?? evidence.candidateHash;
  if (
    input.expectedCandidateTreeHash
    && candidateEvidence !== input.expectedCandidateTreeHash
  ) return false;
  if (
    input.expectedChangeSetHash
    && evidence.changeSetHash !== input.expectedChangeSetHash
  ) return false;
  return true;
}

/**
 * Decide whether a delivery candidate is eligible for a future automatic
 * promotion. The conservative path policy is deliberate: source, config,
 * dependency, deployment, and credential changes remain review-required even
 * when their validation happens to pass.
 */
export function decideDeliveryPromotion(
  input: DeliveryPromotionInput,
): DeliveryPromotionResult {
  const reasons: DeliveryPromotionReason[] = [];

  if (
    !input.expectedCandidateTreeHash
    || !input.observedCandidateTreeHash
    || !input.expectedChangeSetHash
    || !input.observedChangeSetHash
    || !input.expectedTreeDigestVersion
    || !input.observedTreeDigestVersion
  ) {
    return {
      decision: "BLOCKED",
      reasons: ["candidate_integrity_missing"],
    };
  }

  if (input.expectedCandidateTreeHash !== input.observedCandidateTreeHash) {
    return {
      decision: "BLOCKED",
      reasons: ["candidate_drift"],
    };
  }
  if (input.expectedChangeSetHash !== input.observedChangeSetHash) {
    return {
      decision: "BLOCKED",
      reasons: ["change_set_drift"],
    };
  }
  if (
    input.expectedTreeDigestVersion
    && input.observedTreeDigestVersion !== input.expectedTreeDigestVersion
  ) {
    return {
      decision: "BLOCKED",
      reasons: ["candidate_drift"],
    };
  }

  if (input.requirePairedBaseline && !input.pairedBaseline) {
    return {
      decision: "BLOCKED",
      reasons: ["paired_baseline_missing"],
    };
  }
  if (input.pairedBaseline?.status === "incomplete") {
    return {
      decision: "BLOCKED",
      reasons: ["paired_baseline_incomplete"],
    };
  }
  if (
    input.pairedBaseline &&
    (input.pairedBaseline.status === "regressed" ||
      input.pairedBaseline.promotionAllowed !== true)
  ) {
    return {
      decision: "BLOCKED",
      reasons: ["paired_baseline_regressed"],
    };
  }

  if (input.changes.length === 0 || input.validationResults.length === 0) {
    return {
      decision: "BLOCKED",
      reasons: ["validation_missing"],
    };
  }
  if (
    input.changes.length > MAX_AUTO_PROMOTION_FILES
    || input.changes.reduce((total, change) => total + Buffer.byteLength(change.newContent, "utf8"), 0)
      > MAX_AUTO_PROMOTION_BYTES
  ) {
    reasons.push("change_set_too_large");
  }
  if (input.approvalRequired) reasons.push("approval_required");

  if (input.changes.some((change) => SENSITIVE_PATH_RE.test(normalizePath(change.path)))) {
    reasons.push("sensitive_path");
  }
  if (input.changes.some((change) => !isAutoPromotablePath(change.path))) {
    reasons.push("scope_not_auto_promotable");
  }
  if (input.validationResults.some((validation) => validation.status !== "passed")) {
    reasons.push("validation_failed");
  }
  if (input.validationResults.some((validation) => !hasMatchingCandidateEvidence(validation, input))) {
    reasons.push("candidate_integrity_missing");
  }

  if (reasons.length > 0) {
    return {
      decision: reasons.includes("candidate_integrity_missing")
        || reasons.includes("candidate_drift")
        || reasons.includes("change_set_drift")
        || reasons.includes("validation_failed")
        || reasons.includes("validation_missing")
        ? "BLOCKED"
        : "REVIEW_REQUIRED",
      reasons,
    };
  }

  return {
    decision: "AUTO_PROMOTE_ELIGIBLE",
    reasons: ["eligible"],
  };
}

/**
 * Explicit Gate 3 promotion entry point. Existing delivery callers retain
 * their compatibility behavior, while candidate promotion can opt into the
 * stricter server-owned paired comparison.
 */
export function decideDeliveryPromotionWithPairedBaseline(
  input: Omit<DeliveryPromotionInput, "pairedBaseline" | "requirePairedBaseline">,
  pairedBaseline: Pick<PairedBaselineComparison, "status" | "promotionAllowed"> | undefined,
): DeliveryPromotionResult {
  return decideDeliveryPromotion({
    ...input,
    pairedBaseline,
    requirePairedBaseline: true,
  });
}