import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHostDisposableTempDirectory } from "./disposable-temp.js";
import {
  createBenchmarkDisposableRootLease,
  createBenchmarkFixtureRepairAuthorization,
  revokeBenchmarkDisposableRootLease,
  type BenchmarkDisposableRootLease,
} from "./benchmark-fixture-authorization.js";

describe("disposable benchmark fixture authorization", () => {
  const roots: string[] = [];
  const leases: BenchmarkDisposableRootLease[] = [];

  afterEach(async () => {
    for (const lease of leases.splice(0)) revokeBenchmarkDisposableRootLease(lease);
    await Promise.all(roots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ));
  });

  it("authorizes only the active root, case, fixture scope, files, and validation profile", async () => {
    const rootPath = await createHostDisposableTempDirectory("engineeringos-code-agent-auth-test-");
    roots.push(rootPath);
    const targetPath = "src/target.ts";
    await fs.mkdir(path.dirname(path.join(rootPath, targetPath)), { recursive: true });
    await fs.writeFile(path.join(rootPath, targetPath), "export const flag = true;\n", "utf8");
    const lease = await createBenchmarkDisposableRootLease(rootPath);
    leases.push(lease);
    const authorization = await createBenchmarkFixtureRepairAuthorization({
      lease,
      rootPath,
      projectId: "benchmark-project",
      caseId: "single-file-001",
      allowedPaths: [targetPath],
      validationProfiles: ["workspace-typecheck"],
    });
    const context = {
      rootPath,
      projectId: "benchmark-project",
      caseId: "single-file-001",
      scopedFindingStatus: "FIXTURE_PROVEN",
      planRootPath: rootPath,
      planPaths: [targetPath],
      approvedPaths: [targetPath],
      executionPaths: [targetPath],
      approvedValidationProfiles: ["workspace-typecheck"],
    };

    await expect(authorization.authorize(context)).resolves.toBe(true);
    await expect(authorization.authorize({
      ...context,
      scopedFindingStatus: "PRODUCTION_PROVEN",
    })).resolves.toBe(false);
    await expect(authorization.authorize({
      ...context,
      approvedPaths: [targetPath, "src/other.ts"],
    })).resolves.toBe(false);
    await expect(authorization.authorize({
      ...context,
      approvedValidationProfiles: ["workspace-tests"],
    })).resolves.toBe(false);

    revokeBenchmarkDisposableRootLease(lease);
    leases.splice(leases.indexOf(lease), 1);
    await expect(authorization.authorize(context)).resolves.toBe(false);
  });

  it("rejects symlinked target paths and roots outside the campaign temp prefix", async () => {
    const rootPath = await createHostDisposableTempDirectory("engineeringos-code-agent-auth-test-");
    roots.push(rootPath);
    const targetPath = "src/linked.ts";
    await fs.mkdir(path.dirname(path.join(rootPath, targetPath)), { recursive: true });
    await fs.symlink(path.join(rootPath, "real.ts"), path.join(rootPath, targetPath));
    await fs.writeFile(path.join(rootPath, "real.ts"), "export const flag = true;\n", "utf8");
    const lease = await createBenchmarkDisposableRootLease(rootPath);
    leases.push(lease);
    const authorization = await createBenchmarkFixtureRepairAuthorization({
      lease,
      rootPath,
      projectId: "benchmark-project",
      caseId: "single-file-001",
      allowedPaths: [targetPath],
      validationProfiles: ["workspace-typecheck"],
    });

    await expect(authorization.authorize({
      rootPath,
      projectId: "benchmark-project",
      caseId: "single-file-001",
      scopedFindingStatus: "FIXTURE_PROVEN",
      planRootPath: rootPath,
      planPaths: [targetPath],
      approvedPaths: [targetPath],
      executionPaths: [targetPath],
      approvedValidationProfiles: ["workspace-typecheck"],
    })).resolves.toBe(false);

    const ordinaryRoot = await fs.mkdtemp(path.join("/tmp", "ordinary-root-"));
    roots.push(ordinaryRoot);
    await expect(createBenchmarkDisposableRootLease(ordinaryRoot)).rejects.toThrow(
      "host-disposable campaign root",
    );
  });
});