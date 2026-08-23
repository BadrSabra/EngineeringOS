import type { ToolDefinition } from "./file-tools.js";
import type { PendingChange } from "../schemas/chat.schema.js";
import { randomUUID } from "node:crypto";
import type {
  ValidationFailure,
  ValidationResult,
  ValidationStatus,
} from "../validation-result.js";
import path from "node:path";
import { runBoundedCommand, EXECUTION_LIMITS, type BoundedCommandResult } from "../execution-kernel.js";

/** Named state of an approval-gated repair handoff. */
export type RepairLoopState = "VALIDATING" | "REPAIRING" | "READY_FOR_REVIEW" | "BLOCKED";

/**
 * Hard upper bound for server-owned repair attempts.
 *
 * Callers may choose a smaller budget for a child loop, but no execution path
 * may expand a repair handoff beyond this limit.
 */
export const MAX_REPAIR_ATTEMPTS = 3;

export type ValidationToolResult = ValidationResult;

/** A server-owned command profile. The model selects a profile, never a shell. */
export type CommandProfile = {
  name: string;
  command: string;
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
  cwd?: string;
  allowedOperations?: readonly string[];
  allowedPaths?: readonly string[];
};

export type CommandRunner = (request: {
  profile: CommandProfile;
  rootPath: string;
  signal?: AbortSignal;
  operationId?: string;
  revision?: string;
  targetPaths?: readonly string[];
}) => Promise<BoundedCommandResult>;

/** Default adapter used by the API layer after it has selected a profile. */
export const runRegisteredCommand: CommandRunner = async ({
  profile,
  rootPath,
  signal,
}) => runBoundedCommand({
  command: profile.command,
  args: [...profile.args],
  rootPath,
  cwd: profile.cwd ? path.resolve(rootPath, profile.cwd) : rootPath,
  timeoutMs: profile.timeoutMs,
  maxOutputBytes: profile.maxOutputBytes,
  allowedCommands: new Set([path.basename(profile.command).toLowerCase()]),
  signal,
});

export const COMMAND_PROFILE_LIMITS = {
  maxProfiles: 32,
  maxArgs: 64,
} as const;

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
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run one server-registered, non-shell project command. Choose only a registered profile; never invent a command, shell expression, cwd, or arguments.",
      parameters: {
        type: "object",
        properties: {
          profile: { type: "string", description: "Server-registered command profile name." },
        },
        required: ["profile"],
        additionalProperties: false,
      },
    },
  },
];

function commandResultCode(status: BoundedCommandResult["status"]): string {
  return status === "passed" ? "COMMAND_PASSED"
    : status === "timed_out" ? "COMMAND_TIMED_OUT"
      : status === "cancelled" ? "COMMAND_CANCELLED"
        : status === "spawn_error" ? "COMMAND_SPAWN_ERROR"
          : "COMMAND_FAILED";
}

function commandResultDetail(result: BoundedCommandResult): string {
  return result.status === "passed"
    ? "Registered command completed successfully."
    : result.status === "timed_out"
      ? "Registered command exceeded its server timeout."
      : result.status === "cancelled"
        ? "Registered command was cancelled before completion."
        : result.status === "spawn_error"
          ? "Registered command could not be started."
          : "Registered command exited unsuccessfully.";
}

export async function executeCommandTool(
  name: string,
  args: Record<string, string>,
  rootPath: string,
  profiles: readonly CommandProfile[] | undefined,
  runner: CommandRunner | undefined,
  signal?: AbortSignal,
  context?: { operationId?: string; revision?: string; targetPaths?: readonly string[]; operation?: string },
): Promise<string> {
  if (name !== "run_command") throw new Error(`Unknown execution tool "${name}".`);
  const profileName = args.profile?.trim();
  const profile = profiles?.find((candidate) => candidate.name === profileName);
  if (!profile) {
    return JSON.stringify({
      tool: name, status: "unavailable", code: "COMMAND_PROFILE_NOT_REGISTERED",
      detail: "The requested command profile is not registered by the server.",
    });
  }
  if (profile.allowedOperations && context?.operation &&
      !profile.allowedOperations.includes(context.operation)) {
    return JSON.stringify({
      tool: name, status: "unavailable", code: "COMMAND_OPERATION_NOT_ALLOWED",
      detail: "The command profile is not approved for this operation.",
    });
  }
  if (profile.allowedPaths && context?.targetPaths &&
      context.targetPaths.some((target) => !profile.allowedPaths?.includes(target))) {
    return JSON.stringify({
      tool: name, status: "unavailable", code: "COMMAND_PATH_SCOPE_REJECTED",
      detail: "The command profile is not approved for the requested file scope.",
    });
  }
  if (!runner) {
    return JSON.stringify({
      tool: name, status: "unavailable", code: "COMMAND_RUNNER_UNAVAILABLE",
      detail: "Command execution is not enabled for this request.",
    });
  }
  if (profile.args.length > COMMAND_PROFILE_LIMITS.maxArgs ||
      profile.timeoutMs < 1 || profile.timeoutMs > EXECUTION_LIMITS.maxTimeoutMs ||
      profile.maxOutputBytes < 1 || profile.maxOutputBytes > EXECUTION_LIMITS.maxOutputBytes) {
    return JSON.stringify({
      tool: name, status: "unavailable", code: "COMMAND_PROFILE_INVALID",
      detail: "The server command profile violates execution limits.",
    });
  }
  const result = await runner({ profile, rootPath, signal, ...context });
  return JSON.stringify({
    tool: name,
    status: result.status,
    code: commandResultCode(result.status),
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    combinedOutput: result.combinedOutput,
    truncated: result.truncated,
    durationMs: result.durationMs,
    detail: commandResultDetail(result),
  });
}

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