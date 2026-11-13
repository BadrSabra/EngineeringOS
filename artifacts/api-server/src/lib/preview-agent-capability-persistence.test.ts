import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  previewAgentNodesTable,
  projectsTable,
} from "@workspace/db";
import { afterEach, describe, expect, it } from "vitest";
import { revokePreviewAgentNode } from "./preview-agent-pairing.js";

const projectIds: string[] = [];

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("Preview Agent capability persistence", () => {
  it("clears the stored signed report when the registered node is revoked", async () => {
    const projectId = randomUUID();
    const nodeId = randomUUID();
    const storeId = randomUUID();
    const now = new Date();
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "preview-agent-capability-test",
      name: `preview-agent-test-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(previewAgentNodesTable).values({
      nodeId,
      projectId,
      userId: "preview-agent-capability-test",
      storeId,
      status: "active",
      publicKeyPem: "test-public-key-placeholder",
      publicKeyFingerprint: "a".repeat(64),
      agentVersion: "1.2.3",
      platform: "linux",
      capabilityReportToken: "signed-report-payload.signature",
      capabilityExpiresAt: new Date(now.getTime() + 20_000),
      keyVersion: 1,
      pairedAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const revoked = await revokePreviewAgentNode({ projectId, nodeId, now });
    await db
      .update(previewAgentNodesTable)
      .set({
        capabilityReportToken: "stale-report-to-clear",
        capabilityExpiresAt: new Date(now.getTime() + 20_000),
      })
      .where(eq(previewAgentNodesTable.nodeId, nodeId));
    const repeatedRevocation = await revokePreviewAgentNode({
      projectId,
      nodeId,
      now: new Date(now.getTime() + 1_000),
    });
    const [stored] = await db
      .select({
        status: previewAgentNodesTable.status,
        capabilityReportToken: previewAgentNodesTable.capabilityReportToken,
        capabilityExpiresAt: previewAgentNodesTable.capabilityExpiresAt,
        publicKeyFingerprint: previewAgentNodesTable.publicKeyFingerprint,
      })
      .from(previewAgentNodesTable)
      .where(
        and(
          eq(previewAgentNodesTable.projectId, projectId),
          eq(previewAgentNodesTable.nodeId, nodeId),
        ),
      );

    expect(revoked?.status).toBe("revoked");
    expect(repeatedRevocation?.status).toBe("revoked");
    expect(stored).toEqual({
      status: "revoked",
      capabilityReportToken: null,
      capabilityExpiresAt: null,
      publicKeyFingerprint: "a".repeat(64),
    });
  });
});
