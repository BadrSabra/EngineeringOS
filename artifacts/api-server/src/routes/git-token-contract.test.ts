import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { aiProviderCredentialsTable, db, projectsTable } from "@workspace/db";
import app from "../app.js";
import { decryptApiKey, encryptApiKey } from "../lib/credentials-crypto.js";
import { loadProjectGitHubRequest } from "../lib/github-delivery-service.js";
import type { GitHubRequestInit } from "../lib/github-connector.js";

afterEach(() => vi.unstubAllEnvs());

describe("legacy GitHub credential contract", () => {
  it("encrypts saves, returns metadata only, and supports explicit removal", async () => {
    vi.stubEnv("AI_CREDENTIALS_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const token = "ghp_0123456789abcdefghijklmnopqrstuvwx";
    const [prior] = await db.select().from(aiProviderCredentialsTable)
      .where(and(
        eq(aiProviderCredentialsTable.ownerId, "test-user"),
        eq(aiProviderCredentialsTable.provider, "github"),
      ));
    try {
      const response = await request(app).put("/api/ai/github-token").send({ token });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({ configured: true, last4: token.slice(-4) });
      expect(JSON.stringify(response.body)).not.toContain(token);
      const [credential] = await db.select().from(aiProviderCredentialsTable)
        .where(eq(aiProviderCredentialsTable.ownerId, "test-user"));
      expect(credential!.encryptedApiKey).not.toContain(token);
      expect(decryptApiKey(credential!.encryptedApiKey)).toBe(token);

      const status = await request(app).get("/api/ai/github-token");
      expect(status.body).toMatchObject({ configured: true, last4: token.slice(-4) });
      expect(JSON.stringify(status.body)).not.toContain(token);
      expect(status.body).not.toHaveProperty("encryptedApiKey");
      expect((await request(app).delete("/api/ai/github-token")).status).toBe(200);
    } finally {
      await db.delete(aiProviderCredentialsTable)
        .where(eq(aiProviderCredentialsTable.ownerId, "test-user"));
      if (prior) await db.insert(aiProviderCredentialsTable).values(prior);
    }
  });

  it("does not use another account's PAT for a project's connector call", async () => {
    const projectId = `github-token-owner-${randomUUID()}`;
    const otherOwnerId = `different-user-${randomUUID()}`;
    const ownerId = `project-owner-${randomUUID()}`;
    const ownToken = "ghp_owner0123456789abcdefghijklmnop";
    const otherToken = "ghp_other0123456789abcdefghijklmnop";
    vi.stubEnv("AI_CREDENTIALS_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    await db.insert(projectsTable).values({
      id: projectId, ownerId, name: "GitHub token owner test",
      rootPath: `/tmp/${projectId}`, language: "typescript",
    });
    await db.insert(aiProviderCredentialsTable).values({
      id: randomUUID(), ownerId: otherOwnerId, provider: "github",
      encryptedApiKey: encryptApiKey(otherToken), last4: otherToken.slice(-4),
    });
    try {
      const connectorRequest = vi.fn(async (_path: string, _init?: GitHubRequestInit) => ({}));
      expect(await loadProjectGitHubRequest(projectId, connectorRequest)).toBeNull();
      await db.insert(aiProviderCredentialsTable).values({
        id: randomUUID(), ownerId, provider: "github",
        encryptedApiKey: encryptApiKey(ownToken), last4: ownToken.slice(-4),
      });
      const authenticatedRequest = await loadProjectGitHubRequest(projectId, connectorRequest);
      expect(authenticatedRequest).toBeTypeOf("function");
      await authenticatedRequest!("/user");
      const forwardedInit = connectorRequest.mock.calls[0]?.[1];
      expect(forwardedInit).toBeDefined();
      expect(forwardedInit?.accessToken).toBe(ownToken);
      expect(forwardedInit?.accessToken).not.toBe(otherToken);
    } finally {
      await db.delete(aiProviderCredentialsTable)
        .where(eq(aiProviderCredentialsTable.ownerId, otherOwnerId));
      await db.delete(aiProviderCredentialsTable).where(eq(aiProviderCredentialsTable.ownerId, ownerId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});
