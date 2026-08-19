import type { ToolDefinition } from "./file-tools.js";
import type { PendingChange } from "../schemas/chat.schema.js";
import { randomUUID } from "node:crypto";
import type {
  ValidationFailure,
  ValidationResult,
  ValidationStatus,
} from "../validation-result.js";

/** Named state of an approval-gated repair handoff. */
export type RepairLoopState = "VALIDATING" | "REPAIRING" | "READY_FOR_REVIEW" | "BLOCKED";

/**
 * Hard upper bound for server-owned repair attempts.
 *
 * Callers may choose a smaller budget for a child loop, but no execution path
 * may expand a repair handoff beyond this limit.
 */
export const MAX_REPAIR_ATTEMPTS = 5;

export type ValidationToolResult = ValidationResult;

type LegacyValidationRunnerResult = {
  status: ValidationStatus;
  profile?: string;
  scenario?: string;
  command?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  failedTests?: string[];
  affectedFiles?: string[];
  detail?: string;
};

export type ValidationRunner = (
  profile: string,
  targetPaths: string[],
  signal?: AbortSignal,
  pendingChanges?: readonly PendingChange[],
) => Promise<ValidationResult | LegacyValidationRunnerResult>;

function unavailableValidation(profile: string, detail: string): ValidationResult {
  const evidenceId = randomUUID();
  return {
    profile,
    status: "unavailable",
    scenario: "Registered validation was not executed.",
    exitCode: null,
    command: "",
    stdout: "",
    stderr: "",
    failedTests: [],
    changedFiles: [],
    evidence: {
      evidenceId,
      observedAt: new Date().toISOString(),
      artifactRef: `validation-attempt:${evidenceId}`,
    },
    detail,
  };
}

function normalizeValidationResult(
  profile: string,
  result: ValidationResult | LegacyValidationRunnerResult,
): ValidationResult {
  if (
    "evidence" in result
    && result.evidence
    && typeof result.evidence.evidenceId === "string"
  ) {
    return result;
  }
  const legacy = result as LegacyValidationRunnerResult;
  const evidenceId = randomUUID();
  const failedTests: ValidationFailure[] = (legacy.failedTests ?? []).map((message) => ({
    name: message,
    message,
  }));
  return {
    profile: legacy.profile ?? profile,
    status: legacy.status,
    scenario: legacy.scenario ?? "Legacy validation runner result.",
    exitCode: legacy.exitCode ?? null,
    command: legacy.command ?? "",
    stdout: legacy.stdout ?? "",
    stderr: legacy.stderr ?? "",
    failedTests,
    changedFiles: legacy.affectedFiles ?? [],
    evidence: {
      evidenceId,
      observedAt: new Date().toISOString(),
      artifactRef: `validation-result:${evidenceId}`,
    },
    detail: legacy.detail,
  };
}

export const EXECUTION_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "run_validation",
      description:
        "Run one registered project validation against the server-approved implementation files. Choose only a profile that matches the current implementation plan. Do not invent command names, paths, or test arguments.",
      parameters: {
        type: "object",
        properties: {
          profile: {
            type: "string",
            description:
              "Registered validation profile name, for example 'workspace-typecheck' or 'ai-orchestrator-tests'.",
          },
        },
        required: ["profile"],
        additionalProperties: false,
      },
    },
  },
];

export async function executeValidationTool(
  name: string,
  args: Record<string, string>,
  targetPaths: string[],
  runner: ValidationRunner | undefined,
  signal?: AbortSignal,
  pendingChanges?: readonly PendingChange[],
): Promise<string> {
  if (name !== "run_validation") {
    throw new Error(`Unknown execution tool "${name}".`);
  }
  if (!runner) {
    const result = unavailableValidation(
      args.profile?.trim() ?? "",
      "Validation execution is not enabled for this request.",
    );
    return JSON.stringify({
      tool: name,
      ...result,
      code: "VALIDATION_RUNNER_UNAVAILABLE",
    });
  }
  const profile = args.profile?.trim();
  if (!profile) {
    const result = unavailableValidation("", "A registered validation profile is required.");
    return JSON.stringify({
      tool: name,
      ...result,
      code: "VALIDATION_PROFILE_REQUIRED",
    });
  }
  const hasPendingChanges = (pendingChanges?.length ?? 0) > 0;
  const rawResult = !hasPendingChanges && signal === undefined
    ? await runner(profile, targetPaths)
    : !hasPendingChanges
      ? await runner(profile, targetPaths, signal)
      : await runner(profile, targetPaths, signal, pendingChanges);
  const result = normalizeValidationResult(profile, rawResult);
  return JSON.stringify({ tool: name, ...result });
}