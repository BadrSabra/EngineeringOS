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

const ALLOWED_CONTROL_ONLY_CHANGES = new Set([
  "artifacts/api-server/src/lib/benchmark-source-policy.ts",
  "artifacts/api-server/src/lib/benchmark-source-snapshot.ts",
  "artifacts/api-server/src/lib/benchmark-source-snapshot.test.ts",
  "artifacts/api-server/src/lib/run-code-agent-benchmark-airlock.ts",
]);

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
  if (!isValidBenchmarkSourceRevision(sourceRevision)) {
    throw new Error("SOURCE_REVISION_INVALID: approved candidate revision is malformed.");
  }

  const { stdout: resolvedCommit } = await execFileAsync(
    "git",
    ["-C", controlRoot, "rev-parse", "--verify", `${sourceRevision}^{commit}`],
    { maxBuffer: 4096 },
  );
  if (resolvedCommit.trim() !== sourceRevision) {
    throw new Error("SOURCE_REVISION_UNAVAILABLE: approved candidate commit is not present locally.");
  }

  const { stdout: mainRevision } = await execFileAsync(
    "git",
    ["-C", controlRoot, "rev-parse", "--verify", "main^{commit}"],
    { maxBuffer: 4096 },
  );
  if (!isValidBenchmarkSourceRevision(mainRevision.trim())) {
    throw new Error("SOURCE_REVISION_INVALID: local main revision is malformed.");
  }

  try {
    await execFileAsync(
      "git",
      ["-C", controlRoot, "merge-base", "--is-ancestor", sourceRevision, "main"],
      { maxBuffer: 4096 },
    );
  } catch {
    throw new Error("SOURCE_REVISION_NOT_REACHABLE: approved candidate is not in local main history.");
  }

  const { stdout: changedPaths } = await execFileAsync(
    "git",
    ["-C", controlRoot, "diff", "--name-only", `${sourceRevision}..main`],
    { maxBuffer: 64 * 1024 },
  );
  const unapprovedChanges = findUnapprovedBenchmarkControlChanges(
    changedPaths.split(/\r?\n/).filter(Boolean),
  );
  if (unapprovedChanges.length > 0) {
    throw new Error("SOURCE_REVISION_STALE: main contains changes outside the approved benchmark control files.");
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
      { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 },
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
