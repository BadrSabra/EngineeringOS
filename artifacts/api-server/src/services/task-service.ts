/**
 * Task domain service — extracted from routes/tasks.ts (audit finding W-003).
 *
 * Contains the verification logic that determines task completion status.
 * No HTTP concerns live here; the route handler owns request parsing,
 * authentication, DB claim/update, event/audit emission, and HTTP response.
 *
 * ⚠️  This module is NOT purely functional — it reads from the database:
 *   1. `db.select().from(rulesTable)` — to resolve the rule pattern for tasks
 *      that have a `ruleId`.
 *   2. `walkProject(projectRootPath)` — which performs filesystem I/O.
 *
 * PR-05 fix: the original header incorrectly described this as "pure
 * verification logic". Callers and unit tests must account for both the DB
 * dependency (inject/mock `db`) and the filesystem dependency (`projectRootPath`
 * must exist on disk or walkProject will throw).
 */
import { walkProject, walkProjectFiles, checkPatternInFiles } from "@workspace/scanner";
import { db, rulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildRuleVerificationChecks } from "../lib/remediation-plan.js";

export interface VerificationStep {
  id?: string;
  name: string;
  kind?: "automatic" | "operator_attestation";
  guidance?: string;
  passed: boolean;
  evidence?: string;
  output?: string;
}

export type TaskFinalStatus = "completed" | "failed" | "verifying";

export interface VerificationOutcome {
  finalStatus: TaskFinalStatus;
  steps: VerificationStep[];
  /** Human-readable summary for the task log and verification result column. */
  summary: string;
}

/**
 * Task shape expected by `runTaskVerification`.
 * Matches the columns used by the execute handler.
 */
export interface VerifiableTask {
  id: string;
  ruleId: string | null;
  relatedFiles: unknown; // stored as JSON; cast inside
  remediationPlan?: {
    status: "needs_review" | "ready" | "verified";
    evidence: unknown;
    verificationSteps: unknown;
    verificationChecks?: unknown;
  } | null;
}

const MAX_VERIFICATION_RELATED_FILES = 100;

function parseRelatedFiles(value: unknown): { paths: string[]; valid: boolean } {
  if (value === null || value === undefined) return { paths: [], valid: true };
  if (!Array.isArray(value) || value.length > MAX_VERIFICATION_RELATED_FILES) {
    return { paths: [], valid: false };
  }

  const paths: string[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.trim() !== candidate ||
      candidate.startsWith("/") ||
      candidate.includes("\\") ||
      candidate.includes(String.fromCharCode(0)) ||
      candidate.split("/").some((segment) =>
        segment.length === 0 || segment === "." || segment === ".."
      )
    ) {
      return { paths: [], valid: false };
    }
    if (!paths.includes(candidate)) paths.push(candidate);
  }
  return { paths, valid: true };
}

function planVerificationChecks(
  plan: VerifiableTask["remediationPlan"],
): Array<{ id: string; kind: "operator_attestation"; guidance: string }> {
  if (!plan) return [];
  if (Array.isArray(plan.verificationChecks)) {
    return plan.verificationChecks.filter(
      (check): check is { id: string; kind: "operator_attestation"; guidance: string } =>
        Boolean(
          check &&
            typeof check === "object" &&
            typeof (check as { id?: unknown }).id === "string" &&
            (check as { kind?: unknown }).kind === "operator_attestation" &&
            typeof (check as { guidance?: unknown }).guidance === "string",
        ),
    );
  }
  if (Array.isArray(plan.verificationSteps)) {
    return buildRuleVerificationChecks(
      plan.verificationSteps.filter((step): step is string => typeof step === "string"),
    );
  }
  return [];
}

function appendPendingGuidanceChecks(
  steps: VerificationStep[],
  plan: VerifiableTask["remediationPlan"],
): VerificationStep[] {
  return [
    ...steps,
    ...planVerificationChecks(plan).map((check) => ({
      id: check.id,
      name: `Rule verification ${check.id.replace("rule-verification-", "#")}`,
      kind: check.kind,
      guidance: check.guidance,
      passed: false,
      output: "Not recorded — operator evidence is required",
    })),
  ];
}

function outcomeWithGuidance(
  steps: VerificationStep[],
  plan: VerifiableTask["remediationPlan"],
  finalStatus: TaskFinalStatus,
  summary: string,
): VerificationOutcome {
  return {
    finalStatus,
    steps: appendPendingGuidanceChecks(steps, plan),
    summary,
  };
}

/**
 * Run the verification pipeline for a task:
 *
 *   1. If the task has a `ruleId` with a pattern → scan the project rootPath
 *      and check whether the rule pattern is still present in related files.
 *   2. If the task has `relatedFiles` but no rule pattern → verify the files exist.
 *   3. Neither → land on `verifying` (awaiting AI / human confirmation step).
 *
 * Returns a `VerificationOutcome` that the route handler persists as
 * `verificationResult` and uses to set the final task status.
 *
 * Does **not** mutate DB state — that is the route handler's responsibility.
 */
export async function runTaskVerification(
  task: VerifiableTask,
  projectRootPath: string,
): Promise<VerificationOutcome> {
  const steps: VerificationStep[] = [];
  const relatedFileResult = parseRelatedFiles(task.relatedFiles);
  if (!relatedFileResult.valid) {
    steps.push({
      name: "File reference validation",
      passed: false,
      output: "Related file references are invalid or exceed the supported limit",
    });
    return outcomeWithGuidance(
      steps,
      task.remediationPlan,
      "verifying",
      "Verification blocked — related file references are invalid",
    );
  }
  const relatedFiles = relatedFileResult.paths;

  // A plan with incomplete evidence or no supplied checks can be reviewed,
  // but it cannot be promoted to a verified task by pattern disappearance
  // alone. This preserves the distinction between an analysis suggestion and
  // explicit remediation verification.
  if (
    task.remediationPlan &&
    (task.remediationPlan.status === "needs_review" ||
      !Array.isArray(task.remediationPlan.evidence) ||
      task.remediationPlan.evidence.length === 0 ||
      !Array.isArray(task.remediationPlan.verificationSteps) ||
      task.remediationPlan.verificationSteps.length === 0)
  ) {
    steps.push({
      name: "Remediation plan review",
      passed: false,
      output: "Plan evidence or verification guidance is incomplete — human review is required",
    });
    return {
      finalStatus: "verifying",
      steps,
      summary: "Verification blocked — remediation plan requires human review",
    };
  }

  // ── Resolve rule pattern (if any) ────────────────────────────────────────
  let rulePattern: string | null = null;
  if (task.ruleId) {
    const rule = await db
      .select()
      .from(rulesTable)
      .where(eq(rulesTable.id, task.ruleId))
      .limit(1);
    rulePattern = rule[0]?.pattern ?? null;
  }

  // Evidence-backed tasks need only inspect the exact files that produced
  // their server-owned related-file evidence. Tasks without file evidence
  // retain the full-project fallback.
  const targetedScan = relatedFiles.length > 0
    ? await walkProjectFiles(projectRootPath, relatedFiles)
    : null;

  // ── Branch 1: rule pattern present → scan + pattern check ────────────────
  if (rulePattern) {
    const targetFiles = targetedScan
      ? targetedScan.files
      : (await walkProject(projectRootPath)).files;

    if (
      targetedScan &&
      (
        targetedScan.missingPaths.length > 0 ||
        targetedScan.incomplete ||
        targetFiles.some((file) => file.oversized)
      )
    ) {
      const details = [
        ...targetedScan.missingPaths.map((path) => `missing: ${path}`),
        ...(targetedScan.incomplete ? ["targeted scan was incomplete"] : []),
        ...(targetFiles.some((file) => file.oversized) ? ["one or more files exceeded the content limit"] : []),
      ];
      steps.push({
        name: "File scan",
        passed: false,
        output: `Required evidence files could not be fully inspected — ${details.join("; ")}`,
      });
      return outcomeWithGuidance(
        steps,
        task.remediationPlan,
        "verifying",
        "Verification inconclusive — required evidence files were not fully inspected",
      );
    }

    if (targetFiles.length > 0 || relatedFiles.length === 0) {
      const patternStillPresent = checkPatternInFiles(rulePattern, targetFiles);
      steps.push({
        name: "Pattern check",
        passed: !patternStillPresent,
        output: patternStillPresent
          ? `Pattern still found in ${targetFiles.length > 0 ? "target" : "project"} files`
          : "Pattern no longer detected — fix confirmed",
      });
      const finalStatus: TaskFinalStatus = patternStillPresent ? "failed" : "completed";
      if (task.remediationPlan) {
        return outcomeWithGuidance(
          steps,
          task.remediationPlan,
          patternStillPresent ? "failed" : "verifying",
          patternStillPresent
            ? "Task incomplete — rule pattern still present in codebase"
            : "Pattern check passed — operator verification evidence is still required",
        );
      }
      return {
        finalStatus,
        steps,
        summary: patternStillPresent
          ? "Task incomplete — rule pattern still present in codebase"
          : "Task verified — rule pattern no longer detected",
      };
    }
  }

  // ── Branch 2: related files only → exact-path existence check ───────────
  if (relatedFiles.length > 0) {
    const missing = targetedScan?.missingPaths ?? relatedFiles;

    if (missing.length === 0) {
      steps.push({ name: "File existence check", passed: true, output: "All related files present" });
      if (task.remediationPlan) {
        return outcomeWithGuidance(
          steps,
          task.remediationPlan,
          "verifying",
          "File check passed — operator verification evidence is still required",
        );
      }
      return {
        finalStatus: "completed",
        steps,
        summary: "Task verified — all related files exist in project",
      };
    } else {
      steps.push({
        name: "File existence check",
        passed: false,
        output: `Missing files: ${missing.join(", ")}`,
      });
      return outcomeWithGuidance(
        steps,
        task.remediationPlan,
        "verifying",
        "Related files not yet present — awaiting implementation",
      );
    }
  }

  // ── Branch 3: no automation signal → hand off to AI / human ──────────────
  if (task.remediationPlan) {
    return outcomeWithGuidance(
      [],
      task.remediationPlan,
      "verifying",
      "Operator verification evidence is required before completion",
    );
  }
  steps.push({
    name: "Manual verification required",
    passed: false,
    output: "No rule pattern or related files — task requires AI or human verification",
  });
  return outcomeWithGuidance(
    steps,
    task.remediationPlan,
    "verifying",
    "No automated verification signal — awaiting AI or human confirmation",
  );
}
