import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EmpiricalCorpusMetadataError,
  empiricalCorpusVerificationExitCode,
  verifyEmpiricalQualityCorpus,
  type EmpiricalCorpusMetadataTransport,
} from "./verify-empirical-quality-corpus.js";
import type { EmpiricalQualityCorpus } from "@workspace/ai-orchestrator";

const revision = "0123456789abcdef0123456789abcdef01234567";
const baseCase = {
  id: "case-001",
  repositoryId: "example-repository",
  repositoryUrl: "https://github.com/example/repository.git",
  sourceRevision: revision,
  selectedFiles: ["src/auth.ts", "README.md"],
  outcome: "defect" as const,
  expectedVerdict: "findings" as const,
  expectedGateDecision: "reject" as const,
  findings: [{
    id: "finding-001",
    file: "src/auth.ts",
    lineStart: 1,
    type: "security" as const,
    severity: "high" as const,
  }],
};
const corpus: EmpiricalQualityCorpus = {
  kind: "empirical-ai-quality-corpus",
  version: 1,
  corpusRevision: "test-v1",
  cases: [
    baseCase,
    {
      ...baseCase,
      id: "case-002",
      repositoryId: "second-repository",
      repositoryUrl: "https://github.com/example/second-repository",
      outcome: "clean",
      expectedVerdict: "clean",
      expectedGateDecision: "accept",
      selectedFiles: ["LICENSE"],
      findings: [],
    },
  ],
};

function transportFor(
  change: Partial<{
    commit: Partial<Awaited<ReturnType<EmpiricalCorpusMetadataTransport["getCommit"]>>>;
    tree: Partial<Awaited<ReturnType<EmpiricalCorpusMetadataTransport["getTree"]>>>;
    commitError: Error;
    treeError: Error;
  }> = {},
): EmpiricalCorpusMetadataTransport {
  return {
    getCommit: async (repositoryUrl) => {
      if (change.commitError) throw change.commitError;
      return {
        sha: revision,
        treeSha: revision,
        repositoryFullName: new URL(repositoryUrl).pathname.slice(1).replace(/\.git$/, ""),
        ...change.commit,
      };
    },
    getTree: async (repositoryUrl) => {
      if (change.treeError) throw change.treeError;
      return {
        sha: revision,
        repositoryFullName: new URL(repositoryUrl).pathname.slice(1).replace(/\.git$/, ""),
        entries: [
          { path: "src/auth.ts", mode: "100644", type: "blob" },
          { path: "README.md", mode: "100644", type: "blob" },
          { path: "LICENSE", mode: "100644", type: "blob" },
        ],
        ...change.tree,
      };
    },
  };
}

describe("empirical corpus provenance preflight", () => {
  it("verifies every v1 case and every selected regular blob", async () => {
    let commitCalls = 0;
    const transport = transportFor();
    const getCommit = transport.getCommit;
    transport.getCommit = async (...args) => {
      commitCalls += 1;
      return getCommit(...args);
    };
    const report = await verifyEmpiricalQualityCorpus(corpus, { transport });
    expect(report.status).toBe("VERIFIED");
    expect(report.cases).toHaveLength(2);
    expect(report.cases.every((entry) => entry.status === "VERIFIED")).toBe(true);
    expect(report.cases[0]?.paths.map((entry) => entry.status)).toEqual(["VERIFIED", "VERIFIED"]);
    expect(commitCalls).toBe(2);
  });

  it("checks the checked-in v2 corpus with a fixture transport", async () => {
    const fixture = JSON.parse(await fs.readFile(
      new URL("../../../../lib/ai-orchestrator/src/benchmark-fixtures/reviewed-empirical-quality-corpus-v2.json", import.meta.url),
      "utf8",
    )) as EmpiricalQualityCorpus;
    const report = await verifyEmpiricalQualityCorpus(fixture, {
      transport: {
        getCommit: async (repositoryUrl, sha) => ({
          sha,
          treeSha: sha,
          repositoryFullName: new URL(repositoryUrl).pathname.slice(1).replace(/\.git$/, ""),
        }),
        getTree: async (repositoryUrl, sha) => ({
          sha,
          repositoryFullName: new URL(repositoryUrl).pathname.slice(1).replace(/\.git$/, ""),
          entries: fixture.cases
            .filter((entry) => entry.repositoryUrl === repositoryUrl && entry.sourceRevision === sha)
            .flatMap((entry) => entry.selectedFiles.map((file) => ({
              path: file,
              mode: "100644",
              type: "blob",
            }))),
        }),
      },
    });
    expect(report.status).toBe("VERIFIED");
    expect(report.cases).toHaveLength(12);
  });

  it("distinguishes missing revisions, repository mismatches, and missing paths", async () => {
    const missingRevision = await verifyEmpiricalQualityCorpus(corpus, {
      transport: transportFor({ commitError: new EmpiricalCorpusMetadataError("not_found") }),
    });
    expect(missingRevision.status).toBe("PROVENANCE_FAILED");
    expect(missingRevision.cases[0]).toMatchObject({
      revisionStatus: "MISSING",
      status: "FAILED",
      reason: "metadata_not_found",
    });

    const mismatch = await verifyEmpiricalQualityCorpus(corpus, {
      transport: transportFor({ commit: { repositoryFullName: "other/repository" } }),
    });
    expect(mismatch.cases[0]).toMatchObject({
      revisionStatus: "MISMATCH",
      status: "FAILED",
      reason: "repository_mismatch",
    });

    const missingPath = await verifyEmpiricalQualityCorpus(corpus, {
      transport: transportFor({ tree: { entries: [{ path: "src/auth.ts", mode: "100644", type: "blob" }] } }),
    });
    expect(missingPath.status).toBe("PROVENANCE_FAILED");
    expect(missingPath.cases[0]?.paths[1]).toMatchObject({
      status: "MISSING",
      reason: "path_not_found",
    });
  });

  it("rejects trees, symlinks, and submodules rather than treating them as files", async () => {
    const report = await verifyEmpiricalQualityCorpus(corpus, {
      transport: transportFor({
        tree: {
          entries: [
            { path: "src/auth.ts", mode: "120000", type: "blob" },
            { path: "README.md", mode: "040000", type: "tree" },
            { path: "LICENSE", mode: "160000", type: "commit" },
          ],
        },
      }),
    });
    expect(report.status).toBe("PROVENANCE_FAILED");
    expect(report.cases[0]?.paths.map((entry) => entry.status)).toEqual(["SYMLINK", "TREE"]);
    expect(report.cases[1]?.paths[0]).toMatchObject({
      status: "SUBMODULE",
      reason: "submodule_not_allowed",
    });
  });

  it("keeps network and rate-limit uncertainty distinct from known provenance failures", async () => {
    const network = await verifyEmpiricalQualityCorpus(corpus, {
      transport: transportFor({
        commitError: new EmpiricalCorpusMetadataError("transport"),
      }),
    });
    expect(network.status).toBe("TRANSPORT_FAILED");
    expect(network.cases.every((entry) => entry.status === "UNVERIFIABLE")).toBe(true);

    const rateLimited = await verifyEmpiricalQualityCorpus(corpus, {
      transport: transportFor({
        commitError: new EmpiricalCorpusMetadataError("rate_limited"),
      }),
    });
    expect(rateLimited.status).toBe("TRANSPORT_FAILED");
    expect(rateLimited.cases[0]).toMatchObject({
      revisionStatus: "UNVERIFIABLE",
      reason: "rate_limited",
    });
  });

  it("validates malformed corpus input before any metadata transport is called", async () => {
    let calls = 0;
    await expect(verifyEmpiricalQualityCorpus({
      ...corpus,
      cases: [{
        ...corpus.cases[0]!,
        repositoryUrl: "https://github.com/user:secret@example.invalid/repository",
      }],
    }, {
      transport: {
        getCommit: async () => {
          calls += 1;
          return { sha: revision };
        },
        getTree: async () => {
          calls += 1;
          return { sha: revision, entries: [] };
        },
      },
    })).rejects.toThrow(/public HTTPS GitHub repository/);
    expect(calls).toBe(0);
  });

  it("never includes metadata bodies, credentials, or absolute paths in its report", async () => {
    const report = await verifyEmpiricalQualityCorpus(corpus, {
      transport: transportFor({
        tree: {
          entries: [{
            path: "src/auth.ts",
            mode: "100644",
            type: "blob",
          }],
        },
      }),
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("source body");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain(process.cwd());
    expect(serialized).not.toContain("download_url");
  });

  it("maps verified, provenance, and transport outcomes to distinct exit codes", () => {
    expect(empiricalCorpusVerificationExitCode("VERIFIED")).toBe(0);
    expect(empiricalCorpusVerificationExitCode("PROVENANCE_FAILED")).toBe(2);
    expect(empiricalCorpusVerificationExitCode("TRANSPORT_FAILED")).toBe(3);
  });
});