import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPreviewControlCommand } from "./preview-control-command.js";
import {
  createPreviewCommandFence,
  type PreviewCommandFenceStorage,
} from "./preview-command-fence.js";
import {
  createPreviewGatewayControlHandler,
  type PreviewGatewayHandlerDependencies,
} from "./preview-gateway-control-handler.js";
import type { PreviewEcsClient } from "./preview-ecs-runner.js";

const now = new Date("2026-11-11T00:00:00.000Z");
const sessionId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const taskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:4";
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/engineeringos-preview/abcdef0123456789abcdef0123456789";
const outputArtifactUrl =
  "https://engineeringos-preview-artifacts.s3.eu-central-1.amazonaws.com/preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz?sig=test";
const imageDigest = `sha256:${"c".repeat(64)}`;
const repository =
  "123456789012.dkr.ecr.eu-central-1.amazonaws.com/preview-vite";
const clusterArn =
  "arn:aws:ecs:eu-central-1:123456789012:cluster/engineeringos-preview";
const executionRoleArn =
  "arn:aws:iam::123456789012:role/engineeringos-preview-execution";
const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = keyPair.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

class FakeEcs implements PreviewEcsClient {
  calls = 0;
  async describeTaskDefinition() {
    this.calls += 1;
    return {
      taskDefinitionArn,
      executionRoleArn,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "256",
      memory: "512",
      containerDefinitions: [
        {
          name: "preview",
          image: `${repository}@${imageDigest}`,
          essential: true,
          user: "10001:10001",
          readonlyRootFilesystem: true,
          privileged: false,
          linuxParameters: { capabilities: { drop: ["ALL"] } },
          portMappings: [
            { containerPort: 8080, hostPort: 8080, protocol: "tcp" },
          ],
        },
      ],
    };
  }
  async runTask() {
    this.calls += 1;
    return {
      tasks: [
        {
          taskArn,
          clusterArn,
          startedBy: sessionId,
          taskDefinitionArn,
          lastStatus: "PROVISIONING",
        },
      ],
    };
  }
  async describeTask() {
    this.calls += 1;
    return null;
  }
  async listTasks() {
    this.calls += 1;
    return [];
  }
  async stopTask() {
    this.calls += 1;
  }
}

class HandlerFenceStorage implements PreviewCommandFenceStorage {
  readonly records = new Map<
    string,
    Awaited<ReturnType<PreviewCommandFenceStorage["read"]>>
  >();

  async advance(record: Parameters<PreviewCommandFenceStorage["advance"]>[0]) {
    const current = this.records.get(record.sessionId);
    if (current && current.stateVersion >= record.stateVersion) {
      return "conflict" as const;
    }
    this.records.set(record.sessionId, record);
    return "advanced" as const;
  }

  async read(sessionId: string) {
    return this.records.get(sessionId) ?? null;
  }
}

const dependencies: PreviewGatewayHandlerDependencies = {
  publicKeyPem,
  ecs: new FakeEcs(),
  buildOutputUrlProvider: {
    createDownloadUrl: async () => outputArtifactUrl,
  },
  fence: createPreviewCommandFence(new HandlerFenceStorage()),
  config: {
    clusterArn,
    taskDefinitionArnPrefix:
      "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:",
    ecrRepositoryUri: repository,
    executionRoleArn,
    privateSubnetIds: ["subnet-12345678"],
    runnerSecurityGroupId: "sg-12345678",
  },
  now: () => now,
};

function signedToken() {
  return signPreviewControlCommand(
    {
      version: 1,
      action: "start",
      commandId: "88a2ac82-09ee-4f51-b53a-bbf120c4f9e4",
      sessionId,
      stateVersion: 0,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15_000).toISOString(),
      proposalId: "proposal-test",
      proposalRevision: 7,
      candidateRevision: "a".repeat(64),
      changeSetHash: "b".repeat(64),
      outputArtifactKey:
        "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz",
      outputArtifactDigest: "d".repeat(64),
      imageDigest,
      taskDefinitionArn,
      sessionExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    },
    privateKeyPem,
    now,
  );
}

describe("Preview Gateway control handler", () => {
  it("accepts a signed command only on the fixed POST route", async () => {
    const ecs = new FakeEcs();
    const handler = createPreviewGatewayControlHandler({
      ...dependencies,
      ecs,
    });
    const response = await handler(
      new Request("https://preview.example.com/internal/v1/preview/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: signedToken() }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      action: "start",
      taskArn,
      taskDefinitionArn,
    });
    expect(ecs.calls).toBe(2);

    const notFound = await handler(
      new Request("https://preview.example.com/internal/other", {
        method: "POST",
      }),
    );
    expect(notFound.status).toBe(404);
  });

  it("rejects unsigned, oversized, and extra-field requests without ECS calls", async () => {
    const ecs = new FakeEcs();
    const handler = createPreviewGatewayControlHandler({
      ...dependencies,
      ecs,
    });
    const unsigned = await handler(
      new Request("https://preview.example.com/internal/v1/preview/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: `${signedToken()}x` }),
      }),
    );
    expect(unsigned.status).toBe(403);

    const extra = await handler(
      new Request("https://preview.example.com/internal/v1/preview/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: signedToken(), sessionId }),
      }),
    );
    expect(extra.status).toBe(400);

    const oversized = await handler(
      new Request("https://preview.example.com/internal/v1/preview/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "x".repeat(9_000) }),
      }),
    );
    expect(oversized.status).toBe(400);
    expect(ecs.calls).toBe(0);
  });
});
