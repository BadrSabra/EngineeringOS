import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { signPreviewBuildObservation } from "./preview-build-observation-command.js";
import {
  createPreviewBuildReconcileHandler,
  observePreviewBuilderTask,
} from "./preview-build-reconcile.js";
import type { PreviewBuilderRunnerConfig } from "./preview-builder-runner.js";
import type { PreviewEcsClient, PreviewEcsTask } from "./preview-ecs-runner.js";

const now = new Date("2026-11-12T13:00:00.000Z");
const jobId = "123e4567-e89b-42d3-a456-426614174000";
const buildId = "223e4567-e89b-42d3-a456-426614174001";
const clusterArn = "arn:aws:ecs:eu-central-1:123456789012:cluster/preview";
const taskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/builder:3";
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview/abcdef0123456789abcdef0123456789";
const imageDigest = `sha256:${"a".repeat(64)}`;
const outputDigest = "b".repeat(64);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const config: PreviewBuilderRunnerConfig = {
  clusterArn,
  taskDefinitionArn,
  ecrRepositoryUri:
    "123456789012.dkr.ecr.eu-central-1.amazonaws.com/preview-builder",
  imageDigest,
  executionRoleArn: "arn:aws:iam::123456789012:role/preview-execution",
  buildInputBucketName: "engineeringos-preview-artifacts",
  region: "eu-central-1",
  publicKeyPem,
  privateSubnetIds: ["subnet-12345678"],
  securityGroupId: "sg-12345678",
};

function signedToken(taskArn?: string) {
  return signPreviewBuildObservation({
    claims: {
      version: 1,
      action: "preview-build-observe",
      jobId,
      buildId,
      builderImageDigest: imageDigest,
      outputArtifactKey: `preview-build-outputs/${buildId}/site.tar.gz`,
      ...(taskArn ? { taskArn } : {}),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 20_000).toISOString(),
    },
    privateKeyPem,
    now,
  });
}

function task(overrides: Partial<PreviewEcsTask> = {}): PreviewEcsTask {
  return {
    taskArn,
    clusterArn,
    startedBy: jobId,
    taskDefinitionArn,
    lastStatus: "STOPPED",
    containers: [{ name: "builder", exitCode: 0 }],
    ...overrides,
  };
}

function ecsClient(
  input: {
    task?: PreviewEcsTask | null;
    listed?: string[];
  } = {},
): PreviewEcsClient {
  return {
    describeTaskDefinition: vi.fn(async () => null),
    runTask: vi.fn(async () => ({ tasks: [] })),
    describeTask: vi.fn(async () => input.task ?? task()),
    stopTask: vi.fn(async () => undefined),
    listTasks: vi.fn(async () => input.listed ?? [task().taskArn!]),
  };
}

describe("Preview Builder ECS reconciliation", () => {
  it("finds the task by signed startedBy and returns an S3-backed output digest", async () => {
    const ecs = ecsClient();
    const transferProvider = {
      createTransfer: vi.fn(),
      inspectOutput: vi.fn(async () => ({
        outputDigest,
        contentLength: 2048,
      })),
    };

    await expect(
      observePreviewBuilderTask({
        token: signedToken(),
        publicKeyPem,
        ecs,
        transferProvider,
        config,
        now,
      }),
    ).resolves.toEqual({
      jobId,
      buildId,
      state: "stopped",
      taskArn,
      exitCode: 0,
      outputDigest,
    });
    expect(ecs.listTasks).toHaveBeenCalledTimes(3);
    expect(ecs.describeTask).toHaveBeenCalledWith({
      cluster: clusterArn,
      taskArn,
    });
    expect(transferProvider.inspectOutput).toHaveBeenCalledWith({
      buildId,
      outputArtifactKey: `preview-build-outputs/${buildId}/site.tar.gz`,
    });
  });

  it("does not infer success without an exact ECS identity or stored checksum", async () => {
    await expect(
      observePreviewBuilderTask({
        token: signedToken(),
        publicKeyPem,
        ecs: ecsClient({
          task: task({ startedBy: "another-job" }),
        }),
        config,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_RECONCILE_IDENTITY_MISMATCH",
    });

    await expect(
      observePreviewBuilderTask({
        token: signedToken(),
        publicKeyPem,
        ecs: ecsClient(),
        transferProvider: {
          createTransfer: vi.fn(),
          inspectOutput: vi.fn(async () => null),
        },
        config,
        now,
      }),
    ).resolves.toMatchObject({
      state: "stopped",
      exitCode: 0,
    });
  });

  it("rejects unsigned requests before making ECS calls", async () => {
    const ecs = ecsClient();
    const handler = createPreviewBuildReconcileHandler({
      ecs,
      config,
      now: () => now,
    });
    const response = await handler(
      new Request("http://gateway/internal/v1/preview/builds/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "forged" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Builder reconciliation command rejected.",
    });
    expect(ecs.listTasks).not.toHaveBeenCalled();
  });
});
