import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
// The shared release runner is intentionally JavaScript because it is also
// executed directly by the shell-based browser harness.
// @ts-expect-error The JavaScript helper has no generated declaration file.
import { acquireReleaseLock, lockPath } from "../../scripts/run-release-ai-stream.mjs";

export const AI_RELEASE_QUALITY_GATE_VERSION = 1;

export type AiReleaseCheckKind =
  | "typecheck"
  | "contract"
  | "evidence"
  | "operation"
  | "benchmark"
  | "preview";

export type AiReleaseCheckDefinition = {
  id: string;
  kind: AiReleaseCheckKind;
  command: string;
  blocking: boolean;
  enabled: boolean;
  coverage: readonly string[];
};

export type AiReleaseCheckResult = AiReleaseCheckDefinition & {
  status: "passed" | "failed" | "skipped";
  failureCode?: string;
  durationMs: number;
};

export type AiReleaseQualityDecision = {
  kind: "ai-release-quality-decision";
  version: typeof AI_RELEASE_QUALITY_GATE_VERSION;
  generatedAt: string;
  status: "passed" | "blocked";
  liveProviderChecks: "disabled" | "enabled";
  previewChecks: "disabled" | "enabled";
  summary: {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    skippedCases: number;
    blockingFailures: number;
    informationalFailures: number;
  };
  blockers: string[];
  checks: AiReleaseCheckResult[];
};

const CHECKS: readonly Omit<AiReleaseCheckDefinition, "enabled">[] = [
  {
    id: "api-typecheck",
    kind: "typecheck",
    command: "pnpm --filter @workspace/api-server run typecheck",
    blocking: true,
    coverage: ["API typecheck"],
  },
  {
    id: "dashboard-typecheck",
    kind: "typecheck",
    command: "pnpm --filter @workspace/dashboard run typecheck",
    blocking: true,
    coverage: ["dashboard/client typecheck"],
  },
  {
    id: "openapi-client-parity",
    kind: "contract",
    command: "pnpm run codegen:check",
    blocking: true,
    coverage: ["OpenAPI/client parity", "Zod 3 generated-schema compatibility"],
  },
  {
    id: "truth-flow-parity",
    kind: "evidence",
    command: "pnpm run truth:validate",
    blocking: true,
    coverage: ["structured evidence baseline"],
  },
  {
    id: "ai-contract-and-json",
    kind: "contract",
    command: "pnpm --filter @workspace/api-server exec vitest run src/routes/ai-route-parity.test.ts src/routes/ai.test.ts",
    blocking: true,
    coverage: ["JSON contract", "structured audits", "tool policy", "false-success handling"],
  },
  {
    id: "ai-structured-review-fallback",
    kind: "contract",
    command: "pnpm --filter @workspace/ai-orchestrator run test:structured-review-fallback-release",
    blocking: true,
    coverage: [
      "structured-review reasoning-only fallback",
      "agent-harness fallback",
      "rate-limit fallback",
      "empty/malformed output incomplete status",
      "catalog refresh failure compatibility routing",
    ],
  },
  {
    id: "ai-sse-and-redaction",
    kind: "contract",
    command: "pnpm --filter @workspace/api-server exec vitest run src/routes/ai-stream-integration.test.ts src/routes/ai/chat-sse.test.ts",
    blocking: true,
    coverage: ["SSE contract", "redaction", "stale revision", "resume"],
  },
  {
    id: "ai-operational-safety",
    kind: "operation",
    command: "pnpm --filter @workspace/api-server exec vitest run src/routes/ai-repair-loop-e2e.test.ts src/lib/ai-repair-validation.test.ts src/lib/job-concurrency.test.ts",
    blocking: true,
    coverage: ["ownership", "concurrency", "cancellation", "apply/rollback", "Terminal"],
  },
  {
    id: "ai-deterministic-benchmark",
    kind: "benchmark",
    command: "pnpm --filter @workspace/ai-orchestrator run benchmark:code-agent:deterministic",
    blocking: true,
    coverage: ["deterministic fixtures", "validation/provider-turn exhaustion", "scope safety", "false success"],
  },
  {
    id: "benchmark-baseline-regression",
    kind: "benchmark",
    command: "pnpm run verify:benchmark-rollout",
    blocking: true,
    coverage: ["baseline comparison", "regression threshold", "scope escape"],
  },
  {
    id: "dashboard-preview-contract",
    kind: "preview",
    command: "pnpm run validate:dashboard-journey",
    blocking: true,
    coverage: ["Preview dashboard journey"],
  },
];

export function getAiReleaseChecks(options: {
  enablePreview?: boolean;
  enableLiveProvider?: boolean;
} = {}): AiReleaseCheckDefinition[] {
  const enablePreview = options.enablePreview === true;
  const enableLiveProvider = options.enableLiveProvider === true;
  return CHECKS.map((check) => ({
    ...check,
    enabled: check.kind !== "preview" || enablePreview,
  })).concat(enableLiveProvider ? [{
    id: "live-provider-quality",
    kind: "benchmark" as const,
    command: "pnpm --filter @workspace/api-server run validate:live-provider-review",
    blocking: false,
    enabled: true,
    coverage: [
      "optional live structured-review provider observation",
      "reasoning-only and agent-harness recovery",
      "rate-limit, empty, and malformed incomplete receipts",
    ],
  }] : []);
}

function failureCode(check: AiReleaseCheckDefinition, exitCode: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `${check.id.toUpperCase().replaceAll("-", "_")}_TERMINATED`;
  return `${check.id.toUpperCase().replaceAll("-", "_")}_FAILED_${exitCode ?? "UNKNOWN"}`;
}

export function evaluateAiReleaseQuality(results: readonly AiReleaseCheckResult[], options: {
  enableLiveProvider?: boolean;
  enablePreview?: boolean;
  generatedAt?: string;
} = {}): AiReleaseQualityDecision {
  const blockers = results
    .filter((result) => result.status === "failed" && result.blocking)
    .map((result) => result.failureCode ?? `${result.id.toUpperCase().replaceAll("-", "_")}_FAILED`);
  const failed = results.filter((result) => result.status === "failed");
  return {
    kind: "ai-release-quality-decision",
    version: AI_RELEASE_QUALITY_GATE_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    status: blockers.length === 0 ? "passed" : "blocked",
    liveProviderChecks: options.enableLiveProvider ? "enabled" : "disabled",
    previewChecks: options.enablePreview ? "enabled" : "disabled",
    summary: {
      totalCases: results.length,
      passedCases: results.filter((result) => result.status === "passed").length,
      failedCases: failed.length,
      skippedCases: results.filter((result) => result.status === "skipped").length,
      blockingFailures: blockers.length,
      informationalFailures: failed.filter((result) => !result.blocking).length,
    },
    blockers: [...new Set(blockers)],
    checks: [...results],
  };
}

async function runCommand(check: AiReleaseCheckDefinition, cwd: string): Promise<AiReleaseCheckResult> {
  const started = Date.now();
  return await new Promise((resolve) => {
    // Output is deliberately drained but never included in the report. This
    // keeps prompts, model output, source snippets, and credentials out of
    // persisted release artifacts.
    const child = spawn("sh", ["-c", check.command], {
      cwd,
      env: { ...process.env, RUN_CONTROLLED_RELEASE_VALIDATION: "1" },
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.once("error", () => resolve({
      ...check,
      status: "failed",
      failureCode: failureCode(check, null, null),
      durationMs: Date.now() - started,
    }));
    child.once("exit", (exitCode, signal) => resolve({
      ...check,
      status: exitCode === 0 ? "passed" : "failed",
      ...(exitCode === 0 ? {} : { failureCode: failureCode(check, exitCode, signal) }),
      durationMs: Date.now() - started,
    }));
  });
}

export async function runAiReleaseQualityGate(options: {
  cwd?: string;
  enablePreview?: boolean;
  enableLiveProvider?: boolean;
  generatedAt?: string;
} = {}): Promise<AiReleaseQualityDecision> {
  const enablePreview = options.enablePreview === true;
  const enableLiveProvider = options.enableLiveProvider === true;
  const checks = getAiReleaseChecks({ enablePreview, enableLiveProvider });
  const results: AiReleaseCheckResult[] = [];
  for (const check of checks) {
    if (!check.enabled) {
      results.push({ ...check, status: "skipped", durationMs: 0 });
      continue;
    }
    results.push(await runCommand(check, options.cwd ?? path.resolve(process.cwd(), "../..")));
  }
  return evaluateAiReleaseQuality(results, { enableLiveProvider, enablePreview, generatedAt: options.generatedAt });
}

export async function writeAiReleaseQualityDecision(filePath: string, decision: AiReleaseQualityDecision): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  let releaseLockCleanup: (() => Promise<void>) | undefined;
  try {
    if (process.env.DATABASE_URL) {
      releaseLockCleanup = await acquireReleaseLock(lockPath);
    }
    const decision = await runAiReleaseQualityGate({
      enablePreview: process.env.AI_RELEASE_ENABLE_PREVIEW === "true",
      enableLiveProvider: process.env.AI_RELEASE_ENABLE_LIVE_PROVIDER === "true",
      cwd: workspaceRoot,
    });
    const outputPath = path.resolve(
      process.env.AI_RELEASE_QUALITY_REPORT_PATH ??
        path.join(workspaceRoot, "lib/ai-orchestrator/benchmark-results/ai-release-quality-decision.json"),
    );
    await writeAiReleaseQualityDecision(outputPath, decision);
    console.log(JSON.stringify({ ...decision, outputPath }, null, 2));
    if (decision.status === "blocked") process.exitCode = 1;
  } finally {
    await releaseLockCleanup?.();
  }
}