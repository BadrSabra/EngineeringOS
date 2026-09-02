import path from "node:path";
import {
  validateEmpiricalQualityCorpus,
  type EmpiricalCorpusCase,
  type EmpiricalQualityCorpus,
} from "@workspace/ai-orchestrator";
import { loadEmpiricalQualityCorpus } from "./run-empirical-quality-campaign.js";

const DEFAULT_CORPUS_PATH = path.resolve(
  process.cwd(),
  "../../lib/ai-orchestrator/src/benchmark-fixtures/reviewed-empirical-quality-corpus-v2.json",
);
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const SAFE_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const REGULAR_FILE_MODES = new Set(["100644", "100755", "100664", "100775"]);

export type EmpiricalCorpusMetadataEntry = {
  path: string;
  mode: string;
  type: string;
  sha?: string;
};

export type EmpiricalCorpusCommitMetadata = {
  sha: string;
  treeSha?: string;
  repositoryFullName?: string;
};

export type EmpiricalCorpusTreeMetadata = {
  sha: string;
  entries: readonly EmpiricalCorpusMetadataEntry[];
  truncated?: boolean;
  repositoryFullName?: string;
};

export type EmpiricalCorpusMetadataTransport = {
  getCommit: (
    repositoryUrl: string,
    revision: string,
    signal: AbortSignal,
  ) => Promise<EmpiricalCorpusCommitMetadata>;
  getTree: (
    repositoryUrl: string,
    revision: string,
    signal: AbortSignal,
    selectedFiles?: readonly string[],
  ) => Promise<EmpiricalCorpusTreeMetadata>;
};

type MetadataFailureKind =
  | "not_found"
  | "repository_mismatch"
  | "rate_limited"
  | "transport"
  | "malformed_metadata";

export class EmpiricalCorpusMetadataError extends Error {
  readonly kind: MetadataFailureKind;

  constructor(kind: MetadataFailureKind) {
    super(kind);
    this.name = "EmpiricalCorpusMetadataError";
    this.kind = kind;
  }
}

export type EmpiricalCorpusPathVerification = {
  path: string;
  status: "VERIFIED" | "MISSING" | "TREE" | "SYMLINK" | "SUBMODULE" | "NOT_REGULAR_FILE" | "UNVERIFIABLE";
  reason?: string;
};

export type EmpiricalCorpusCaseVerification = {
  caseId: string;
  repositoryId: string;
  repositoryUrl: string;
  revision: string;
  revisionStatus: "VERIFIED" | "MISSING" | "MISMATCH" | "UNVERIFIABLE";
  status: "VERIFIED" | "FAILED" | "UNVERIFIABLE";
  paths: EmpiricalCorpusPathVerification[];
  reason?: string;
};

export type EmpiricalCorpusVerificationReport = {
  kind: "empirical-ai-quality-corpus-verification";
  version: 1;
  corpusRevision: string;
  status: "VERIFIED" | "PROVENANCE_FAILED" | "TRANSPORT_FAILED";
  cases: EmpiricalCorpusCaseVerification[];
};

export type EmpiricalCorpusVerificationOptions = {
  transport?: EmpiricalCorpusMetadataTransport;
  signal?: AbortSignal;
};

export const EMPIRICAL_QUALITY_CORPUS_EXIT_CODES = {
  VERIFIED: 0,
  PROVENANCE_FAILED: 2,
  TRANSPORT_FAILED: 3,
} as const;

function repositoryParts(repositoryUrl: string): { owner: string; name: string; fullName: string } {
  const parsed = new URL(repositoryUrl);
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) throw new EmpiricalCorpusMetadataError("malformed_metadata");
  const owner = match[1]!;
  const name = match[2]!;
  return { owner, name, fullName: `${owner}/${name}`.toLowerCase() };
}

function repositoryFromApiUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+?)(?:\/|$)/);
    return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function assertRepository(repositoryUrl: string, repositoryFullName: string | undefined): void {
  if (!repositoryFullName) return;
  const expected = repositoryParts(repositoryUrl).fullName;
  if (repositoryFullName.toLowerCase() !== expected) {
    throw new EmpiricalCorpusMetadataError("repository_mismatch");
  }
}

function assertRevision(sha: string, revision: string): void {
  if (!SAFE_SHA.test(sha) || sha.toLowerCase() !== revision.toLowerCase()) {
    throw new EmpiricalCorpusMetadataError("repository_mismatch");
  }
}

async function readGitHubJson(
  url: string,
  signal: AbortSignal,
): Promise<{ value: unknown; finalUrl: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "engineeringos-corpus-preflight",
      },
      redirect: "error",
      signal,
    });
  } catch {
    throw new EmpiricalCorpusMetadataError("transport");
  }
  if (response.status === 403 || response.status === 429) {
    throw new EmpiricalCorpusMetadataError("rate_limited");
  }
  if (response.status === 404) {
    throw new EmpiricalCorpusMetadataError("not_found");
  }
  if (!response.ok) {
    throw new EmpiricalCorpusMetadataError("transport");
  }
  try {
    const text = await response.text();
    if (text.length > 8_000_000) throw new EmpiricalCorpusMetadataError("malformed_metadata");
    return { value: JSON.parse(text) as unknown, finalUrl: response.url };
  } catch (error) {
    if (error instanceof EmpiricalCorpusMetadataError) throw error;
    throw new EmpiricalCorpusMetadataError("malformed_metadata");
  }
}

export const githubEmpiricalCorpusMetadataTransport: EmpiricalCorpusMetadataTransport = {
  async getCommit(repositoryUrl, revision, signal) {
    const { owner, name, fullName } = repositoryParts(repositoryUrl);
    const endpoint = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${revision}`;
    const response = await readGitHubJson(endpoint, signal);
    if (repositoryFromApiUrl(response.finalUrl) !== fullName) {
      throw new EmpiricalCorpusMetadataError("repository_mismatch");
    }
    if (!response.value || typeof response.value !== "object") {
      throw new EmpiricalCorpusMetadataError("malformed_metadata");
    }
    const value = response.value as {
      sha?: unknown;
      commit?: { tree?: { sha?: unknown } };
    };
    if (typeof value.sha !== "string" || !SAFE_SHA.test(value.sha)) {
      throw new EmpiricalCorpusMetadataError("malformed_metadata");
    }
    assertRevision(value.sha, revision);
    if (typeof value.commit?.tree?.sha !== "string" || !SAFE_SHA.test(value.commit.tree.sha)) {
      throw new EmpiricalCorpusMetadataError("malformed_metadata");
    }
    return {
      sha: value.sha,
      treeSha: value.commit.tree.sha,
      repositoryFullName: fullName,
    };
  },

  async getTree(repositoryUrl, revision, signal, selectedFiles) {
    const { owner, name, fullName } = repositoryParts(repositoryUrl);
    const treeCache = new Map<string, EmpiricalCorpusMetadataEntry[]>();
    const readTree = async (treeRevision: string): Promise<EmpiricalCorpusMetadataEntry[]> => {
      const cached = treeCache.get(treeRevision.toLowerCase());
      if (cached) return cached;
      const endpoint = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${treeRevision}`;
      const response = await readGitHubJson(endpoint, signal);
      if (repositoryFromApiUrl(response.finalUrl) !== fullName) {
        throw new EmpiricalCorpusMetadataError("repository_mismatch");
      }
      if (!response.value || typeof response.value !== "object") {
        throw new EmpiricalCorpusMetadataError("malformed_metadata");
      }
      const value = response.value as {
        sha?: unknown;
        truncated?: unknown;
        tree?: unknown;
      };
      if (typeof value.sha !== "string" || !SAFE_SHA.test(value.sha) || !Array.isArray(value.tree) ||
          value.sha.toLowerCase() !== treeRevision.toLowerCase()) {
        throw new EmpiricalCorpusMetadataError("malformed_metadata");
      }
      if (value.truncated === true) throw new EmpiricalCorpusMetadataError("transport");
      const entries: EmpiricalCorpusMetadataEntry[] = [];
      for (const entry of value.tree) {
        if (!entry || typeof entry !== "object") throw new EmpiricalCorpusMetadataError("malformed_metadata");
        const candidate = entry as { path?: unknown; mode?: unknown; type?: unknown; sha?: unknown };
        if (typeof candidate.path !== "string" ||
            typeof candidate.mode !== "string" ||
            typeof candidate.type !== "string" ||
            (candidate.sha !== undefined && (typeof candidate.sha !== "string" || !SAFE_SHA.test(candidate.sha)))) {
          throw new EmpiricalCorpusMetadataError("malformed_metadata");
        }
        entries.push({
          path: candidate.path,
          mode: candidate.mode,
          type: candidate.type,
          ...(candidate.sha === undefined ? {} : { sha: candidate.sha }),
        });
      }
      treeCache.set(treeRevision.toLowerCase(), entries);
      return entries;
    };

    const entries: EmpiricalCorpusMetadataEntry[] = [];
    for (const selectedFile of selectedFiles ?? []) {
      const parts = selectedFile.split("/");
      let treeRevision = revision;
      let leaf: EmpiricalCorpusMetadataEntry | undefined;
      for (const [index, part] of parts.entries()) {
        const currentEntries = await readTree(treeRevision);
        leaf = currentEntries.find((entry) => entry.path === part);
        if (!leaf) break;
        if (index < parts.length - 1) {
          if (leaf.type !== "tree" || !leaf.sha) {
            leaf = undefined;
            break;
          }
          treeRevision = leaf.sha;
        }
      }
      if (leaf) entries.push({ ...leaf, path: selectedFile });
    }
    return { sha: revision, entries, truncated: false, repositoryFullName: fullName };
  },
};

function failureReason(kind: MetadataFailureKind): string {
  switch (kind) {
    case "not_found":
      return "metadata_not_found";
    case "repository_mismatch":
      return "repository_mismatch";
    case "rate_limited":
      return "rate_limited";
    case "malformed_metadata":
      return "metadata_malformed";
    case "transport":
      return "metadata_unavailable";
  }
}

function unavailablePaths(testCase: EmpiricalCorpusCase, reason: string): EmpiricalCorpusPathVerification[] {
  return testCase.selectedFiles.map((file) => ({ path: file, status: "UNVERIFIABLE", reason }));
}

function verifyTreeEntry(
  entry: EmpiricalCorpusMetadataEntry | undefined,
  file: string,
): EmpiricalCorpusPathVerification {
  if (!entry) return { path: file, status: "MISSING", reason: "path_not_found" };
  if (entry.mode === "120000") return { path: file, status: "SYMLINK", reason: "symlink_not_allowed" };
  if (entry.mode === "160000" || entry.type === "commit") {
    return { path: file, status: "SUBMODULE", reason: "submodule_not_allowed" };
  }
  if (entry.type === "tree") return { path: file, status: "TREE", reason: "directory_not_allowed" };
  if (entry.type !== "blob" || !REGULAR_FILE_MODES.has(entry.mode)) {
    return { path: file, status: "NOT_REGULAR_FILE", reason: "regular_blob_required" };
  }
  return { path: file, status: "VERIFIED" };
}

function isProvenanceFailure(kind: MetadataFailureKind): boolean {
  return kind === "not_found" || kind === "repository_mismatch";
}

async function verifyCase(
  testCase: EmpiricalCorpusCase,
  transport: EmpiricalCorpusMetadataTransport,
  signal: AbortSignal,
): Promise<{ result: EmpiricalCorpusCaseVerification; transportFailure: boolean }> {
  let commit: EmpiricalCorpusCommitMetadata;
  try {
    commit = await transport.getCommit(testCase.repositoryUrl, testCase.sourceRevision, signal);
    assertRepository(testCase.repositoryUrl, commit.repositoryFullName);
    assertRevision(commit.sha, testCase.sourceRevision);
  } catch (error) {
    const failure = error instanceof EmpiricalCorpusMetadataError
      ? error
      : new EmpiricalCorpusMetadataError("transport");
    const reason = failureReason(failure.kind);
    return {
      transportFailure: !isProvenanceFailure(failure.kind),
      result: {
        caseId: testCase.id,
        repositoryId: testCase.repositoryId,
        repositoryUrl: testCase.repositoryUrl,
        revision: testCase.sourceRevision,
        revisionStatus: failure.kind === "not_found" ? "MISSING" :
          failure.kind === "repository_mismatch" ? "MISMATCH" : "UNVERIFIABLE",
        status: isProvenanceFailure(failure.kind) ? "FAILED" : "UNVERIFIABLE",
        paths: unavailablePaths(testCase, reason),
        reason,
      },
    };
  }

  let tree: EmpiricalCorpusTreeMetadata;
  try {
    tree = await transport.getTree(testCase.repositoryUrl, commit.sha, signal, testCase.selectedFiles);
    assertRepository(testCase.repositoryUrl, tree.repositoryFullName);
    if (!SAFE_SHA.test(tree.sha) || tree.sha.toLowerCase() !== commit.sha.toLowerCase()) {
      throw new EmpiricalCorpusMetadataError("malformed_metadata");
    }
  } catch (error) {
    const failure = error instanceof EmpiricalCorpusMetadataError
      ? error
      : new EmpiricalCorpusMetadataError("transport");
    const reason = failureReason(failure.kind);
    return {
      transportFailure: !isProvenanceFailure(failure.kind),
      result: {
        caseId: testCase.id,
        repositoryId: testCase.repositoryId,
        repositoryUrl: testCase.repositoryUrl,
        revision: testCase.sourceRevision,
        revisionStatus: "VERIFIED",
        status: isProvenanceFailure(failure.kind) ? "FAILED" : "UNVERIFIABLE",
        paths: unavailablePaths(testCase, reason),
        reason,
      },
    };
  }

  const entries = new Map<string, EmpiricalCorpusMetadataEntry>();
  for (const entry of tree.entries) {
    if (entries.has(entry.path)) {
      return {
        transportFailure: true,
        result: {
          caseId: testCase.id,
          repositoryId: testCase.repositoryId,
          repositoryUrl: testCase.repositoryUrl,
          revision: testCase.sourceRevision,
          revisionStatus: "VERIFIED",
          status: "UNVERIFIABLE",
          paths: unavailablePaths(testCase, "metadata_ambiguous"),
          reason: "metadata_ambiguous",
        },
      };
    }
    entries.set(entry.path, entry);
  }
  const paths = testCase.selectedFiles.map((file) => verifyTreeEntry(entries.get(file), file));
  const failed = paths.some((entry) => entry.status !== "VERIFIED");
  return {
    transportFailure: false,
    result: {
      caseId: testCase.id,
      repositoryId: testCase.repositoryId,
      repositoryUrl: testCase.repositoryUrl,
      revision: testCase.sourceRevision,
      revisionStatus: "VERIFIED",
      status: failed ? "FAILED" : "VERIFIED",
      paths,
      ...(failed ? { reason: "selected_path_invalid" } : {}),
    },
  };
}

export async function verifyEmpiricalQualityCorpus(
  input: EmpiricalQualityCorpus,
  options: EmpiricalCorpusVerificationOptions = {},
): Promise<EmpiricalCorpusVerificationReport> {
  const corpus = validateEmpiricalQualityCorpus(input);
  const transport = options.transport ?? githubEmpiricalCorpusMetadataTransport;
  const signal = options.signal ?? new AbortController().signal;
  const commitCache = new Map<string, Promise<EmpiricalCorpusCommitMetadata>>();
  const cachedTransport: EmpiricalCorpusMetadataTransport = {
    getCommit: (repositoryUrl, revision, commitSignal) => {
      const key = `${repositoryUrl.toLowerCase()}@${revision.toLowerCase()}`;
      const cached = commitCache.get(key);
      if (cached) return cached;
      const pending = transport.getCommit(repositoryUrl, revision, commitSignal);
      commitCache.set(key, pending);
      return pending;
    },
    getTree: (repositoryUrl, revision, treeSignal, selectedFiles) =>
      transport.getTree(repositoryUrl, revision, treeSignal, selectedFiles),
  };
  const cases: EmpiricalCorpusCaseVerification[] = [];
  let transportFailure = false;
  for (const testCase of corpus.cases) {
    const verified = await verifyCase(testCase, cachedTransport, signal);
    cases.push(verified.result);
    transportFailure ||= verified.transportFailure;
  }
  return {
    kind: "empirical-ai-quality-corpus-verification",
    version: 1,
    corpusRevision: corpus.corpusRevision,
    status: transportFailure
      ? "TRANSPORT_FAILED"
      : cases.some((entry) => entry.status === "FAILED")
        ? "PROVENANCE_FAILED"
        : "VERIFIED",
    cases,
  };
}

export async function loadEmpiricalQualityCorpusForVerification(
  filePath = process.env.EMPIRICAL_QUALITY_CORPUS_PATH?.trim() || DEFAULT_CORPUS_PATH,
): Promise<EmpiricalQualityCorpus> {
  return loadEmpiricalQualityCorpus(filePath);
}

export function empiricalCorpusVerificationExitCode(
  status: EmpiricalCorpusVerificationReport["status"],
): number {
  return status === "VERIFIED"
    ? EMPIRICAL_QUALITY_CORPUS_EXIT_CODES.VERIFIED
    : status === "PROVENANCE_FAILED"
      ? EMPIRICAL_QUALITY_CORPUS_EXIT_CODES.PROVENANCE_FAILED
      : EMPIRICAL_QUALITY_CORPUS_EXIT_CODES.TRANSPORT_FAILED;
}

async function main(): Promise<void> {
  try {
    const corpus = await loadEmpiricalQualityCorpusForVerification();
    const report = await verifyEmpiricalQualityCorpus(corpus);
    console.log(JSON.stringify(report));
    process.exitCode = empiricalCorpusVerificationExitCode(report.status);
  } catch {
    console.log(JSON.stringify({
      kind: "empirical-ai-quality-corpus-verification",
      version: 1,
      corpusRevision: null,
      status: "PROVENANCE_FAILED",
      cases: [],
      reason: "invalid_corpus",
    }));
    process.exitCode = EMPIRICAL_QUALITY_CORPUS_EXIT_CODES.PROVENANCE_FAILED;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await main();
}