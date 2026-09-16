import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

vi.mock("./database-schema-preflight.js", () => ({
  getApplicationSchemaSnapshot: vi.fn(),
  findApplicationSchemaIssues: vi.fn(),
}));

import {
  findApplicationSchemaIssues,
  getApplicationSchemaSnapshot,
} from "./database-schema-preflight.js";
import {
  createDatabaseSchemaValidatorReceipt,
  createDeploymentValidatorReceipt,
  createFileConversionValidatorReceipt,
  createIntegrationValidatorReceipt,
  createMediaArtifactValidatorReceipt,
} from "./task-objective-receipts.js";
import {
  createDeliveryWorkspace,
  discardDeliveryWorkspace,
} from "./delivery-workspace.js";

const context = {
  operationId: "operation-receipt",
  projectId: "project-1",
  workspaceRevision: "revision-1",
};

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("task objective receipt adapters", () => {
  it("does not prove a database change from schema shape alone", async () => {
    vi.mocked(getApplicationSchemaSnapshot).mockResolvedValue({} as never);
    vi.mocked(findApplicationSchemaIssues).mockReturnValue([]);

    const withoutMigration = await createDatabaseSchemaValidatorReceipt({
      ...context,
      queryable: {} as never,
    });
    expect(withoutMigration.status).toBe("INCOMPLETE");

    const withMigration = await createDatabaseSchemaValidatorReceipt({
      ...context,
      queryable: {} as never,
      migrationEvidence: {
        verified: true,
        artifactRef: "runtime-schema-check:operation-receipt",
      },
    });
    expect(withMigration).toMatchObject({
      validatorId: "database-schema.v1",
      status: "PROVEN",
      operationId: context.operationId,
      projectId: context.projectId,
      workspaceRevision: context.workspaceRevision,
    });
  });

  it("checks approved file output hashes and media signatures", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "eos-receipt-"));
    tempRoots.push(root);
    const output = path.join(root, "converted.json");
    const contents = Buffer.from('{"ok":true}', "utf8");
    await writeFile(output, contents);
    const expectedSha256 = createHash("sha256").update(contents).digest("hex");

    const fileReceipt = await createFileConversionValidatorReceipt({
      ...context,
      rootPath: root,
      relativePath: "converted.json",
      expectedSha256,
    });
    expect(fileReceipt.status).toBe("PROVEN");

    await writeFile(path.join(root, "image.png"), Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]));
    const mediaReceipt = await createMediaArtifactValidatorReceipt({
      ...context,
      rootPath: root,
      relativePath: "image.png",
      expectedFormat: "png",
    });
    expect(mediaReceipt.status).toBe("PROVEN");

    const traversal = await createFileConversionValidatorReceipt({
      ...context,
      rootPath: root,
      relativePath: "../converted.json",
    });
    expect(traversal.status).toBe("UNAVAILABLE");
  });

  it("binds deployment receipts to the isolated candidate hash and health witness", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "eos-delivery-source-"));
    tempRoots.push(root);
    await writeFile(path.join(root, "index.ts"), "export const ok = true;\n");
    const workspace = await createDeliveryWorkspace({
      rootPath: root,
      operationId: context.operationId,
      baseRevision: context.workspaceRevision,
      changes: [],
    });
    const proven = await createDeploymentValidatorReceipt({
      ...context,
      candidateWorkspace: workspace.workspaceRoot,
      candidateIdentity: workspace.candidateTreeHash,
      health: { verified: true, artifactRef: "health:release" },
    });
    expect(proven.status).toBe("PROVEN");

    const stale = await createDeploymentValidatorReceipt({
      ...context,
      candidateWorkspace: workspace.workspaceRoot,
      candidateIdentity: "stale-candidate",
      health: { verified: true, artifactRef: "health:release" },
    });
    expect(stale.status).toBe("INCOMPLETE");
    await discardDeliveryWorkspace(workspace.workspaceRoot, context.operationId);
  });

  it("accepts only server-verified integration results", () => {
    const resultHash = "a".repeat(64);
    expect(createIntegrationValidatorReceipt({
      ...context,
      verification: {
        source: "server",
        verified: true,
        resultHash,
        artifactRef: "remote-state:github:123",
      },
    }).status).toBe("PROVEN");
    expect(createIntegrationValidatorReceipt({
      ...context,
      verification: {
        source: "server",
        verified: false,
        resultHash,
        artifactRef: "provider-claimed-success",
      },
    }).status).toBe("INCOMPLETE");
  });
});