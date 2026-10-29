import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createHostDisposableTempDirectory } from "./disposable-temp.js";
import {
  APPROVED_BENCHMARK_SOURCE_REVISION,
  isValidBenchmarkSourceRevision,
} from "./benchmark-source-policy.js";

const execFileAsync = promisify(execFile);

const OMIT_BENCHMARK_ROOT_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "attached_assets",
  ".cache",
  ".agents",
  ".local",
  ".engineeringos-delivery",
  ".engineeringos-projects",
  ".config",
  ".github",
  "release-evidence",
  "docs",
  "coverage",
  "dist",
  ".vite",
]);

const OMIT_BENCHMARK_CONTROL_FILES = new Set([
  ".github/api-only-smoke.Dockerfile",
  ".github/api-only-smoke.Dockerfile.dockerignore",
  ".github/workflows/api-only-smoke-isolated.yml",
  "scripts/api-only-smoke-container-preflight.mjs",
  "scripts/api-only-smoke-container-preflight.test.mjs",
  "scripts/api-only-smoke-workflow.test.mjs",
  "scripts/api-only-smoke.mjs",
  "scripts/api-only-smoke.test.mjs",
  "scripts/run-api-only-smoke-container.sh",
  "scripts/run-api-only-smoke.mjs",
]);

/**
 * Keep provider-visible benchmark workspaces limited to candidate source.
 * The source SHA still binds the full immutable commit; this copy omits
 * unrelated operations evidence and trusted CI/control implementation.
 */
export function shouldCopyBenchmarkCandidateEntry(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized === ".") return true;
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    return false;
  }
  if (normalized.split("/").some((segment) => OMIT_BENCHMARK_ROOT_SEGMENTS.has(segment))) {
    return false;
  }
  if (OMIT_BENCHMARK_CONTROL_FILES.has(normalized)) return false;
  return !/^mission-correlation-report-[^/]+\.json$/i.test(normalized);
}

const ALLOWED_CONTROL_ONLY_CHANGES = new Set([
  ".config/chromium/Crash Reports/settings.dat",
  ".agents/memory/candidate-validation-boundary.md",
  ".agents/memory/openrouter-throttling-checkpoints.md",
  ".agents/memory/provider-tool-call-manifests.md",
  ".agents/memory/contract-telemetry-separation.md",
  "lib/ai-orchestrator/src/benchmark/benchmark-campaign.test.ts",
  "lib/ai-orchestrator/src/benchmark/benchmark-campaign.ts",
  "lib/ai-orchestrator/src/benchmark/benchmark-airlock.test.ts",
  "lib/ai-orchestrator/src/benchmark/benchmark-airlock.ts",
  "lib/ai-orchestrator/src/benchmark/free-only-policy.test.ts",
  "lib/ai-orchestrator/src/benchmark/free-only-policy.ts",
  "lib/ai-orchestrator/src/benchmark/code-agent-benchmark-fixtures.ts",
  "lib/ai-orchestrator/src/benchmark/benchmark-parity-report.test.ts",
  "lib/ai-orchestrator/src/benchmark/benchmark-parity-report.ts",
  "lib/ai-orchestrator/src/benchmark/code-agent-benchmark.test.ts",
  "lib/ai-orchestrator/src/benchmark/code-agent-benchmark.ts",
  "lib/ai-orchestrator/src/benchmark/live-code-agent-benchmark.test.ts",
  "lib/ai-orchestrator/src/benchmark/live-code-agent-benchmark.ts",
  "lib/ai-orchestrator/src/benchmark/benchmark-trace.test.ts",
  "lib/ai-orchestrator/src/benchmark/benchmark-trace.ts",
  "lib/ai-orchestrator/src/__tests__/execution-node-coordinator.test.ts",
  "lib/ai-orchestrator/src/execution-node-coordinator.ts",
  "lib/ai-orchestrator/src/agents/chat-agent.ts",
  "lib/ai-orchestrator/src/benchmark/paired-baseline.test.ts",
  "artifacts/api-server/src/lib/benchmark-source-policy.ts",
  "artifacts/api-server/src/lib/benchmark-source-snapshot.ts",
  "artifacts/api-server/src/lib/benchmark-source-snapshot.test.ts",
  "artifacts/api-server/src/lib/ai-code-agent-benchmark.test.ts",
  "artifacts/api-server/src/lib/ai-code-agent-benchmark.ts",
  "artifacts/api-server/src/lib/benchmark-release-gate.test.ts",
  "artifacts/api-server/src/routes/ai/benchmark.test.ts",
  "artifacts/api-server/src/lib/run-code-agent-benchmark-airlock.ts",
]);

function readOnlyGitEnvironment(): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !key.startsWith("GIT_") || key === "GIT_CONFIG_GLOBAL",
    ),
  ) as NodeJS.ProcessEnv;
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  return environment;
}

export type ApprovedBenchmarkSourceSnapshot = {
  sourceRevision: string;
  rootPath: string;
  temporaryRootPath: string;
  cleanup: () => Promise<void>;
};

export function findUnapprovedBenchmarkControlChanges(paths: readonly string[]): string[] {
  return paths
    .filter((filePath) => !ALLOWED_CONTROL_ONLY_CHANGES.has(filePath))
    .sort();
}

export async function resolveApprovedBenchmarkSourceRevision(controlRoot: string): Promise<string> {
  const sourceRevision = APPROVED_BENCHMARK_SOURCE_REVISION;
  const env = readOnlyGitEnvironment();
  if (!isValidBenchmarkSourceRevision(sourceRevision)) {
    throw new Error("SOURCE_REVISION_INVALID: approved candidate revision is malformed.");
  }

  const { stdout: resolvedCommit } = await execFileAsync(
    "git",
    ["-C", controlRoot, "rev-parse", "--verify", `${sourceRevision}^{commit}`],
    { maxBuffer: 4096, env },
  );
  if (resolvedCommit.trim() !== sourceRevision) {
    throw new Error("SOURCE_REVISION_UNAVAILABLE: approved candidate commit is not present locally.");
  }

  await execFileAsync(
    "git",
    ["-C", controlRoot, "rev-parse", "--verify", "main^{commit}"],
    { maxBuffer: 4096, env },
  );

  try {
    await execFileAsync(
      "git",
      ["-C", controlRoot, "merge-base", "--is-ancestor", sourceRevision, "main"],
      { maxBuffer: 4096, env },
    );
  } catch {
    throw new Error("SOURCE_REVISION_NOT_REACHABLE: approved candidate is not in local main history.");
  }

  const { stdout: changedPaths } = await execFileAsync(
    "git",
    ["-C", controlRoot, "diff", "--name-only", sourceRevision],
    { maxBuffer: 64 * 1024, env },
  );
  const { stdout: untrackedPaths } = await execFileAsync(
    "git",
    ["-C", controlRoot, "ls-files", "--others", "--exclude-standard"],
    { maxBuffer: 64 * 1024, env },
  );
  const unapprovedChanges = findUnapprovedBenchmarkControlChanges(
    [
      ...changedPaths.split(/\r?\n/),
      ...untrackedPaths.split(/\r?\n/),
    ].filter(Boolean),
  );
  if (unapprovedChanges.length > 0) {
    throw new Error("SOURCE_REVISION_STALE: the workspace contains changes outside approved benchmark control files.");
  }

  return sourceRevision;
}

export async function createApprovedBenchmarkSourceSnapshot(
  controlRoot: string,
  sourceRevision: string,
): Promise<ApprovedBenchmarkSourceSnapshot> {
  if (sourceRevision !== APPROVED_BENCHMARK_SOURCE_REVISION) {
    throw new Error("SOURCE_REVISION_UNAPPROVED: snapshot revision is not server-approved.");
  }

  const temporaryRootPath = await createHostDisposableTempDirectory("engineeringos-approved-source-");
  const archivePath = path.join(temporaryRootPath, "candidate.tar");
  const rootPath = path.join(temporaryRootPath, "source");
  try {
    await fs.mkdir(rootPath);
    const { stdout: archive } = await execFileAsync(
      "git",
      ["-C", controlRoot, "archive", "--format=tar", sourceRevision],
      {
        encoding: "buffer",
        maxBuffer: 512 * 1024 * 1024,
        env: readOnlyGitEnvironment(),
      },
    );
    if (!Buffer.isBuffer(archive) || archive.length === 0) {
      throw new Error("empty_archive");
    }
    await fs.writeFile(archivePath, archive, { mode: 0o600 });
    await execFileAsync(
      "tar",
      ["-xf", archivePath, "-C", rootPath, "--no-same-owner", "--no-same-permissions"],
      { maxBuffer: 4096 },
    );
    await fs.rm(archivePath, { force: true });

    const [realTemporaryRoot, realSourceRoot] = await Promise.all([
      fs.realpath(temporaryRootPath),
      fs.realpath(rootPath),
    ]);
    const temporaryBase = await fs.realpath("/tmp");
    const relativeToTemporaryBase = path.relative(temporaryBase, realTemporaryRoot);
    const relativeSource = path.relative(realTemporaryRoot, realSourceRoot);
    if (
      !relativeToTemporaryBase ||
      relativeToTemporaryBase.startsWith("..") ||
      path.isAbsolute(relativeToTemporaryBase) ||
      !relativeSource ||
      relativeSource.startsWith("..") ||
      path.isAbsolute(relativeSource)
    ) {
      throw new Error("unsafe_snapshot_root");
    }
    await fs.access(path.join(realSourceRoot, "package.json"));

    return {
      sourceRevision,
      rootPath: realSourceRoot,
      temporaryRootPath: realTemporaryRoot,
      cleanup: () => fs.rm(realTemporaryRoot, { recursive: true, force: true }),
    };
  } catch {
    await fs.rm(temporaryRootPath, { recursive: true, force: true });
    throw new Error("SOURCE_SNAPSHOT_MATERIALIZATION_FAILED: approved candidate could not be materialized safely.");
  }
}
