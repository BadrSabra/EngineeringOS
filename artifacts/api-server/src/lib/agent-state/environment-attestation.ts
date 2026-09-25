import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { establishProjectRoot } from "../project-root.js";

const PROFILE_VERSION = 1;
const RUNTIME_PROFILE_VERSION = 2;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_TOTAL_MANIFEST_BYTES = 1024 * 1024;

const ENVIRONMENT_MANIFESTS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pyproject.toml",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
  "requirements.txt",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "Gemfile",
  "Gemfile.lock",
  "composer.json",
  "composer.lock",
  "flake.nix",
  ".nvmrc",
  ".node-version",
  ".python-version",
  ".tool-versions",
] as const;

const VALIDATION_PROFILES = new Set([
  "workspace-typecheck",
  "ai-orchestrator-tests",
]);

export type ServerEnvironmentProfile = {
  id: string;
  version: number;
  details?: Record<string, string | string[]>;
};

export type EnvironmentAttestationResult =
  | { status: "known"; environmentRevision: string; profileId: string; manifestCount: number }
  | {
      status: "unknown";
      reason: "root_missing" | "root_unavailable" | "unsupported_profile" | "no_manifests" | "manifest_unavailable";
    };

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function episodeProfileDetails(scope: unknown): Record<string, unknown> | null {
  const record = recordOf(scope);
  if (!record) return null;
  const recipeId = typeof record.recipeId === "string" ? record.recipeId : undefined;

  if (record.kind === "mission-task") {
    return { id: "mission-repair", version: PROFILE_VERSION, runner: "mission-tool-loop" };
  }
  if (recipeId === "candidate.verify") {
    const rawProfiles = record.validationProfiles;
    if (rawProfiles !== undefined && !Array.isArray(rawProfiles)) return null;
    const profiles = (rawProfiles ?? []) as unknown[];
    if (profiles.some((profile) => typeof profile !== "string" || !VALIDATION_PROFILES.has(profile))) {
      return null;
    }
    return {
      id: "candidate-validation",
      version: PROFILE_VERSION,
      runner: "server-recipe",
      validationProfiles: [...new Set(profiles as string[])].sort(),
    };
  }
  if (recipeId === "browser.verify") {
    return {
      id: "browser-validation",
      version: PROFILE_VERSION,
      runner: "server-recipe",
      browserProfile: "default",
    };
  }
  if (recipeId === "runtime.start" || recipeId === "runtime.restart" || recipeId === "runtime.stop") {
    return {
      id: "workspace-runtime",
      version: RUNTIME_PROFILE_VERSION,
      profile: "dev",
      command: "pnpm run dev",
    };
  }
  if (recipeId === "delivery.push.github") {
    return { id: "github-delivery", version: PROFILE_VERSION, runner: "server-recipe" };
  }
  return null;
}

export function serverEnvironmentProfile(
  intentKind: string,
  scope: unknown,
): ServerEnvironmentProfile | null {
  const details = episodeProfileDetails(scope);
  if (!details) {
    if (intentKind === "APPLY_CHANGES" && recordOf(scope)?.projectId) {
      return { id: "approved-source-promotion", version: PROFILE_VERSION };
    }
    return null;
  }

  const expectedIntent = details.id === "mission-repair"
    ? "TASK_EXECUTION"
    : details.id === "candidate-validation"
      ? "CANDIDATE_VALIDATION"
      : details.id === "browser-validation"
        ? "BROWSER_VALIDATION"
        : details.id === "workspace-runtime"
          ? "RUNTIME_START"
          : details.id === "github-delivery"
            ? "GITHUB_DELIVERY"
            : null;
  if (intentKind !== expectedIntent) return null;

  const { id, version, ...profileDetails } = details;
  return {
    id: id as string,
    version: version as number,
    ...(Object.keys(profileDetails).length > 0
      ? { details: profileDetails as Record<string, string | string[]> }
      : {}),
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function readBoundedManifest(path: string): Promise<
  | { status: "missing" }
  | { status: "read"; contentHash: string; byteLength: number }
  | { status: "invalid" }
> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    return isMissingFile(error) ? { status: "missing" } : { status: "invalid" };
  }

  try {
    const fileStat = await file.stat();
    if (!fileStat.isFile() || fileStat.nlink !== 1 || fileStat.size > MAX_MANIFEST_BYTES) {
      return { status: "invalid" };
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= MAX_MANIFEST_BYTES) {
      const chunk = Buffer.alloc(Math.min(16 * 1024, MAX_MANIFEST_BYTES - totalBytes + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
      totalBytes += bytesRead;
    }
    if (totalBytes > MAX_MANIFEST_BYTES || totalBytes !== fileStat.size) {
      return { status: "invalid" };
    }
    const digest = createHash("sha256");
    for (const chunk of chunks) digest.update(chunk);
    return { status: "read", contentHash: digest.digest("hex"), byteLength: totalBytes };
  } finally {
    await file.close();
  }
}

export async function captureEnvironmentAttestation(input: {
  rootPath?: string;
  profile: ServerEnvironmentProfile | null;
}): Promise<EnvironmentAttestationResult> {
  if (!input.rootPath) return { status: "unknown", reason: "root_missing" };
  if (!input.profile) return { status: "unknown", reason: "unsupported_profile" };

  const established = await establishProjectRoot(input.rootPath);
  if (!established.ok) return { status: "unknown", reason: "root_unavailable" };

  let rootStat;
  try {
    rootStat = await stat(established.canonicalPath);
  } catch {
    return { status: "unknown", reason: "root_unavailable" };
  }

  const manifests: Array<{ name: string; contentHash: string; byteLength: number }> = [];
  let totalBytes = 0;
  for (const name of ENVIRONMENT_MANIFESTS) {
    const result = await readBoundedManifest(join(established.canonicalPath, name));
    if (result.status === "missing") continue;
    if (result.status === "invalid" || totalBytes + result.byteLength > MAX_TOTAL_MANIFEST_BYTES) {
      return { status: "unknown", reason: "manifest_unavailable" };
    }
    totalBytes += result.byteLength;
    manifests.push({ name, contentHash: result.contentHash, byteLength: result.byteLength });
  }
  if (manifests.length === 0) return { status: "unknown", reason: "no_manifests" };

  try {
    const finalPath = await realpath(input.rootPath);
    const finalStat = await stat(input.rootPath);
    if (
      finalPath !== established.canonicalPath
      || finalStat.dev !== rootStat.dev
      || finalStat.ino !== rootStat.ino
    ) {
      return { status: "unknown", reason: "root_unavailable" };
    }
  } catch {
    return { status: "unknown", reason: "root_unavailable" };
  }

  const canonicalIdentity = JSON.stringify({
    schema: "environment-attestation-v1",
    profile: input.profile,
    host: {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
    },
    manifests,
  });
  const digest = createHash("sha256").update(canonicalIdentity).digest("hex");
  return {
    status: "known",
    environmentRevision: `env-v1:${digest}`,
    profileId: input.profile.id,
    manifestCount: manifests.length,
  };
}