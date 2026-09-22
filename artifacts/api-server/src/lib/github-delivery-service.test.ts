import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executeVerifiedGitHubDelivery } from "./github-delivery-service.js";

function params(overrides: Partial<Parameters<typeof executeVerifiedGitHubDelivery>[0]> = {}) {
  return {
    projectId: randomUUID(),
    proposalId: randomUUID(),
    operationId: randomUUID(),
    rootPath: process.cwd(),
    remoteUrl: "https://github.com/example/project.git",
    branch: "main",
    message: "Verified delivery",
    ...overrides,
  };
}

describe("verified GitHub delivery service", () => {
  it("does not touch the database or connector after cancellation", async () => {
    const result = await executeVerifiedGitHubDelivery(params({
      signal: AbortSignal.abort(),
    }));
    expect(result).toMatchObject({
      status: "blocked",
      detail: "GitHub delivery was cancelled before execution.",
    });
  });

  it("rejects non-GitHub remotes before proposal lookup or mutation", async () => {
    const result = await executeVerifiedGitHubDelivery(params({
      remoteUrl: "https://gitlab.com/example/project.git",
    }));
    expect(result).toMatchObject({
      status: "blocked",
      detail: "GitHub delivery requires a credential-free HTTPS GitHub remote.",
    });
  });

  it("fails closed when the committed proposal cannot be found", async () => {
    const result = await executeVerifiedGitHubDelivery(params());
    expect(result).toMatchObject({
      status: "blocked",
      detail: "GitHub delivery requires the same committed proposal operation.",
    });
  });
});