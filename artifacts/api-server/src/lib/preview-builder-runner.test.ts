import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPreviewBuildJob } from "./preview-build-job.js";
import type { PreviewBuildJobFence } from "./preview-build-job-fence.js";
import type { PreviewBuildJobEnvelopeStore } from "./preview-build-job-envelope.js";
import {
  executePreviewBuilderJob,
  PreviewBuilderRunnerError,
  type PreviewBuilderRunnerConfig,
} from "./preview-builder-runner.js";
import type {
  PreviewEcsClient,
  PreviewTaskDefinition,
} from "./preview-ecs-runner.js";

const now = new Date("2026-11-11T00:00:00.000Z");
const jobId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const buildId = "a9328405-57f6-44ce-8f4a-880647cd00dd";
const clusterArn =
  "arn:aws:ecs:eu-central-1:123456789012:cluster/engineeringos-preview";
const taskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite-builder:3";
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/engineeringos-preview/abcdef0123456789abcdef0123456789";
const region = "eu-central-1";
const bucket = "engineeringos-preview-artifacts";
const repository =
  "123456789012.dkr.ecr.eu-central-1.amazonaws.com/engineeringos-preview-vite-builder";
const imageDigest = `sha256:${"c".repeat(64)}`;
const executionRoleArn =
  "arn:aws:iam::123456789012:role/engineeringos-preview-execution";
const inputArchiveDigest = "d".repeat(64);
const sourceDigest = "e".repeat(64);
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
  ecrRepositoryUri: repository,
  imageDigest,
  executionRoleArn,
  buildInputBucketName: bucket,
  region,
  publicKeyPem,
  privateSubnetIds: ["subnet-12345678", "subnet-abcdef12"],
  securityGroupId: "sg-12345678",
};

function createJob() {
  const projectId = "project-preview-test";
  const proposalId = "proposal-preview-test";
  const operationId = "operation-preview-test";
  const candidateRevision = "a".repeat(64);
  const changeSetHash = "b".repeat(64);
  const inputBindingDigest = createHash("sha256")
    .update(
      JSON.stringify({
        projectId,
        proposalId,
        operationId,
        proposalRevision: 7,
        candidateRevision,
        changeSetHash,
        sourceDigest,
      }),
    )
    .digest("hex");
  const inputArtifactKey = `build-inputs/${inputBindingDigest}/${inputArchiveDigest}.zip`;
  const outputArtifactKey = `preview-build-outputs/${buildId}/site.tar.gz`;
  const claims = {
    version: 1,
    action: "preview-build",
    jobId,
    buildId,
    builderProfile: "vite-react-static-v1",
    builderImageDigest: imageDigest,
    projectId,
    proposalId,
    operationId,
    proposalRevision: 7,
    candidateRevision,
    changeSetHash,
    sourceRoot: "client",
    sourceDigest,
    inputArtifactKey,
    archiveDigest: inputArchiveDigest,
    outputArtifactKey,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  } as const;
  const token = signPreviewBuildJob({
    claims,
    privateKeyPem,
    now,
  });
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const signature = "f".repeat(64);
  const inputDownloadUrl = `https://${host}/${inputArtifactKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-SignedHeaders=host&X-Amz-Signature=${signature}`;
  const outputUploadUrl = `https://${host}/${outputArtifactKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-SignedHeaders=host%3Bif-none-match&X-Amz-Signature=${signature}`;
  return { claims, token, inputDownloadUrl, outputUploadUrl };
}

function taskDefinition(
  overrides: Partial<PreviewTaskDefinition> = {},
): PreviewTaskDefinition {
  return {
    taskDefinitionArn,
    executionRoleArn,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "1024",
    memory: "2048",
    runtimePlatform: {
      operatingSystemFamily: "LINUX",
      cpuArchitecture: "X86_64",
    },
    volumes: [{ name: "builder-tmp" }],
    containerDefinitions: [
      {
        name: "builder",
        image: `${repository}@${imageDigest}`,
        essential: true,
        user: "10001:10001",
        readonlyRootFilesystem: true,
        privileged: false,
        linuxParameters: { capabilities: { drop: ["ALL"] } },
        mountPoints: [
          {
            sourceVolume: "builder-tmp",
            containerPath: "/tmp",
            readOnly: false,
          },
        ],
        environment: [
          { name: "AWS_REGION", value: region },
          { name: "PREVIEW_S3_BUCKET", value: bucket },
          { name: "PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM", value: publicKeyPem },
        ],
      },
    ],
    ...overrides,
  };
}

class FakeEcs implements PreviewEcsClient {
  definition = taskDefinition();
  launches: Parameters<PreviewEcsClient["runTask"]>[0][] = [];
  requests: Parameters<PreviewEcsClient["runTask"]>[0][] = [];
  private tasksByClientToken = new Map<
    string,
    NonNullable<Awaited<ReturnType<PreviewEcsClient["runTask"]>>["tasks"]>
  >();
  async describeTaskDefinition() {
    return this.definition;
  }
  async runTask(input: Parameters<PreviewEcsClient["runTask"]>[0]) {
    this.requests.push(input);
    const existing = this.tasksByClientToken.get(input.clientToken);
    if (existing) return { tasks: existing };
    this.launches.push(input);
    const tasks = [
      {
        taskArn,
        clusterArn,
        startedBy: jobId,
        taskDefinitionArn,
        lastStatus: "PROVISIONING",
      },
    ];
    this.tasksByClientToken.set(input.clientToken, tasks);
    return { tasks };
  }
  async describeTask() {
    return null;
  }
  async stopTask() {}
  async listTasks() {
    return [];
  }
}

class MemoryFence implements PreviewBuildJobFence {
  readonly claims = new Map<
    string,
    { fingerprint: string; expiresAtEpoch: number }
  >();
  async claimOrResume(input: {
    jobId: string;
    fingerprint: string;
    nowEpoch: number;
    expiresAtEpoch: number;
  }) {
    const existing = this.claims.get(input.jobId);
    if (existing) {
      return (
        existing.fingerprint === input.fingerprint &&
        existing.expiresAtEpoch === input.expiresAtEpoch &&
        input.expiresAtEpoch > input.nowEpoch
      );
    }
    this.claims.set(input.jobId, {
      fingerprint: input.fingerprint,
      expiresAtEpoch: input.expiresAtEpoch,
    });
    return true;
  }
}

class MemoryEnvelopeStore implements PreviewBuildJobEnvelopeStore {
  readonly records = new Map<
    string,
    {
      fingerprint: string;
      values: {
        token: string;
        inputDownloadUrl: string;
        outputUploadUrl: string;
      };
    }
  >();
  async put(input: {
    jobId: string;
    fingerprint: string;
    values: {
      token: string;
      inputDownloadUrl: string;
      outputUploadUrl: string;
    };
  }) {
    const existing = this.records.get(input.jobId);
    if (existing && existing.fingerprint !== input.fingerprint) {
      throw new Error("Envelope fingerprint mismatch.");
    }
    if (!existing) {
      this.records.set(input.jobId, {
        fingerprint: input.fingerprint,
        values: input.values,
      });
    }
    return {
      value: `arn:aws:s3:::${bucket}/builder-job-envelopes/${input.jobId}.env`,
    };
  }
}

function dependenciesFor(
  job: ReturnType<typeof createJob>,
  ecs = new FakeEcs(),
  fence = new MemoryFence(),
  envelopeStore = new MemoryEnvelopeStore(),
) {
  return {
    request: { token: job.token },
    ecs,
    fence,
    envelopeStore,
    transferProvider: {
      createTransfer: async () => ({
        inputDownloadUrl: job.inputDownloadUrl,
        outputUploadUrl: job.outputUploadUrl,
        outputArtifactKey: job.claims.outputArtifactKey,
        outputUploadHeaders: { "If-None-Match": "*" as const },
      }),
    },
    config,
    now,
  };
}

describe("isolated Preview Builder ECS launch", () => {
  it("launches one fixed Builder task with signed job data and a pinned verifier", async () => {
    const job = createJob();
    const { ecs, fence, envelopeStore, ...input } = dependenciesFor(job);

    await expect(
      executePreviewBuilderJob({
        ...input,
        ecs,
        fence,
        envelopeStore,
      }),
    ).resolves.toEqual({ jobId, buildId, taskArn });

    expect(fence.claims.size).toBe(1);
    expect(ecs.launches).toHaveLength(1);
    expect(ecs.launches[0]).toMatchObject({
      cluster: clusterArn,
      taskDefinition: taskDefinitionArn,
      overrides: {
        containerOverrides: [
          {
            name: "builder",
            environmentFiles: [
              {
                value: `arn:aws:s3:::${bucket}/builder-job-envelopes/${jobId}.env`,
                type: "s3",
              },
            ],
          },
        ],
      },
      clientToken: jobId,
      startedBy: jobId,
      count: 1,
      launchType: "FARGATE",
      platformVersion: "1.4.0",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: config.privateSubnetIds,
          securityGroups: [config.securityGroupId],
          assignPublicIp: "DISABLED",
        },
      },
    });
    expect(JSON.stringify(ecs.launches[0])).not.toContain(job.token);
    expect(JSON.stringify(ecs.launches[0])).not.toContain(job.inputDownloadUrl);
    expect(JSON.stringify(ecs.launches[0])).not.toContain(job.outputUploadUrl);
    expect(envelopeStore.records.get(jobId)?.values).toEqual({
      token: job.token,
      inputDownloadUrl: job.inputDownloadUrl,
      outputUploadUrl: job.outputUploadUrl,
    });
  });

  it("rejects invalid signatures before task description, fence claims, or launch", async () => {
    const job = createJob();
    const ecs = new FakeEcs();
    const fence = new MemoryFence();
    const token = `${job.token.slice(0, -1)}${job.token.endsWith("A") ? "B" : "A"}`;
    const envelopeStore = new MemoryEnvelopeStore();

    await expect(
      executePreviewBuilderJob({
        ...dependenciesFor(job, ecs, fence, envelopeStore),
        request: { token },
        ecs,
        fence,
        envelopeStore,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILDER_JOB_REJECTED",
    } satisfies Partial<PreviewBuilderRunnerError>);
    expect(fence.claims.size).toBe(0);
    expect(ecs.launches).toHaveLength(0);
    expect(envelopeStore.records.size).toBe(0);
  });

  it("rejects unpinned task settings and key overrides before claiming the job", async () => {
    const job = createJob();
    const ecs = new FakeEcs();
    ecs.definition = taskDefinition({
      containerDefinitions: [
        {
          ...taskDefinition().containerDefinitions![0]!,
          environment: [
            ...taskDefinition().containerDefinitions![0]!.environment!,
            { name: "EXTRA", value: "injected" },
          ],
        },
      ],
    });
    const fence = new MemoryFence();
    const envelopeStore = new MemoryEnvelopeStore();

    await expect(
      executePreviewBuilderJob({
        ...dependenciesFor(job, ecs, fence, envelopeStore),
        ecs,
        fence,
        envelopeStore,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILDER_TASK_DEFINITION_REJECTED",
    });
    expect(fence.claims.size).toBe(0);
    expect(ecs.launches).toHaveLength(0);
  });

  it("allows only the ephemeral /tmp scratch mount required by builds", async () => {
    for (const definition of [
      taskDefinition({
        volumes: [
          {
            name: "builder-tmp",
            efsVolumeConfiguration: { fileSystemId: "fs-0123456789abcdef0" },
          },
        ],
      }),
      taskDefinition({
        containerDefinitions: [
          {
            ...taskDefinition().containerDefinitions![0]!,
            mountPoints: [
              {
                sourceVolume: "builder-tmp",
                containerPath: "/workspace",
                readOnly: false,
              },
            ],
          },
        ],
      }),
      taskDefinition({
        volumes: [{ name: "builder-tmp" }, { name: "extra" }],
      }),
      taskDefinition({
        runtimePlatform: {
          operatingSystemFamily: "LINUX",
          cpuArchitecture: "ARM64",
        },
      }),
    ]) {
      const job = createJob();
      const ecs = new FakeEcs();
      ecs.definition = definition;
      const fence = new MemoryFence();
      const envelopeStore = new MemoryEnvelopeStore();

      await expect(
        executePreviewBuilderJob({
          ...dependenciesFor(job, ecs, fence, envelopeStore),
          ecs,
          fence,
          envelopeStore,
        }),
      ).rejects.toMatchObject({
        code: "PREVIEW_BUILDER_TASK_DEFINITION_REJECTED",
      });
      expect(fence.claims.size).toBe(0);
      expect(ecs.launches).toHaveLength(0);
    }
  });

  it("recovers an ambiguous launch with the same fingerprint and idempotency token", async () => {
    const job = createJob();
    const ecs = new FakeEcs();
    const fence = new MemoryFence();
    const input = dependenciesFor(job, ecs, fence, new MemoryEnvelopeStore());

    await expect(executePreviewBuilderJob(input)).resolves.toEqual({
      jobId,
      buildId,
      taskArn,
    });
    await expect(executePreviewBuilderJob(input)).resolves.toEqual({
      jobId,
      buildId,
      taskArn,
    });
    expect(ecs.requests).toHaveLength(2);
    expect(ecs.requests[0]).toEqual(ecs.requests[1]);
    expect(ecs.launches).toHaveLength(1);
  });

  it("rejects a retry if fixed launch configuration changed", async () => {
    const job = createJob();
    const ecs = new FakeEcs();
    const fence = new MemoryFence();
    const input = dependenciesFor(job, ecs, fence);

    await executePreviewBuilderJob(input);
    await expect(
      executePreviewBuilderJob({
        ...input,
        config: { ...config, securityGroupId: "sg-87654321" },
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILDER_JOB_REPLAYED",
    });
    expect(ecs.requests).toHaveLength(1);
    expect(ecs.launches).toHaveLength(1);
  });

  it("rejects a transfer provider that returns an output key outside the signed job", async () => {
    const job = createJob();
    const ecs = new FakeEcs();
    const fence = new MemoryFence();
    const envelopeStore = new MemoryEnvelopeStore();
    await expect(
      executePreviewBuilderJob({
        ...dependenciesFor(job, ecs, fence, envelopeStore),
        transferProvider: {
          createTransfer: async () => ({
            inputDownloadUrl: job.inputDownloadUrl,
            outputUploadUrl: job.outputUploadUrl,
            outputArtifactKey: `preview-build-outputs/${randomUUID()}/site.tar.gz`,
            outputUploadHeaders: { "If-None-Match": "*" },
          }),
        },
        ecs,
        fence,
        envelopeStore,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILDER_JOB_REJECTED",
    });
    expect(fence.claims.size).toBe(0);
    expect(ecs.launches).toHaveLength(0);
  });
});
