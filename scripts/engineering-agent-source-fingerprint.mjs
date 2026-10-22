import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".graphql",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".mjs",
  ".mts",
  ".prisma",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const excludedDirectories = new Set([
  ".agents",
  ".cache",
  ".git",
  ".local",
  "attached_assets",
  "build",
  "coverage",
  "dist",
  "generated-artifacts",
  "node_modules",
  "test-results",
]);

export async function computeEngineeringAgentSourceFingerprint({ cwd = process.cwd() } = {}) {
  const root = resolve(cwd);
  const listedPaths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  ).toString("utf8").split("\0").filter(Boolean);
  const sourcePaths = listedPaths
    .map((filePath) => filePath.replaceAll("\\", "/"))
    .filter((filePath) => {
      const segments = filePath.split("/");
      return !segments.some((segment) => excludedDirectories.has(segment))
        && sourceExtensions.has(filePath.slice(filePath.lastIndexOf(".")).toLowerCase());
    })
    .sort();
  if (sourcePaths.length === 0) throw new Error("No source files found for lifecycle fingerprint.");

  const hash = createHash("sha256");
  for (const filePath of sourcePaths) {
    const absolutePath = join(root, filePath);
    hash.update(filePath);
    hash.update("\0");
    try {
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        hash.update("SYMLINK\0");
        hash.update(await readlink(absolutePath));
      } else if (stat.isFile()) {
        hash.update("FILE\0");
        hash.update(await readFile(absolutePath));
      } else {
        hash.update("NON_FILE\0");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      hash.update("MISSING\0");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}
