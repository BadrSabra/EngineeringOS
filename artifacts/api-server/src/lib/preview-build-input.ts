import { createHash } from "node:crypto";
import { constants as fsConstants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  hashDeliveryTree,
  shouldExcludeDeliveryEntry,
} from "./delivery-workspace.js";

const DIRECTORY_OPEN_FLAGS =
  fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
const FILE_READ_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
export const PREVIEW_BUILD_INPUT_MANIFEST_PATH =
  "engineeringos-preview-manifest.json";
const DEFAULT_MAX_FILES = 5_000;
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export type PreviewBuildInputIdentity = {
  projectId: string;
  proposalId: string;
  operationId: string;
  proposalRevision: number;
  candidateRevision: string;
  changeSetHash: string;
};

export type PreviewBuildInputManifest = PreviewBuildInputIdentity & {
  version: 1;
  builderProfile: "vite-react-static-v1";
  sourceRoot: string;
  sourceDigest: string;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
  }>;
};

export type PreviewBuildInputArchive = {
  archive: Buffer;
  archiveDigest: string;
  manifest: PreviewBuildInputManifest;
  totalBytes: number;
};

export class PreviewBuildInputError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_INPUT_INVALID"
      | "PREVIEW_BUILD_INPUT_UNAVAILABLE"
      | "PREVIEW_BUILD_INPUT_CHANGED"
      | "PREVIEW_BUILD_INPUT_UNSAFE"
      | "PREVIEW_BUILD_INPUT_SENSITIVE"
      | "PREVIEW_BUILD_INPUT_SECRET"
      | "PREVIEW_BUILD_INPUT_LIMIT",
  ) {
    super("Candidate source is not eligible for an isolated Preview build.");
    this.name = "PreviewBuildInputError";
  }
}

type CollectedFile = {
  path: string;
  bytes: Buffer;
  sha256: string;
};

function descriptorPath(directory: FileHandle, name?: string): string {
  const base = `/proc/self/fd/${directory.fd}`;
  return name ? path.join(base, name) : base;
}

function sameNodeIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
  );
}

function sameStableMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameNodeIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink
  );
}

function safeRelativePath(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.includes("\0") ||
    value
      .split("/")
      .some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.includes(":"),
      )
  ) {
    throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_UNSAFE");
  }
  return value;
}

export function isValidPreviewBuildSourceRoot(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    (value === "." ||
      (!value.includes("\\") &&
        !value.startsWith("/") &&
        !value.includes("\0") &&
        value
          .split("/")
          .every(
            (segment) =>
              segment.length > 0 &&
              segment !== "." &&
              segment !== ".." &&
              !segment.includes(":"),
          )))
  );
}

function isSensitivePath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  const basename = segments.at(-1)?.toLowerCase() ?? "";
  if (
    segments.some((segment) =>
      [".aws", ".ssh", ".gnupg"].includes(segment.toLowerCase()),
    )
  ) {
    return true;
  }
  if (
    /^\.env/i.test(basename) ||
    [".npmrc", ".netrc", ".pypirc", ".git-credentials"].includes(basename) ||
    /(?:^|[-_.])(credentials|secrets?)(?:[-_.]|$)/i.test(basename) ||
    /^(?:id_(?:rsa|ed25519|ecdsa|dsa)|kubeconfig)$/i.test(basename) ||
    /\.(?:pem|key|p12|pfx|keystore)$/i.test(basename)
  ) {
    return true;
  }
  return false;
}

function isPlaceholderSecret(value: string): boolean {
  return /^(?:change[-_ ]?me|example|placeholder|dummy|test|your[-_ ]?value|replace[-_ ]?me|redacted|not[-_ ]?set)$/i.test(
    value.trim(),
  );
}

function containsCredentialMaterial(bytes: Buffer): boolean {
  const text = bytes.toString("latin1");
  const highConfidencePatterns = [
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{30,255}\b/,
    /\bglpat-[A-Za-z0-9_-]{20,255}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/,
    /\b(?:sk|rk)_live_[A-Za-z0-9_-]{16,255}\b/,
    /\bwhsec_[A-Za-z0-9_-]{16,255}\b/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/@]+:[^@\s/]{8,}@/i,
  ];
  if (highConfidencePatterns.some((pattern) => pattern.test(text))) return true;

  const assignments = text.matchAll(
    /\b(?:api[_-]?key|client[_-]?secret|secret|password|passwd|token|credential|private[_-]?key)\b\s*[:=]\s*(?:"([^"]{8,})"|'([^']{8,})'|`([^`]{8,})`|([A-Za-z0-9/+_.=-]{16,}))/gi,
  );
  for (const match of assignments) {
    const value = match.slice(1).find(Boolean)?.trim();
    if (!value || isPlaceholderSecret(value)) continue;
    if (
      /^(?:process\.env|import\.meta\.env)(?:\.|$)/i.test(value) ||
      /^\$\{(?:process\.env|import\.meta\.env)/i.test(value)
    ) {
      continue;
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && !/\d/.test(value)) {
      continue;
    }
    return true;
  }
  return false;
}

function validateIdentity(
  input: PreviewBuildInputIdentity,
): PreviewBuildInputIdentity {
  if (
    !input ||
    typeof input.projectId !== "string" ||
    input.projectId.length < 1 ||
    input.projectId.length > 255 ||
    typeof input.proposalId !== "string" ||
    input.proposalId.length < 1 ||
    input.proposalId.length > 255 ||
    typeof input.operationId !== "string" ||
    input.operationId.length < 1 ||
    input.operationId.length > 255 ||
    !Number.isSafeInteger(input.proposalRevision) ||
    input.proposalRevision < 0 ||
    !/^[a-f0-9]{64}$/i.test(input.candidateRevision) ||
    !/^[a-f0-9]{64}$/i.test(input.changeSetHash)
  ) {
    throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_INVALID");
  }
  return input;
}

async function collectCandidateFiles(
  rootPath: string,
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number },
): Promise<{ files: CollectedFile[]; totalBytes: number }> {
  const root = await realpath(rootPath).catch(() => {
    throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_UNAVAILABLE");
  });
  const rootHandle = await open(root, DIRECTORY_OPEN_FLAGS).catch(() => {
    throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_UNAVAILABLE");
  });
  const files: CollectedFile[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;

  const visit = async (
    directory: FileHandle,
    relativeDirectory: string,
  ): Promise<void> => {
    const beforeDirectory = await directory.stat({ bigint: true }).catch(() => {
      throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
    });
    const entries = await readdir(descriptorPath(directory), {
      withFileTypes: true,
    }).catch(() => {
      throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
    });

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = safeRelativePath(
        relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
      );
      if (
        relative === ".engineeringos-delivery-workspace" ||
        shouldExcludeDeliveryEntry(
          path.join(root, ...relative.split("/")),
          root,
        )
      ) {
        continue;
      }
      if (
        seenPaths.has(relative) ||
        relative === PREVIEW_BUILD_INPUT_MANIFEST_PATH
      ) {
        throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_UNSAFE");
      }
      seenPaths.add(relative);

      const anchoredPath = descriptorPath(directory, entry.name);
      const entryStat = await lstat(anchoredPath, { bigint: true }).catch(
        () => {
          throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
        },
      );

      if (
        entryStat.isSymbolicLink() ||
        (!entryStat.isDirectory() && !entryStat.isFile())
      ) {
        throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_UNSAFE");
      }
      if (entryStat.isDirectory()) {
        const child = await open(anchoredPath, DIRECTORY_OPEN_FLAGS).catch(
          () => {
            throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
          },
        );
        try {
          const openedStat = await child.stat({ bigint: true });
          if (!sameNodeIdentity(entryStat, openedStat)) {
            throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
          }
          await visit(child, relative);
        } finally {
          await child.close().catch(() => undefined);
        }
        continue;
      }

      if (isSensitivePath(relative)) {
        throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_SENSITIVE");
      }
      if (
        entryStat.nlink !== 1n ||
        entryStat.size > BigInt(limits.maxFileBytes)
      ) {
        throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_LIMIT");
      }

      const file = await open(anchoredPath, FILE_READ_FLAGS).catch(() => {
        throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
      });
      try {
        const openedStat = await file.stat({ bigint: true });
        if (
          !sameStableMetadata(entryStat, openedStat) ||
          !openedStat.isFile()
        ) {
          throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
        }
        const bytes = await file.readFile();
        const afterReadStat = await file.stat({ bigint: true });
        if (
          !sameStableMetadata(openedStat, afterReadStat) ||
          BigInt(bytes.byteLength) !== afterReadStat.size
        ) {
          throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
        }
        if (containsCredentialMaterial(bytes)) {
          throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_SECRET");
        }
        totalBytes += bytes.byteLength;
        if (
          files.length >= limits.maxFiles ||
          totalBytes > limits.maxTotalBytes
        ) {
          throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_LIMIT");
        }
        files.push({
          path: relative,
          bytes,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      } finally {
        await file.close().catch(() => undefined);
      }
    }

    const afterDirectory = await directory.stat({ bigint: true }).catch(() => {
      throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
    });
    if (!sameStableMetadata(beforeDirectory, afterDirectory)) {
      throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
    }
  };

  try {
    await visit(rootHandle, "");
    return { files, totalBytes };
  } finally {
    await rootHandle.close().catch(() => undefined);
  }
}

export async function createPreviewBuildInputArchive(input: {
  workspaceRoot: string;
  sourceRoot: string;
  identity: PreviewBuildInputIdentity;
  limits?: {
    maxFiles?: number;
    maxFileBytes?: number;
    maxTotalBytes?: number;
  };
}): Promise<PreviewBuildInputArchive> {
  const identity = validateIdentity(input.identity);
  if (!isValidPreviewBuildSourceRoot(input.sourceRoot)) {
    throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_INVALID");
  }
  const limits = {
    maxFiles: input.limits?.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: input.limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: input.limits?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  };
  if (
    !Number.isSafeInteger(limits.maxFiles) ||
    limits.maxFiles < 1 ||
    !Number.isSafeInteger(limits.maxFileBytes) ||
    limits.maxFileBytes < 1 ||
    !Number.isSafeInteger(limits.maxTotalBytes) ||
    limits.maxTotalBytes < 1
  ) {
    throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_INVALID");
  }

  const initialTreeHash = await hashDeliveryTree(input.workspaceRoot).catch(
    () => {
      throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_UNAVAILABLE");
    },
  );
  if (
    initialTreeHash.toLowerCase() !== identity.candidateRevision.toLowerCase()
  ) {
    throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
  }

  const collected = await collectCandidateFiles(input.workspaceRoot, limits);
  const finalTreeHash = await hashDeliveryTree(input.workspaceRoot).catch(
    () => {
      throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
    },
  );
  if (
    finalTreeHash.toLowerCase() !== identity.candidateRevision.toLowerCase()
  ) {
    throw new PreviewBuildInputError("PREVIEW_BUILD_INPUT_CHANGED");
  }

  const files = collected.files
    .map(({ path: filePath, bytes, sha256 }) => ({
      path: filePath,
      size: bytes.byteLength,
      sha256,
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  const sourceDigest = createHash("sha256")
    .update(JSON.stringify({ sourceRoot: input.sourceRoot, files }))
    .digest("hex");
  const manifest: PreviewBuildInputManifest = {
    version: 1,
    builderProfile: "vite-react-static-v1",
    ...identity,
    sourceRoot: input.sourceRoot,
    sourceDigest,
    files,
  };

  const zip = new AdmZip();
  for (const file of collected.files) {
    zip.addFile(file.path, file.bytes);
  }
  zip.addFile(
    PREVIEW_BUILD_INPUT_MANIFEST_PATH,
    Buffer.from(JSON.stringify(manifest), "utf8"),
  );
  const archive = zip.toBuffer();
  return {
    archive,
    archiveDigest: createHash("sha256").update(archive).digest("hex"),
    manifest,
    totalBytes: collected.totalBytes,
  };
}
