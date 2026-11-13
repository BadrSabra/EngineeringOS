import { createHash } from "node:crypto";
import {
  assertPreviewBuildJobPublicKeyPem,
  verifyPreviewBuildJob,
  type VerifiedPreviewBuildJobClaims,
} from "./preview-build-job.js";
import { isPreviewBuildOutputArtifactKey } from "./preview-build-output-key.js";
import {
  assertPreviewBuilderRunnerConfig,
  type PreviewBuilderRunnerConfig,
} from "./preview-builder-runner.js";
import type {
  PreviewEcsClient,
  PreviewEcsTask,
  PreviewTaskDefinition,
} from "./preview-ecs-runner.js";
import type { PreviewBuildAttestorFence } from "./preview-build-attestor-fence.js";
import type { PreviewBuildAttestorEnvelopeStore } from "./preview-build-attestor-envelope.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;
const TASK_DEFINITION_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task-definition\/[A-Za-z0-9_-]+:\d+$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const SUBNET_ID_PATTERN = /^subnet-[a-f0-9]{8,17}$/i;
const SECURITY_GROUP_ID_PATTERN = /^sg-[a-f0-9]{8,17}$/i;
const ROLE_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/i;
const SECRET_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/i;

export type PreviewBuildAttestorRunnerConfig = {
  region: string;
  bucketName: string;
  clusterArn: string;
  builderConfig: PreviewBuilderRunnerConfig;
  taskDefinitionArn: string;
  ecrRepositoryUri: string;
  imageDigest: string;
  executionRoleArn: string;
  taskRoleArn: string;
  receiptSigningSecretArn: string;
  privateSubnetIds: string[];
  securityGroupId: string;
};

export class PreviewBuildAttestorRunnerError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_ATTESTOR_CONFIG_INVALID"
      | "PREVIEW_BUILD_ATTESTOR_JOB_REJECTED"
      | "PREVIEW_BUILD_ATTESTOR_BUILDER_TASK_REJECTED"
      | "PREVIEW_BUILD_ATTESTOR_TASK_DEFINITION_REJECTED"
      | "PREVIEW_BUILD_ATTESTOR_REPLAYED"
      | "PREVIEW_BUILD_ATTESTOR_LAUNCH_REJECTED"
      | "PREVIEW_BUILD_ATTESTOR_TASK_IDENTITY_MISMATCH",
  ) {
    super("Preview Attestor launch was rejected or unavailable.");
    this.name = "PreviewBuildAttestorRunnerError";
  }
}

function reject(
  code: ConstructorParameters<typeof PreviewBuildAttestorRunnerError>[0],
): never {
  throw new PreviewBuildAttestorRunnerError(code);
}

export function previewBuildAttestorStartedBy(jobId: string): string {
  if (!UUID_PATTERN.test(jobId)) {
    reject("PREVIEW_BUILD_ATTESTOR_JOB_REJECTED");
  }
  const digest = createHash("sha256")
    .update("EngineeringOS Preview Attestor Task v1\n")
    .update(jobId.toLowerCase())
    .digest("hex");
  return `att-${digest.slice(0, 32)}`;
}

export function assertPreviewBuildAttestorRunnerConfig(
  config: PreviewBuildAttestorRunnerConfig,
): void {
  try {
    assertPreviewBuilderRunnerConfig(config.builderConfig);
    assertPreviewBuildJobPublicKeyPem(config.builderConfig.publicKeyPem);
  } catch {
    reject("PREVIEW_BUILD_ATTESTOR_CONFIG_INVALID");
  }
  if (
    !/^[a-z0-9-]+$/i.test(config.region) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucketName) ||
    config.bucketName.includes("..") ||
    config.bucketName !== config.builderConfig.buildInputBucketName ||
    config.clusterArn !== config.builderConfig.clusterArn ||
    !TASK_DEFINITION_ARN_PATTERN.test(config.taskDefinitionArn) ||
    !/^([0-9]{12})\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9/_-]+$/i.test(
      config.ecrRepositoryUri,
    ) ||
    !IMAGE_DIGEST_PATTERN.test(config.imageDigest) ||
    !ROLE_ARN_PATTERN.test(config.executionRoleArn) ||
    !ROLE_ARN_PATTERN.test(config.taskRoleArn) ||
    !SECRET_ARN_PATTERN.test(config.receiptSigningSecretArn) ||
    config.privateSubnetIds.length < 1 ||
    config.privateSubnetIds.length > 4 ||
    !config.privateSubnetIds.every((subnet) =>
      SUBNET_ID_PATTERN.test(subnet),
    ) ||
    new Set(config.privateSubnetIds).size !== config.privateSubnetIds.length ||
    !SECURITY_GROUP_ID_PATTERN.test(config.securityGroupId)
  ) {
    reject("PREVIEW_BUILD_ATTESTOR_CONFIG_INVALID");
  }
}

function validateBuildJob(
  token: string,
  builderTaskArn: string,
  config: PreviewBuildAttestorRunnerConfig,
  now: Date,
): VerifiedPreviewBuildJobClaims {
  if (!TASK_ARN_PATTERN.test(builderTaskArn)) {
    reject("PREVIEW_BUILD_ATTESTOR_JOB_REJECTED");
  }
  let claims: VerifiedPreviewBuildJobClaims;
  try {
    claims = verifyPreviewBuildJob({
      token,
      publicKeyPem: config.builderConfig.publicKeyPem,
      now,
    });
  } catch {
    reject("PREVIEW_BUILD_ATTESTOR_JOB_REJECTED");
  }
  if (
    claims.builderImageDigest !== config.builderConfig.imageDigest ||
    !isPreviewBuildOutputArtifactKey(claims.outputArtifactKey, {
      buildId: claims.buildId,
      dispatchGeneration: claims.version === 2 ? claims.dispatchGeneration : 1,
    })
  ) {
    reject("PREVIEW_BUILD_ATTESTOR_JOB_REJECTED");
  }
  return claims;
}

function validateBuilderTask(
  task: PreviewEcsTask | null,
  builderTaskArn: string,
  claims: VerifiedPreviewBuildJobClaims,
  config: PreviewBuildAttestorRunnerConfig,
): void {
  const containers = task?.containers ?? [];
  if (
    !task ||
    task.taskArn !== builderTaskArn ||
    task.clusterArn !== config.clusterArn ||
    task.startedBy !== claims.jobId ||
    task.taskDefinitionArn !== config.builderConfig.taskDefinitionArn ||
    task.lastStatus !== "STOPPED" ||
    containers.length !== 1 ||
    containers[0]?.name !== "builder" ||
    containers[0].exitCode !== 0 ||
    containers[0].imageDigest !== claims.builderImageDigest
  ) {
    reject("PREVIEW_BUILD_ATTESTOR_BUILDER_TASK_REJECTED");
  }
}

function expectedAttestorEnvironment(
  config: PreviewBuildAttestorRunnerConfig,
): Map<string, string> {
  return new Map([
    ["AWS_REGION", config.region],
    ["PREVIEW_S3_BUCKET", config.bucketName],
    ["PREVIEW_ECS_CLUSTER_ARN", config.clusterArn],
    [
      "PREVIEW_BUILDER_TASK_DEFINITION_ARN",
      config.builderConfig.taskDefinitionArn,
    ],
    [
      "PREVIEW_BUILDER_ECR_REPOSITORY_URI",
      config.builderConfig.ecrRepositoryUri,
    ],
    ["PREVIEW_BUILDER_IMAGE_DIGEST", config.builderConfig.imageDigest],
    [
      "PREVIEW_BUILDER_EXECUTION_ROLE_ARN",
      config.builderConfig.executionRoleArn,
    ],
    [
      "PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM",
      config.builderConfig.publicKeyPem.replace(/\\n/g, "\n").trim(),
    ],
  ]);
}

function validateAttestorTaskDefinition(
  definition: PreviewTaskDefinition | null,
  config: PreviewBuildAttestorRunnerConfig,
): void {
  const container = definition?.containerDefinitions?.[0];
  const uid = container?.user?.split(":")[0];
  const environment = new Map(
    (container?.environment ?? []).map(({ name, value }) => [name, value]),
  );
  const expected = expectedAttestorEnvironment(config);
  const secrets = container?.secrets ?? [];
  if (
    !definition ||
    definition.taskDefinitionArn !== config.taskDefinitionArn ||
    definition.taskRoleArn !== config.taskRoleArn ||
    definition.executionRoleArn !== config.executionRoleArn ||
    definition.networkMode !== "awsvpc" ||
    !definition.requiresCompatibilities?.includes("FARGATE") ||
    definition.cpu !== "256" ||
    definition.memory !== "512" ||
    definition.runtimePlatform?.operatingSystemFamily !== "LINUX" ||
    definition.runtimePlatform.cpuArchitecture !== "X86_64" ||
    (definition.volumes?.length ?? 0) !== 0 ||
    definition.containerDefinitions?.length !== 1 ||
    container?.name !== "attestor" ||
    container.image !== `${config.ecrRepositoryUri}@${config.imageDigest}` ||
    container.essential !== true ||
    !uid ||
    !/^[0-9]+$/.test(uid) ||
    Number(uid) <= 0 ||
    container.readonlyRootFilesystem !== true ||
    container.privileged === true ||
    !container.linuxParameters?.capabilities?.drop?.includes("ALL") ||
    (container.linuxParameters?.capabilities?.add?.length ?? 0) !== 0 ||
    (container.command?.length ?? 0) !== 0 ||
    (container.entryPoint?.length ?? 0) !== 0 ||
    (container.environmentFiles?.length ?? 0) !== 0 ||
    (container.mountPoints?.length ?? 0) !== 0 ||
    (container.portMappings?.length ?? 0) !== 0 ||
    environment.size !== expected.size ||
    [...expected].some(
      ([name, value]) =>
        environment.get(name)?.replace(/\\n/g, "\n").trim() !== value,
    ) ||
    secrets.length !== 1 ||
    secrets[0]?.name !== "PREVIEW_BUILD_RECEIPT_PRIVATE_KEY_PEM" ||
    secrets[0]?.valueFrom !== config.receiptSigningSecretArn
  ) {
    reject("PREVIEW_BUILD_ATTESTOR_TASK_DEFINITION_REJECTED");
  }
}

function launchFingerprint(input: {
  claims: VerifiedPreviewBuildJobClaims;
  builderTaskArn: string;
  config: PreviewBuildAttestorRunnerConfig;
}): string {
  return createHash("sha256")
    .update("EngineeringOS Preview Attestor Launch v1\n")
    .update(
      JSON.stringify({
        jobId: input.claims.jobId,
        buildId: input.claims.buildId,
        builderProfile: input.claims.builderProfile,
        builderImageDigest: input.claims.builderImageDigest,
        projectId: input.claims.projectId,
        proposalId: input.claims.proposalId,
        operationId: input.claims.operationId,
        proposalRevision: input.claims.proposalRevision,
        candidateRevision: input.claims.candidateRevision,
        changeSetHash: input.claims.changeSetHash,
        sourceRoot: input.claims.sourceRoot,
        sourceDigest: input.claims.sourceDigest,
        inputArtifactKey: input.claims.inputArtifactKey,
        archiveDigest: input.claims.archiveDigest,
        outputArtifactKey: input.claims.outputArtifactKey,
        builderTaskArn: input.builderTaskArn,
        attestorTaskDefinitionArn: input.config.taskDefinitionArn,
        attestorImageDigest: input.config.imageDigest,
        receiptSigningSecretArn: input.config.receiptSigningSecretArn,
        privateSubnetIds: input.config.privateSubnetIds,
        securityGroupId: input.config.securityGroupId,
      }),
    )
    .digest("hex");
}

function validateAttestorTask(
  task: PreviewEcsTask | null,
  taskArn: string,
  claims: VerifiedPreviewBuildJobClaims,
  config: PreviewBuildAttestorRunnerConfig,
): "pending" | "completed" | "failed" {
  const containers = task?.containers ?? [];
  if (
    !task ||
    task.taskArn !== taskArn ||
    task.clusterArn !== config.clusterArn ||
    task.startedBy !== previewBuildAttestorStartedBy(claims.jobId) ||
    task.taskDefinitionArn !== config.taskDefinitionArn ||
    containers.length !== 1 ||
    containers[0]?.name !== "attestor" ||
    containers[0]?.imageDigest !== config.imageDigest
  ) {
    reject("PREVIEW_BUILD_ATTESTOR_TASK_IDENTITY_MISMATCH");
  }
  if (task.lastStatus !== "STOPPED") return "pending";
  return containers[0]?.exitCode === 0 ? "completed" : "failed";
}

async function findAttestorTask(input: {
  ecs: PreviewEcsClient;
  claims: VerifiedPreviewBuildJobClaims;
  config: PreviewBuildAttestorRunnerConfig;
}): Promise<PreviewEcsTask | null> {
  const startedBy = previewBuildAttestorStartedBy(input.claims.jobId);
  const taskArns = new Set<string>();
  for (const desiredStatus of ["PENDING", "RUNNING", "STOPPED"] as const) {
    const results = await input.ecs.listTasks({
      cluster: input.config.clusterArn,
      startedBy,
      desiredStatus,
    });
    for (const taskArn of results) {
      if (!TASK_ARN_PATTERN.test(taskArn)) {
        reject("PREVIEW_BUILD_ATTESTOR_TASK_IDENTITY_MISMATCH");
      }
      taskArns.add(taskArn);
      if (taskArns.size > 1) {
        reject("PREVIEW_BUILD_ATTESTOR_TASK_IDENTITY_MISMATCH");
      }
    }
  }
  const [taskArn] = taskArns;
  if (!taskArn) return null;
  return input.ecs.describeTask({
    cluster: input.config.clusterArn,
    taskArn,
  });
}

export async function executePreviewBuildAttestorJob(input: {
  token: string;
  builderTaskArn: string;
  ecs: PreviewEcsClient;
  fence: PreviewBuildAttestorFence;
  envelopeStore: PreviewBuildAttestorEnvelopeStore;
  config: PreviewBuildAttestorRunnerConfig;
  now?: Date;
}): Promise<{
  jobId: string;
  buildId: string;
  taskArn: string;
  state: "pending" | "completed" | "failed";
}> {
  assertPreviewBuildAttestorRunnerConfig(input.config);
  const now = input.now ?? new Date();
  const claims = validateBuildJob(
    input.token,
    input.builderTaskArn,
    input.config,
    now,
  );

  let builderTask: PreviewEcsTask | null;
  let attestorDefinition: PreviewTaskDefinition | null;
  try {
    [builderTask, attestorDefinition] = await Promise.all([
      input.ecs.describeTask({
        cluster: input.config.clusterArn,
        taskArn: input.builderTaskArn,
      }),
      input.ecs.describeTaskDefinition(input.config.taskDefinitionArn),
    ]);
  } catch {
    reject("PREVIEW_BUILD_ATTESTOR_LAUNCH_REJECTED");
  }
  validateBuilderTask(builderTask, input.builderTaskArn, claims, input.config);
  validateAttestorTaskDefinition(attestorDefinition, input.config);

  const fingerprint = launchFingerprint({
    claims,
    builderTaskArn: input.builderTaskArn,
    config: input.config,
  });
  const nowEpoch = Math.floor(now.getTime() / 1_000);
  const claimed = await input.fence.claimOrResume({
    jobId: claims.jobId,
    fingerprint,
    nowEpoch,
    expiresAtEpoch: nowEpoch + 86_400,
  });
  if (!claimed) reject("PREVIEW_BUILD_ATTESTOR_REPLAYED");

  const envelope = await input.envelopeStore.put({
    jobId: claims.jobId,
    fingerprint,
    values: {
      token: input.token,
      builderTaskArn: input.builderTaskArn,
    },
  });
  let existingTask: PreviewEcsTask | null;
  try {
    existingTask = await findAttestorTask({
      ecs: input.ecs,
      claims,
      config: input.config,
    });
  } catch (error) {
    if (error instanceof PreviewBuildAttestorRunnerError) throw error;
    reject("PREVIEW_BUILD_ATTESTOR_LAUNCH_REJECTED");
  }
  if (existingTask?.taskArn) {
    const state = validateAttestorTask(
      existingTask,
      existingTask.taskArn,
      claims,
      input.config,
    );
    return {
      jobId: claims.jobId,
      buildId: claims.buildId,
      taskArn: existingTask.taskArn,
      state,
    };
  }

  let response: { tasks?: PreviewEcsTask[]; failures?: Array<unknown> };
  try {
    response = await input.ecs.runTask({
      cluster: input.config.clusterArn,
      taskDefinition: input.config.taskDefinitionArn,
      overrides: {
        containerOverrides: [
          {
            name: "attestor",
            environmentFiles: [{ value: envelope.value, type: "s3" }],
          },
        ],
      },
      clientToken: fingerprint,
      startedBy: previewBuildAttestorStartedBy(claims.jobId),
      count: 1,
      launchType: "FARGATE",
      platformVersion: "1.4.0",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: input.config.privateSubnetIds,
          securityGroups: [input.config.securityGroupId],
          assignPublicIp: "DISABLED",
        },
      },
      tags: [
        { key: "Purpose", value: "preview-build-attestation" },
        { key: "PreviewJobId", value: claims.jobId },
        { key: "PreviewBuildId", value: claims.buildId },
      ],
    });
  } catch {
    reject("PREVIEW_BUILD_ATTESTOR_LAUNCH_REJECTED");
  }
  if (
    response.failures?.length ||
    response.tasks?.length !== 1 ||
    !response.tasks[0]?.taskArn
  ) {
    reject("PREVIEW_BUILD_ATTESTOR_LAUNCH_REJECTED");
  }
  const task = response.tasks[0];
  const state = validateAttestorTask(task, task.taskArn!, claims, input.config);
  return {
    jobId: claims.jobId,
    buildId: claims.buildId,
    taskArn: task.taskArn!,
    state,
  };
}
