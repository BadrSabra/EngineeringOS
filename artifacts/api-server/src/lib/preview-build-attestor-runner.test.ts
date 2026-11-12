import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPreviewBuildJob } from "./preview-build-job.js";
import type { PreviewBuildAttestorFence } from "./preview-build-attestor-fence.js";
import type { PreviewBuildAttestorEnvelopeStore } from "./preview-build-attestor-envelope.js";
import {
  executePreviewBuildAttestorJob,
  previewBuildAttestorStartedBy,
  type PreviewBuildAttestorRunnerConfig,
} from "./preview-build-attestor-runner.js";
import type {
  PreviewEcsClient,
  PreviewEcsTask,
  PreviewTaskDefinition,
} from "./preview-ecs-runner.js";

const now = new Date("2026-11-12T13:00:00.000Z");
const jobId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const buildId = "a9328405-57f6-44ce-8f4a-880647cd00dd";
const clusterArn =
  "arn:aws:ecs:eu-central-1:123456789012:cluster/engineeringos-preview";
const builderTaskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite-builder:3";
const attestorTaskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-attestor:4";
const builderTaskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/engineeringos-preview/abcdef0123456789abcdef0123456789";
const attestorTaskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/engineeringos-preview/0123456789abcdef0123456789abcdef";
const region = "eu-central-1";
const bucket = "engineeringos-preview-artifacts";
const builderRepository =
  "123456789012.dkr.ecr.eu-central-1.amazonaws.com/engineeringos-preview-vite-builder";
const attestorRepository =
  "123456789012.dkr.ecr.eu-central-1.amazonaws.com/engineeringos-preview-attestor";
const builderImageDigest = `sha256:${"c".repeat(64)}`;
const attestorImageDigest = `sha256:${"d".repeat(64)}`;
const builderExecutionRoleArn =
  "arn:aws:iam::123456789012:role/engineeringos-preview-builder-execution";
const attestorExecutionRoleArn =
  "arn:aws:iam::123456789012:role/engineeringos-preview-attestor-execution";
const attestorTaskRoleArn =
  "arn:aws:iam::123456789012:role/engineeringos-preview-attestor-task";
const receiptSigningSecretArn =
  "arn:aws:secretsmanager:eu-central-1:123456789012:secret:engineeringos-preview-attestor-signing-abc123";
const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = keyPair.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const builderConfig = {
  clusterArn,
  taskDefinitionArn: builderTaskDefinitionArn,
  ecrRepositoryUri: builderRepository,
  imageDigest: builderImageDigest,
  executionRoleArn: builderExecutionRoleArn,
  buildInputBucketName: bucket,
  region,
  publicKeyPem,
  privateSubnetIds: ["subnet-12345678"],
  securityGroupId: "sg-12345678",
};
const config: PreviewBuildAttestorRunnerConfig = {
  region,
  bucketName: bucket,
  clusterArn,
  builderConfig,
  taskDefinitionArn: attestorTaskDefinitionArn,
  ecrRepositoryUri: attestorRepository,
  imageDigest: attestorImageDigest,
  executionRoleArn: attestorExecutionRoleArn,
  taskRoleArn: attestorTaskRoleArn,
  receiptSigningSecretArn,
  privateSubnetIds: ["subnet-abcdef12"],
  securityGroupId: "sg-abcdef12",
};

function signedJob() {
  const projectId = "project-preview-test";
  const proposalId = "proposal-preview-test";
  const operationId = "operation-preview-test";
  const candidateRevision = "a".repeat(64);
  const changeSetHash = "b".repeat(64);
  const sourceDigest = "e".repeat(64);
  const archiveDigest = "f".repeat(64);
  const bindingDigest = createHash("sha256")
    .update(
      JSON.stringify({
        projectId,
        proposalId,
        operationId,
        proposalRevision: 3,
        candidateRevision,
        changeSetHash,
        sourceDigest,
      }),
    )
    .digest("hex");
  const claims = {
    version: 1,
    action: "preview-build",
    jobId,
    buildId,
    builderProfile: "vite-react-static-v1",
    builderImageDigest,
    projectId,
    proposalId,
    operationId,
    proposalRevision: 3,
    candidateRevision,
    changeSetHash,
    sourceRoot: "client",
    sourceDigest,
    inputArtifactKey: `build-inputs/${bindingDigest}/${archiveDigest}.zip`,
    archiveDigest,
    outputArtifactKey: `preview-build-outputs/${buildId}/site.tar.gz`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  } as const;
  return {
    claims,
    token: signPreviewBuildJob({ claims, privateKeyPem, now }),
  };
}

function attestorTaskDefinition(
  overrides: Partial<PreviewTaskDefinition> = {},
): PreviewTaskDefinition {
  return {
    taskDefinitionArn: attestorTaskDefinitionArn,
    taskRoleArn: attestorTaskRoleArn,
    executionRoleArn: attestorExecutionRoleArn,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "256",
    memory: "512",
    runtimePlatform: {
      operatingSystemFamily: "LINUX",
      cpuArchitecture: "X86_64",
    },
    volumes: [],
    containerDefinitions: [
      {
        name: "attestor",
        image: `${attestorRepository}@${attestorImageDigest}`,
        essential: true,
        user: "10001:10001",
        readonlyRootFilesystem: true,
        privileged: false,
        linuxParameters: { capabilities: { add: [], drop: ["ALL"] } },
        environment: [
          { name: "AWS_REGION", value: region },
          { name: "PREVIEW_S3_BUCKET", value: bucket },
          { name: "PREVIEW_ECS_CLUSTER_ARN", value: clusterArn },
          {
            name: "PREVIEW_BUILDER_TASK_DEFINITION_ARN",
            value: builderTaskDefinitionArn,
          },
          {
            name: "PREVIEW_BUILDER_ECR_REPOSITORY_URI",
            value: builderRepository,
          },
          {
            name: "PREVIEW_BUILDER_IMAGE_DIGEST",
            value: builderImageDigest,
          },
          {
            name: "PREVIEW_BUILDER_EXECUTION_ROLE_ARN",
            value: builderExecutionRoleArn,
          },
          {
            name: "PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM",
            value: publicKeyPem,
          },
        ],
        secrets: [
          {
            name: "PREVIEW_BUILD_RECEIPT_PRIVATE_KEY_PEM",
            valueFrom: receiptSigningSecretArn,
          },
        ],
        environmentFiles: [],
        mountPoints: [],
        portMappings: [],
      },
    ],
    ...overrides,
  };
}

class MemoryFence implements PreviewBuildAttestorFence {
  calls: Array<Parameters<PreviewBuildAttestorFence["claimOrResume"]>[0]> = [];
  async claimOrResume(
    input: Parameters<PreviewBuildAttestorFence["claimOrResume"]>[0],
  ) {
    this.calls.push(input);
    return true;
  }
}

class MemoryEnvelope implements PreviewBuildAttestorEnvelopeStore {
  calls: Array<Parameters<PreviewBuildAttestorEnvelopeStore["put"]>[0]> = [];
  async put(input: Parameters<PreviewBuildAttestorEnvelopeStore["put"]>[0]) {
    this.calls.push(input);
    return {
      value: `arn:aws:s3:::${bucket}/attestor-command-envelopes/${input.jobId}.env`,
    };
  }
}

class FakeEcs implements PreviewEcsClient {
  definition = attestorTaskDefinition();
  launchRequests: Parameters<PreviewEcsClient["runTask"]>[0][] = [];
  existingAttestorTask: PreviewEcsTask | null = null;
  async describeTaskDefinition() {
    return this.definition;
  }
  async describeTask(input: { taskArn: string }) {
    if (input.taskArn === builderTaskArn) {
      return {
        taskArn: builderTaskArn,
        clusterArn,
        startedBy: jobId,
        taskDefinitionArn: builderTaskDefinitionArn,
        lastStatus: "STOPPED",
        containers: [
          {
            name: "builder",
            exitCode: 0,
            imageDigest: builderImageDigest,
          },
        ],
      };
    }
    if (input.taskArn === attestorTaskArn) return this.existingAttestorTask;
    return null;
  }
  async runTask(input: Parameters<PreviewEcsClient["runTask"]>[0]) {
    this.launchRequests.push(input);
    return {
      tasks: [
        {
          taskArn: attestorTaskArn,
          clusterArn,
          startedBy: input.startedBy,
          taskDefinitionArn: attestorTaskDefinitionArn,
          lastStatus: "PROVISIONING",
          containers: [{ name: "attestor", imageDigest: attestorImageDigest }],
        },
      ],
    };
  }
  async listTasks(input: { startedBy: string }) {
    return input.startedBy === previewBuildAttestorStartedBy(jobId) &&
      this.existingAttestorTask
      ? [attestorTaskArn]
      : [];
  }
  async stopTask() {}
}

function deps() {
  return {
    ecs: new FakeEcs(),
    fence: new MemoryFence(),
    envelopeStore: new MemoryEnvelope(),
  };
}

describe("Preview Build Attestor ECS runner", () => {
  it("launches one isolated, digest-pinned task with a distinct startedBy", async () => {
    const { token } = signedJob();
    const dependencies = deps();
    const result = await executePreviewBuildAttestorJob({
      token,
      builderTaskArn,
      ...dependencies,
      config,
      now,
    });
    expect(result).toMatchObject({
      jobId,
      buildId,
      taskArn: attestorTaskArn,
      state: "pending",
    });
    expect(dependencies.fence.calls).toHaveLength(1);
    expect(dependencies.envelopeStore.calls[0]?.values).toEqual({
      token,
      builderTaskArn,
    });
    const launch = dependencies.ecs.launchRequests[0]!;
    expect(launch.startedBy).toBe(previewBuildAttestorStartedBy(jobId));
    expect(launch.startedBy).not.toBe(jobId);
    expect(launch.clientToken).toMatch(/^[a-f0-9]{64}$/u);
    expect(launch.networkConfiguration.awsvpcConfiguration).toEqual({
      subnets: config.privateSubnetIds,
      securityGroups: [config.securityGroupId],
      assignPublicIp: "DISABLED",
    });
    expect(launch.overrides.containerOverrides[0]?.environmentFiles).toEqual([
      {
        value: `arn:aws:s3:::${bucket}/attestor-command-envelopes/${jobId}.env`,
        type: "s3",
      },
    ]);
  });

  it("reuses the one existing Attestor task rather than launching a second", async () => {
    const { token } = signedJob();
    const dependencies = deps();
    dependencies.ecs.existingAttestorTask = {
      taskArn: attestorTaskArn,
      clusterArn,
      startedBy: previewBuildAttestorStartedBy(jobId),
      taskDefinitionArn: attestorTaskDefinitionArn,
      lastStatus: "RUNNING",
      containers: [{ name: "attestor", imageDigest: attestorImageDigest }],
    };
    const result = await executePreviewBuildAttestorJob({
      token,
      builderTaskArn,
      ...dependencies,
      config,
      now,
    });
    expect(result.state).toBe("pending");
    expect(dependencies.ecs.launchRequests).toHaveLength(0);
  });

  it("rejects a Builder task that is not the exact successful stopped task", async () => {
    const { token } = signedJob();
    const dependencies = deps();
    dependencies.ecs.describeTask = async () => ({
      taskArn: builderTaskArn,
      clusterArn,
      startedBy: jobId,
      taskDefinitionArn: builderTaskDefinitionArn,
      lastStatus: "RUNNING",
      containers: [
        { name: "builder", exitCode: 0, imageDigest: builderImageDigest },
      ],
    });
    await expect(
      executePreviewBuildAttestorJob({
        token,
        builderTaskArn,
        ...dependencies,
        config,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_ATTESTOR_BUILDER_TASK_REJECTED",
    });
    expect(dependencies.ecs.launchRequests).toHaveLength(0);
    expect(dependencies.fence.calls).toHaveLength(0);
  });

  it("rejects task definitions with an unexpected receipt secret", async () => {
    const { token } = signedJob();
    const dependencies = deps();
    dependencies.ecs.definition = attestorTaskDefinition({
      containerDefinitions: [
        {
          ...attestorTaskDefinition().containerDefinitions?.[0],
          secrets: [
            {
              name: "PREVIEW_BUILD_RECEIPT_PRIVATE_KEY_PEM",
              valueFrom: `${receiptSigningSecretArn}:other`,
            },
          ],
        },
      ],
    });
    await expect(
      executePreviewBuildAttestorJob({
        token,
        builderTaskArn,
        ...dependencies,
        config,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_ATTESTOR_TASK_DEFINITION_REJECTED",
    });
    expect(dependencies.ecs.launchRequests).toHaveLength(0);
  });

  it("rejects an Attestor task definition for a different architecture", async () => {
    const { token } = signedJob();
    const dependencies = deps();
    dependencies.ecs.definition = attestorTaskDefinition({
      runtimePlatform: {
        operatingSystemFamily: "LINUX",
        cpuArchitecture: "ARM64",
      },
    });
    await expect(
      executePreviewBuildAttestorJob({
        token,
        builderTaskArn,
        ...dependencies,
        config,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_ATTESTOR_TASK_DEFINITION_REJECTED",
    });
    expect(dependencies.ecs.launchRequests).toHaveLength(0);
  });

  it("uses the same fixed task identity for retries", () => {
    const expected = `att-${createHash("sha256")
      .update("EngineeringOS Preview Attestor Task v1\n")
      .update(jobId)
      .digest("hex")
      .slice(0, 32)}`;
    expect(previewBuildAttestorStartedBy(jobId)).toBe(expected);
  });
});
