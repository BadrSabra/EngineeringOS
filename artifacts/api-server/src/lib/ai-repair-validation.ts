import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  runBoundedCommand,
  type ValidationProfile,
  type ValidationFailure as SharedValidationFailure,
  type ValidationResult,
  type ValidationStatus,
} from "@workspace/ai-orchestrator";
import {
  verifyBrowserPreview,
  type PreviewBrowser,
  type PreviewSession,
  type PreviewStep,
} from "./browser-preview-verification.js";

export type RepairVerificationStatus = ValidationStatus;
export type ValidationFailure = SharedValidationFailure;
/**
 * Legacy runner fixtures can still be supplied to the compatibility adapter.
 * New validation results returned by runRepairValidation are always canonical.
 */
export type RepairVerificationResult =
  | ValidationResult
  | {
      status: RepairVerificationStatus;
      profile?: ValidationProfile;
      scenario?: string;
      command?: string;
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
      failedTests?: string[];
      affectedFiles?: string[];
      detail?: string;
    };

export type PendingValidationChange = {
  path: string;
  newContent: string;
};

export type RuntimeOracleCommand = {
  command: "pnpm";
  args: readonly string[];
  timeoutMs?: number;
};

type ValidationProfileDefinition = {
  scenario: string;
  allowedPath: (relativePath: string) => boolean;
  command: string;
  args: string[];
  timeoutMs: number;
  maxBuffer: number;
};

const PROFILE_DEFINITIONS: Record<ValidationProfile, ValidationProfileDefinition> = {
  "ai-orchestrator-tests": {
    scenario: "Run the focused AI orchestrator Vitest suite.",
    allowedPath: (file) => file === "lib/ai-orchestrator" || file.startsWith("lib/ai-orchestrator/"),
    command: "pnpm",
    args: ["--filter", "@workspace/ai-orchestrator", "exec", "vitest", "run"],
    timeoutMs: 120_000,
    maxBuffer: 2_000_000,
  },
  "knowledge-engine-tests": {
    scenario: "Run the focused knowledge engine Vitest suite.",
    allowedPath: (file) => file === "lib/knowledge-engine" || file.startsWith("lib/knowledge-engine/"),
    command: "pnpm",
    args: ["--filter", "@workspace/knowledge-engine", "exec", "vitest", "run"],
    timeoutMs: 120_000,
    maxBuffer: 2_000_000,
  },
  "api-ai-tests": {
    scenario: "Run the AI API route Vitest suite.",
    allowedPath: (file) =>
      file === "artifacts/api-server/src/routes/ai.test.ts" ||
      file.startsWith("artifacts/api-server/src/routes/ai/"),
    command: "pnpm",
    args: ["--filter", "@workspace/api-server", "exec", "vitest", "run", "src/routes/ai.test.ts"],
    timeoutMs: 120_000,
    maxBuffer: 2_000_000,
  },
  "workspace-typecheck": {
    scenario: "Run the workspace TypeScript typecheck.",
    allowedPath: (file) => file.length > 0 && !file.startsWith("../"),
    command: "pnpm",
    args: ["run", "typecheck"],
    timeoutMs: 180_000,
    maxBuffer: 2_000_000,
  },
};

const VALIDATION_OUTPUT_LIMIT = 12_000;
const VALIDATION_DETAIL_LIMIT = 4_000;
const VALIDATION_COPY_OMIT = new Set([
  ".git",
  "node_modules",
  "attached_assets",
  ".cache",
  ".agents",
  ".local",
  "docs",
  "coverage",
]);

type ValidationDraft = Omit<ValidationResult, "evidence">;

async function createValidationWorkspace(
  rootPath: string,
  pendingChanges: readonly PendingValidationChange[],
): Promise<{ rootPath: string; cleanup: () => Promise<void> }> {
  if (pendingChanges.length === 0) {
    return { rootPath, cleanup: async () => {} };
  }

  // Project roots may be symlinks (for example, imported projects or isolated
  // test fixtures). Resolve the source before copying: fs.cp treats a symlink
  // passed as the directory source as a non-directory when the destination
  // already exists, which would fail closed before the overlay is materialized.
  const sourceRoot = await fs.realpath(rootPath);
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "engineeringos-validation-"));
  try {
    await fs.cp(sourceRoot, workspaceRoot, {
      recursive: true,
      dereference: false,
      filter: (source) => {
        const relative = path.relative(sourceRoot, source);
        const firstSegment = relative.split(path.sep)[0];
        return !VALIDATION_COPY_OMIT.has(firstSegment);
      },
    });

    const originalModules = path.join(sourceRoot, "node_modules");
    const overlayModules = path.join(workspaceRoot, "node_modules");
    await fs.mkdir(overlayModules, { recursive: true });
    for (const entry of await fs.readdir(originalModules, { withFileTypes: true })) {
      const originalEntry = path.join(originalModules, entry.name);
      const overlayEntry = path.join(overlayModules, entry.name);
      if (entry.name !== "@workspace") {
        await fs.symlink(originalEntry, overlayEntry);
        continue;
      }
      await fs.mkdir(overlayEntry, { recursive: true });
      for (const workspacePackage of await fs.readdir(originalEntry, { withFileTypes: true })) {
        const packagePath = workspacePackage.name === "api-server"
          ? path.join(workspaceRoot, "artifacts/api-server")
          : workspacePackage.name === "dashboard"
            ? path.join(workspaceRoot, "artifacts/dashboard")
            : path.join(workspaceRoot, "lib", workspacePackage.name);
        await fs.symlink(packagePath, path.join(overlayEntry, workspacePackage.name));
      }
    }

    for (const change of pendingChanges) {
      const relative = change.path.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
      const target = path.resolve(workspaceRoot, relative);
      if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
        throw new Error(`Pending validation path escapes the project root: ${change.path}`);
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, change.newContent, "utf8");
    }

    return {
      rootPath: workspaceRoot,
      cleanup: async () => {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

function bounded(value: string): string {
  return value.length > VALIDATION_OUTPUT_LIMIT
    ? value.slice(-VALIDATION_OUTPUT_LIMIT)
    : value;
}

function boundedDetail(value: string): string {
  return value.length > VALIDATION_DETAIL_LIMIT
    ? value.slice(-VALIDATION_DETAIL_LIMIT)
    : value;
}

function extractFailedTests(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /(?:^FAIL\b|\bFAIL\b|failed|✕|×)/i.test(line))
    .filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index)
    .slice(0, 20);
}

function toValidationFailure(line: string): ValidationFailure {
  const match = line.match(/^(.*?)(?::(\d+))?:\s*(.+)$/);
  return {
    name: match?.[1]?.trim() || "validation failure",
    ...(match?.[2] ? { line: Number(match[2]) } : {}),
    message: match?.[3]?.trim() || line,
  };
}

function emptyValidationDraft(
  profile: string,
  status: ValidationStatus,
  scenario: string,
  detail: string,
): ValidationDraft {
  const definition = PROFILE_DEFINITIONS[profile as ValidationProfile];
  return {
    profile,
    status,
    scenario,
    command: definition ? [definition.command, ...definition.args].join(" ") : "",
    exitCode: null,
    stdout: "",
    stderr: "",
    failedTests: [],
    changedFiles: [],
    detail,
  };
}

function attachValidationEvidence(result: ValidationDraft): ValidationResult {
  const evidenceId = randomUUID();
  return {
    ...result,
    evidence: {
      evidenceId,
      observedAt: new Date().toISOString(),
      artifactRef: `validation-result:${evidenceId}`,
    },
  };
}

function extractAffectedFiles(output: string): string[] {
  const paths = output.match(
    /(?:^|[\s("'`])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json))(?:[:)\s"'`]|$)/g,
  ) ?? [];
  return paths
    .map((match) => match.trim().replace(/^[\s("'`]+|[:)\s"'`]+$/g, ""))
    .filter((file, index, files) => file.length > 0 && files.indexOf(file) === index)
    .slice(0, 20);
}

export function getRepairValidationProfile(profile: ValidationProfile): ValidationProfileDefinition {
  return PROFILE_DEFINITIONS[profile];
}

export function validateRepairValidationScope(
  profile: ValidationProfile,
  relativePaths: string[],
): string | null {
  const definition = PROFILE_DEFINITIONS[profile];
  if (!definition) return `Validation profile "${profile}" is unavailable.`;
  if (relativePaths.length === 0) return "No changed files were provided for behavioral verification.";
  const invalid = relativePaths.find((file) => !definition.allowedPath(file));
  return invalid
    ? `Validation profile "${profile}" does not cover changed file "${invalid}".`
    : null;
}

async function runRepairValidationCore(
  rootPath: string,
  profile: ValidationProfile,
  relativePaths: string[],
  signal?: AbortSignal,
  pendingChanges: readonly PendingValidationChange[] = [],
): Promise<ValidationDraft> {
  const definition = PROFILE_DEFINITIONS[profile];
  if (!definition) {
    return emptyValidationDraft(
      profile,
      "unavailable",
      "Registered validation profile is unavailable.",
      `Validation profile "${profile}" is unavailable.`,
    );
  }

  const scopeError = validateRepairValidationScope(profile, relativePaths);
  if (scopeError) {
    return emptyValidationDraft(profile, "unavailable", definition.scenario, scopeError);
  }

  let validationWorkspace: { rootPath: string; cleanup: () => Promise<void> } | undefined;
  try {
    validationWorkspace = await createValidationWorkspace(rootPath, pendingChanges);
    await fs.access(path.resolve(validationWorkspace.rootPath, "package.json"));
  } catch {
    await validationWorkspace?.cleanup();
    return emptyValidationDraft(
      profile,
      "unavailable",
      definition.scenario,
      pendingChanges.length > 0
        ? "The pending changes could not be materialized into an isolated validation workspace."
        : "The project root does not contain a package.json for the registered validation.",
    );
  }

  try {
    const validationRootPath = validationWorkspace.rootPath;
    const execution = await runBoundedCommand({
      command: definition.command,
      args: definition.args,
      rootPath: validationRootPath,
      cwd: validationRootPath,
      timeoutMs: definition.timeoutMs,
      maxOutputBytes: definition.maxBuffer,
      allowedCommands: new Set(["pnpm"]),
      signal,
    });
    const output = execution.combinedOutput.trim();
    const command = [definition.command, ...definition.args].join(" ");
    const executionEvidence = {
      command,
      exitCode: execution.exitCode,
      stdout: bounded(execution.stdout),
      stderr: bounded(execution.stderr),
      failedTests: extractFailedTests(output),
      changedFiles: extractAffectedFiles(output),
    };
    if (execution.status !== "passed") {
      return {
        status: "failed",
        profile,
        scenario: definition.scenario,
        ...executionEvidence,
        failedTests: executionEvidence.failedTests.map(toValidationFailure),
        detail:
          execution.status === "timed_out"
            ? "Registered validation timed out."
            : boundedDetail(output) || `Registered validation failed with status ${execution.status}.`,
      };
    }
    return {
      status: "passed",
      profile,
      scenario: definition.scenario,
        ...executionEvidence,
        failedTests: executionEvidence.failedTests.map(toValidationFailure),
      detail: output.slice(-2_000) || "Registered validation completed successfully.",
    };
  } catch (error) {
    const executionError = error as NodeJS.ErrnoException & {
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      code?: string | number;
    };
    const output = `${executionError.stdout ?? ""}${executionError.stderr ? `\n${executionError.stderr}` : ""}`.trim();
    const reason = executionError.killed
      ? "Registered validation timed out."
        : boundedDetail(output) || executionError.message || "Registered validation failed.";
    return {
      status: "failed",
      profile,
      scenario: definition.scenario,
      command: [definition.command, ...definition.args].join(" "),
      exitCode: typeof executionError.code === "number" ? executionError.code : null,
      stdout: bounded(executionError.stdout ?? ""),
      stderr: bounded(executionError.stderr ?? ""),
      failedTests: extractFailedTests(output).map(toValidationFailure),
      changedFiles: extractAffectedFiles(output),
      detail: reason,
    };
  } finally {
    await validationWorkspace.cleanup();
  }
}

export async function runRepairValidation(
  rootPath: string,
  profile: ValidationProfile,
  relativePaths: string[],
  signal?: AbortSignal,
  pendingChanges: readonly PendingValidationChange[] = [],
): Promise<ValidationResult> {
  const result = await runRepairValidationCore(rootPath, profile, relativePaths, signal, pendingChanges);
  return attachValidationEvidence(result);
}

/**
 * Execute a server-registered behavioral oracle against pending changes without
 * mutating the live workspace. The command and arguments come from a fixture,
 * never from model output.
 */
export async function runRepairRuntimeOracle(
  rootPath: string,
  pendingChanges: readonly PendingValidationChange[],
  command: RuntimeOracleCommand,
  signal?: AbortSignal,
): Promise<{ status: "passed" | "failed"; code?: string; detail?: string }> {
  let validationWorkspace: { rootPath: string; cleanup: () => Promise<void> } | undefined;
  try {
    validationWorkspace = await createValidationWorkspace(rootPath, pendingChanges);
    const execution = await runBoundedCommand({
      command: command.command,
      args: [...command.args],
      rootPath: validationWorkspace.rootPath,
      cwd: validationWorkspace.rootPath,
      timeoutMs: Math.min(command.timeoutMs ?? 120_000, 120_000),
      maxOutputBytes: 1_000_000,
      allowedCommands: new Set(["pnpm"]),
      signal,
    });
    if (execution.status === "passed") {
      return { status: "passed" };
    }
    const output = boundedDetail(execution.combinedOutput.trim());
    return {
      status: "failed",
      code: `RUNTIME_ORACLE_${execution.status.toUpperCase()}`,
      detail: output || `Runtime behavioral oracle ended with status ${execution.status}.`,
    };
  } catch (error) {
    return {
      status: "failed",
      code: "RUNTIME_ORACLE_ERROR",
      detail: boundedDetail(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    await validationWorkspace?.cleanup();
  }
}

/**
 * Optional UI validation gate. It deliberately returns the same canonical
 * ValidationResult shape as command validation, so callers must explicitly
 * include it in their approval requirements; an unavailable/failed Preview
 * can never be interpreted as a passed repair.
 */
export async function runRepairPreviewValidation(input: {
  session: PreviewSession;
  operationId: string;
  executionId: string;
  revision: string;
  steps: readonly PreviewStep[];
  browser: PreviewBrowser;
  screenshotDirectory?: string;
}): Promise<ValidationResult> {
  const result = await verifyBrowserPreview(input);
  const status = result.status === "passed" ? "passed" : result.status;
  return {
    profile: "browser-preview",
    status,
    scenario: "Run the registered browser checks against the isolated project Preview.",
    command: "browser-preview",
    exitCode: status === "passed" ? 0 : null,
    stdout: "",
    stderr: result.consoleErrors.join("\n"),
    failedTests: result.status === "failed"
      ? [{ name: "browser preview", message: result.summary }]
      : [],
    changedFiles: [],
    evidence: {
      evidenceId: `${result.sessionId}:${result.operationId}:${result.executionId}`,
      observedAt: result.observedAt,
      artifactRef: result.screenshotPath
        ? `browser-preview:${result.screenshotPath}`
        : `browser-preview:${result.sessionId}`,
    },
    detail: result.summary,
  };
}