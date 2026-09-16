import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  findApplicationSchemaIssues,
  getApplicationSchemaSnapshot,
  type ApplicationSchemaQuery,
  type ApplicationSchemaSnapshot,
} from "./database-schema-preflight.js";
import {
  deliveryWorkspaceExists,
  hashDeliveryWorkspace,
} from "./delivery-workspace.js";
import type { TaskObjectiveValidatorReceipt } from "./task-objective-contract.js";

type ReceiptContext = {
  operationId: string;
  projectId: string;
  workspaceRevision: string;
};

function artifactReference(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

function receipt(
  context: ReceiptContext,
  validatorId: string,
  status: TaskObjectiveValidatorReceipt["status"],
  artifactRef: string,
): TaskObjectiveValidatorReceipt {
  return {
    validatorId,
    status,
    operationId: context.operationId,
    projectId: context.projectId,
    workspaceRevision: context.workspaceRevision,
    artifactRef,
  };
}

export type DatabaseSchemaValidatorInput = ReceiptContext & {
  queryable: ApplicationSchemaQuery;
  /**
   * Schema shape alone does not prove that the requested migration ran.
   * Callers must provide a separate server-owned runtime/migration witness.
   */
  migrationEvidence?: {
    verified: boolean;
    artifactRef: string;
  };
};

export async function createDatabaseSchemaValidatorReceipt(
  input: DatabaseSchemaValidatorInput,
): Promise<TaskObjectiveValidatorReceipt> {
  let snapshot: ApplicationSchemaSnapshot;
  try {
    snapshot = await getApplicationSchemaSnapshot(input.queryable);
  } catch {
    return receipt(
      input,
      "database-schema.v1",
      "UNAVAILABLE",
      `database-schema:${input.operationId}:unavailable`,
    );
  }

  const issues = findApplicationSchemaIssues(snapshot);
  const snapshotDigest = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  if (issues.length > 0) {
    return receipt(
      input,
      "database-schema.v1",
      "INCOMPLETE",
      `database-schema:${input.operationId}:issues:${snapshotDigest}`,
    );
  }
  if (
    !input.migrationEvidence?.verified
    || !input.migrationEvidence.artifactRef.trim()
  ) {
    return receipt(
      input,
      "database-schema.v1",
      "INCOMPLETE",
      `database-schema:${input.operationId}:migration-unverified:${snapshotDigest}`,
    );
  }
  return receipt(
    input,
    "database-schema.v1",
    "PROVEN",
    artifactReference(
      "database-schema",
      `${input.operationId}:${snapshotDigest}:${input.migrationEvidence.artifactRef}`,
    ),
  );
}

const MEDIA_FORMATS = [
  "png",
  "jpeg",
  "gif",
  "webp",
  "mp3",
  "wav",
  "mp4",
  "webm",
] as const;
type MediaFormat = (typeof MEDIA_FORMATS)[number];

type ArtifactValidatorInput = ReceiptContext & {
  rootPath: string;
  /** Server-selected output path, relative to the approved root. */
  relativePath: string;
  expectedSha256?: string;
  expectedFormat?: MediaFormat;
  maxBytes?: number;
};

function resolveApprovedArtifact(rootPath: string, relativePath: string): string {
  if (
    !relativePath
    || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]+/).some((part) => part === "..")
  ) {
    throw new Error("artifact path is outside the approved relative scope");
  }
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("artifact path is outside the approved root");
  }
  return target;
}

async function assertNoSymlinkTraversal(rootPath: string, targetPath: string): Promise<void> {
  const resolvedRoot = await realpath(rootPath);
  let cursor = targetPath;
  const segments: string[] = [];
  while (cursor !== resolvedRoot && cursor.startsWith(`${resolvedRoot}${path.sep}`)) {
    segments.unshift(cursor);
    cursor = path.dirname(cursor);
  }
  if (cursor !== resolvedRoot) throw new Error("artifact path escaped the approved root");
  for (const segment of segments) {
    if ((await lstat(segment)).isSymbolicLink()) {
      throw new Error("artifact path traverses a symbolic link");
    }
  }
}

function detectMediaFormat(bytes: Buffer): MediaFormat | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpeg";
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE") return "wav";
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp") return "mp4";
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "webm";
  return undefined;
}

async function createArtifactValidatorReceipt(
  input: ArtifactValidatorInput,
  validatorId: "file-conversion.v1" | "media-artifact.v1",
): Promise<TaskObjectiveValidatorReceipt> {
  let targetPath: string;
  try {
    targetPath = resolveApprovedArtifact(input.rootPath, input.relativePath);
    await assertNoSymlinkTraversal(input.rootPath, targetPath);
    const stat = await lstat(targetPath);
    const maxBytes = Math.max(1, Math.min(input.maxBytes ?? 64 * 1024 * 1024, 64 * 1024 * 1024));
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      return receipt(input, validatorId, "INCOMPLETE", `artifact:${validatorId}:invalid-size`);
    }
    const bytes = await readFile(targetPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (input.expectedSha256 && input.expectedSha256 !== digest) {
      return receipt(input, validatorId, "INCOMPLETE", `artifact:${validatorId}:hash-mismatch`);
    }
    if (validatorId === "media-artifact.v1") {
      const detected = detectMediaFormat(bytes);
      if (!detected || (input.expectedFormat && detected !== input.expectedFormat)) {
        return receipt(input, validatorId, "INCOMPLETE", `artifact:${validatorId}:format-mismatch`);
      }
    }
    return receipt(
      input,
      validatorId,
      "PROVEN",
      artifactReference(`${validatorId}:output`, `${input.operationId}:${digest}`),
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return receipt(
      input,
      validatorId,
      code === "ENOENT" ? "INCOMPLETE" : "UNAVAILABLE",
      `artifact:${validatorId}:${code === "ENOENT" ? "missing" : "unavailable"}`,
    );
  }
}

export function createFileConversionValidatorReceipt(
  input: ArtifactValidatorInput,
): Promise<TaskObjectiveValidatorReceipt> {
  return createArtifactValidatorReceipt(input, "file-conversion.v1");
}

export function createMediaArtifactValidatorReceipt(
  input: ArtifactValidatorInput,
): Promise<TaskObjectiveValidatorReceipt> {
  return createArtifactValidatorReceipt(input, "media-artifact.v1");
}

export type DeploymentValidatorInput = ReceiptContext & {
  candidateWorkspace: string;
  candidateIdentity: string;
  health: {
    verified: boolean;
    artifactRef: string;
  };
};

export async function createDeploymentValidatorReceipt(
  input: DeploymentValidatorInput,
): Promise<TaskObjectiveValidatorReceipt> {
  try {
    if (!await deliveryWorkspaceExists(input.candidateWorkspace, input.operationId)) {
      return receipt(input, "deployment-receipt.v1", "INCOMPLETE", `deployment:${input.operationId}:candidate-missing`);
    }
    const candidateHash = await hashDeliveryWorkspace(input.candidateWorkspace);
    if (
      candidateHash !== input.candidateIdentity
      || !input.health.verified
      || !input.health.artifactRef.trim()
    ) {
      return receipt(input, "deployment-receipt.v1", "INCOMPLETE", `deployment:${input.operationId}:health-unverified`);
    }
    return receipt(
      input,
      "deployment-receipt.v1",
      "PROVEN",
      artifactReference("deployment", `${input.operationId}:${candidateHash}:${input.health.artifactRef}`),
    );
  } catch {
    return receipt(input, "deployment-receipt.v1", "UNAVAILABLE", `deployment:${input.operationId}:unavailable`);
  }
}

export type IntegrationValidatorInput = ReceiptContext & {
  verification: {
    source: "server";
    verified: boolean;
    resultHash: string;
    artifactRef: string;
  };
};

export function createIntegrationValidatorReceipt(
  input: IntegrationValidatorInput,
): TaskObjectiveValidatorReceipt {
  const validHash = /^[a-f0-9]{64}$/i.test(input.verification.resultHash);
  if (
    input.verification.source !== "server"
    || !input.verification.verified
    || !validHash
    || !input.verification.artifactRef.trim()
  ) {
    return receipt(input, "integration-receipt.v1", "INCOMPLETE", `integration:${input.operationId}:unverified`);
  }
  return receipt(
    input,
    "integration-receipt.v1",
    "PROVEN",
    artifactReference(
      "integration",
      `${input.operationId}:${input.verification.resultHash}:${input.verification.artifactRef}`,
    ),
  );
}