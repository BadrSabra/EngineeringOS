import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CodeAgentBenchmarkCase,
  CodeAgentExecutionTelemetry,
} from "./code-agent-benchmark.js";

export type CodeAgentBenchmarkContractOracleResult = {
  status: "passed" | "failed";
  code?: string;
};

type PendingChange = {
  path: string;
  newContent: string;
};

function normalizeWorkspacePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isAllowed(filePath: string, allowedPaths: readonly string[]): boolean {
  const normalized = normalizeWorkspacePath(filePath);
  return allowedPaths.some((allowedPath) => {
    const allowed = normalizeWorkspacePath(allowedPath);
    return normalized === allowed ||
      normalized.startsWith(`${allowed}/`) ||
      allowed.startsWith(`${normalized}/`);
  });
}

/**
 * Validate the execution contract independently of the model's final text.
 *
 * This is intentionally a contract oracle, not a task-specific behavioral
 * oracle. It proves that a review-ready result has a real scoped pending diff
 * and passed executable validation. Case-specific postconditions will be
 * layered on top of this result as fixtures become executable.
 */
export async function evaluateCodeAgentBenchmarkContract(args: {
  rootPath: string;
  testCase: CodeAgentBenchmarkCase;
  telemetry: CodeAgentExecutionTelemetry;
  pendingChanges: readonly PendingChange[];
}): Promise<CodeAgentBenchmarkContractOracleResult> {
  const { testCase, telemetry, pendingChanges } = args;

  if (telemetry.providerUnavailable) {
    return { status: "failed", code: "PROVIDER_UNAVAILABLE" };
  }

  if (telemetry.actualTerminal !== testCase.expected.terminal) {
    return { status: "failed", code: "TERMINAL_MISMATCH" };
  }

  if (testCase.expected.terminal === "BLOCKED") {
    return pendingChanges.length === 0
      ? { status: "passed" }
      : { status: "failed", code: "BLOCKED_WITH_PENDING_CHANGES" };
  }

  if (telemetry.validationStatus !== "passed") {
    return { status: "failed", code: "READY_WITHOUT_PASSED_VALIDATION" };
  }
  if (pendingChanges.length === 0) {
    return { status: "failed", code: "READY_WITHOUT_PENDING_CHANGES" };
  }

  for (const change of pendingChanges) {
    if (!isAllowed(change.path, telemetry.allowedPaths)) {
      return { status: "failed", code: "PENDING_CHANGE_OUTSIDE_SCOPE" };
    }

    const absolutePath = path.resolve(args.rootPath, change.path);
    const relativePath = normalizeWorkspacePath(path.relative(args.rootPath, absolutePath));
    if (
      relativePath === ".." ||
      relativePath.startsWith("../") ||
      path.isAbsolute(relativePath)
    ) {
      return { status: "failed", code: "PENDING_CHANGE_ESCAPES_ROOT" };
    }

    try {
      const currentContent = await fs.readFile(absolutePath, "utf8");
      if (currentContent === change.newContent) {
        return { status: "failed", code: "PENDING_CHANGE_HAS_NO_NET_DIFF" };
      }
    } catch {
      // New-file changes are allowed by the contract oracle. A later
      // case-specific behavioral oracle must prove that the new file is valid.
    }
  }

  return { status: "passed" };
}