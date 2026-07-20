/**
 * Task domain service — extracted from routes/tasks.ts (audit finding W-003).
 *
 * Contains the pure verification logic that determines task completion status.
 * No HTTP concerns live here; the route handler owns request parsing,
 * authentication, DB claim/update, event/audit emission, and HTTP response.
 *
 * Keeping this logic in a separate module makes it independently testable
 * without spinning up an HTTP server.
 */
import { walkProject, checkPatternInFiles } from "@workspace/scanner";
import { db, rulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface VerificationStep {
  name: string;
  passed: boolean;
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
  const relatedFiles = (task.relatedFiles as string[] | null) ?? [];

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

  // ── Branch 1: rule pattern present → scan + pattern check ────────────────
  if (rulePattern) {
    const { files: projectFiles } = await walkProject(projectRootPath);

    let targetFiles = projectFiles;
    if (relatedFiles.length > 0) {
      targetFiles = projectFiles.filter((f) =>
        relatedFiles.some(
          (rf) => f.path === rf || f.path.endsWith("/" + rf) || f.path.endsWith(rf),
        ),
      );

      if (targetFiles.length === 0 && projectFiles.length > 0) {
        steps.push({
          name: "File scan",
          passed: false,
          output: "relatedFiles specified but none found in project tree — cannot confirm fix",
        });
        return {
          finalStatus: "verifying",
          steps,
          summary: "Verification inconclusive — related files not found in project tree",
        };
      }
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
      return {
        finalStatus,
        steps,
        summary: patternStillPresent
          ? "Task incomplete — rule pattern still present in codebase"
          : "Task verified — rule pattern no longer detected",
      };
    }
  }

  // ── Branch 2: related files only → existence check ───────────────────────
  if (relatedFiles.length > 0) {
    const { files: projectFiles } = await walkProject(projectRootPath);
    const projectPaths = new Set(projectFiles.map((f) => f.path));
    const missing = relatedFiles.filter(
      (rf) =>
        !projectPaths.has(rf) &&
        ![...projectPaths].some((p) => p.endsWith("/" + rf) || p.endsWith(rf)),
    );

    if (missing.length === 0) {
      steps.push({ name: "File existence check", passed: true, output: "All related files present" });
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
      return {
        finalStatus: "verifying",
        steps,
        summary: "Related files not yet present — awaiting implementation",
      };
    }
  }

  // ── Branch 3: no automation signal → hand off to AI / human ──────────────
  steps.push({
    name: "Manual verification required",
    passed: false,
    output: "No rule pattern or related files — task requires AI or human verification",
  });
  return {
    finalStatus: "verifying",
    steps,
    summary: "No automated verification signal — awaiting AI or human confirmation",
  };
}
