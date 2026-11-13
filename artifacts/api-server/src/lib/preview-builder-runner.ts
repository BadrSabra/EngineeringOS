import { createHash } from "node:crypto";
import {
  verifyPreviewBuildJob,
  type VerifiedPreviewBuildJobClaims,
} from "./preview-build-job.js";
import {
  type PreviewEcsClient,
  type PreviewTaskDefinition,
} from "./preview-ecs-runner.js";
import {
  previewBuildJobFenceExpiry,
  type PreviewBuildJobFence,
} from "./preview-build-job-fence.js";
import type { PreviewBuildTransferProvider } from "./preview-build-transfer-s3.js";
import type { PreviewBuildJobEnvelopeStore } from "./preview-build-job-envelope.js";

const TASK_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;
const CLUSTER_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:cluster\/[A-Za-z0-9_-]+$/i;
const TASK_DEFINITION_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task-definition\/[A-Za-z0-9_-]+:\d+$/i;
const SUBNET_ID_PATTERN = /^subnet-[a-f0-9]{8,17}$/i;
const SECURITY_GROUP_ID_PATTERN = /^sg-[a-f0-9]{8,17}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const BUILDER_TEMP_VOLUME = "builder-tmp";

export class PreviewBuilderRunnerError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILDER_CONFIG_INVALID"
      | "PREVIEW_BUILDER_JOB_REJECTED"
      | "PREVIEW_BUILDER_TASK_DEFINITION_REJECTED"
      | "PREVIEW_BUILDER_JOB_REPLAYED"
      | "PREVIEW_BUILDER_LAUNCH_REJECTED",
  ) {
    super("Preview Builder operation was rejected.");
    this.name = "PreviewBuilderRunnerError";
  }
}

export type PreviewBuilderRunnerConfig = {
  clusterArn: string;
  taskDefinitionArn: string;
  ecrRepositoryUri: string;
  imageDigest: string;
  executionRoleArn: string;
  buildInputBucketName: string;
  region: string;
  publicKeyPem: string;
  privateSubnetIds: string[];
  securityGroupId: string;
};

export type PreviewBuilderJobRequest = {
  token: string;
};

export function assertPreviewBuilderRunnerConfig(
  config: PreviewBuilderRunnerConfig,
): void {
  if (
    !CLUSTER_ARN_PATTERN.test(config.clusterArn) ||
    !TASK_DEFINITION_ARN_PATTERN.test(config.taskDefinitionArn) ||
    !/^([0-9]{12})\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9/_-]+$/i.test(
      config.ecrRepositoryUri,
    ) ||
    !IMAGE_DIGEST_PATTERN.test(config.imageDigest) ||
    !/^arn:(aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/i.test(
      config.executionRoleArn,
    ) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.buildInputBucketName) ||
    config.buildInputBucketName.includes("..") ||
    !/^[a-z0-9-]+$/i.test(config.region) ||
    !config.publicKeyPem.includes("-----BEGIN") ||
    config.publicKeyPem.length > 16_384 ||
    config.privateSubnetIds.length < 1 ||
    config.privateSubnetIds.length > 4 ||
    !config.privateSubnetIds.every((subnet) =>
      SUBNET_ID_PATTERN.test(subnet),
    ) ||
    new Set(config.privateSubnetIds).size !== config.privateSubnetIds.length ||
    !SECURITY_GROUP_ID_PATTERN.test(config.securityGroupId)
  ) {
    throw new PreviewBuilderRunnerError("PREVIEW_BUILDER_CONFIG_INVALID");
  }
}

function validateTaskDefinition(
  definition: PreviewTaskDefinition | null,
  config: PreviewBuilderRunnerConfig,
): void {
  const container = definition?.containerDefinitions?.[0];
  const env = new Map(
    (container?.environment ?? []).map(({ name, value }) => [name, value]),
  );
  const expectedEnvironment = new Map([
    ["AWS_REGION", config.region],
    ["PREVIEW_S3_BUCKET", config.buildInputBucketName],
    [
      "PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM",
      config.publicKeyPem.replace(/\\n/g, "\n").trim(),
    ],
  ]);
  const uid = container?.user?.split(":")[0];
  const numericUid = uid ? Number(uid) : Number.NaN;
  const volumes = definition?.volumes ?? [];
  const mounts = container?.mountPoints ?? [];
  const volume = volumes[0];
  const mount = mounts[0];
  const volumeRecord =
    volume && typeof volume === "object"
      ? (volume as Record<string, unknown>)
      : null;
  const mountRecord =
    mount && typeof mount === "object"
      ? (mount as Record<string, unknown>)
      : null;
  const hasBoundedScratchVolume =
    volumes.length === 1 &&
    mounts.length === 1 &&
    volumeRecord?.name === BUILDER_TEMP_VOLUME &&
    Object.entries(volumeRecord ?? {}).every(
      ([key, value]) =>
        key === "name" || (key === "configuredAtLaunch" && value === false),
    ) &&
    mountRecord?.sourceVolume === BUILDER_TEMP_VOLUME &&
    mountRecord.containerPath === "/tmp" &&
    mountRecord.readOnly !== true &&
    Object.keys(mountRecord).every((key) =>
      ["sourceVolume", "containerPath", "readOnly"].includes(key),
    );

  if (
    !definition ||
    definition.taskDefinitionArn !== config.taskDefinitionArn ||
    definition.taskRoleArn ||
    definition.executionRoleArn !== config.executionRoleArn ||
    definition.networkMode !== "awsvpc" ||
    !definition.requiresCompatibilities?.includes("FARGATE") ||
    definition.cpu !== "1024" ||
    definition.memory !== "2048" ||
    definition.runtimePlatform?.operatingSystemFamily !== "LINUX" ||
    definition.runtimePlatform.cpuArchitecture !== "X86_64" ||
    !hasBoundedScratchVolume ||
    definition.containerDefinitions?.length !== 1 ||
    container?.name !== "builder" ||
    container.image !== `${config.ecrRepositoryUri}@${config.imageDigest}` ||
    container.essential !== true ||
    !Number.isInteger(numericUid) ||
    numericUid <= 0 ||
    container.readonlyRootFilesystem !== true ||
    container.privileged === true ||
    !container.linuxParameters?.capabilities?.drop?.includes("ALL") ||
    (container.command?.length ?? 0) > 0 ||
    (container.entryPoint?.length ?? 0) > 0 ||
    (container.secrets?.length ?? 0) > 0 ||
    (container.environmentFiles?.length ?? 0) > 0 ||
    (container.portMappings?.length ?? 0) > 0 ||
    env.size !== expectedEnvironment.size ||
    [...expectedEnvironment].some(([name, value]) => {
      const actual = env.get(name);
      return name === "PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM"
        ? actual?.replace(/\\n/g, "\n").trim() !== value
        : actual !== value;
    })
  ) {
    throw new PreviewBuilderRunnerError(
      "PREVIEW_BUILDER_TASK_DEFINITION_REJECTED",
    );
  }
}

function validateJobRequest(
  request: PreviewBuilderJobRequest,
  config: PreviewBuilderRunnerConfig,
  now: Date,
): VerifiedPreviewBuildJobClaims {
  let claims: VerifiedPreviewBuildJobClaims;
  try {
    claims = verifyPreviewBuildJob({
      token: request.token,
      publicKeyPem: config.publicKeyPem,
      now,
    });
  } catch {
    throw new PreviewBuilderRunnerError("PREVIEW_BUILDER_JOB_REJECTED");
  }
  if (claims.builderImageDigest !== config.imageDigest) {
    throw new PreviewBuilderRunnerError("PREVIEW_BUILDER_JOB_REJECTED");
  }
  return claims;
}

export async function executePreviewBuilderJob(input: {
  request: PreviewBuilderJobRequest;
  ecs: PreviewEcsClient;
  fence: PreviewBuildJobFence;
  transferProvider: PreviewBuildTransferProvider;
  envelopeStore: PreviewBuildJobEnvelopeStore;
  config: PreviewBuilderRunnerConfig;
  now?: Date;
}): Promise<{ jobId: string; buildId: string; taskArn: string }> {
  assertPreviewBuilderRunnerConfig(input.config);
  const claims = validateJobRequest(
    input.request,
    input.config,
    input.now ?? new Date(),
  );
  const definition = await input.ecs.describeTaskDefinition(
    input.config.taskDefinitionArn,
  );
  validateTaskDefinition(definition, input.config);
  const transfer = await input.transferProvider.createTransfer({
    inputObjectKey: claims.inputArtifactKey,
    inputArchiveDigest: claims.archiveDigest,
    buildId: claims.buildId,
  });
  if (transfer.outputArtifactKey !== claims.outputArtifactKey) {
    throw new PreviewBuilderRunnerError("PREVIEW_BUILDER_JOB_REJECTED");
  }
  const launchFingerprint = createHash("sha256")
    .update("EngineeringOS Preview Builder Launch v2\n")
    .update(
      JSON.stringify({
        token: input.request.token,
        clusterArn: input.config.clusterArn,
        taskDefinitionArn: input.config.taskDefinitionArn,
        ecrRepositoryUri: input.config.ecrRepositoryUri,
        imageDigest: input.config.imageDigest,
        executionRoleArn: input.config.executionRoleArn,
        buildInputBucketName: input.config.buildInputBucketName,
        region: input.config.region,
        privateSubnetIds: input.config.privateSubnetIds,
        securityGroupId: input.config.securityGroupId,
      }),
    )
    .digest("hex");
  const now = input.now ?? new Date();
  const resumable = await input.fence.claimOrResume({
    jobId: claims.jobId,
    fingerprint: launchFingerprint,
    nowEpoch: Math.floor(now.getTime() / 1_000),
    expiresAtEpoch: previewBuildJobFenceExpiry(claims),
  });
  if (!resumable) {
    throw new PreviewBuilderRunnerError("PREVIEW_BUILDER_JOB_REPLAYED");
  }
  const envelope = await input.envelopeStore.put({
    jobId: claims.jobId,
    fingerprint: launchFingerprint,
    values: {
      token: input.request.token,
      inputDownloadUrl: transfer.inputDownloadUrl,
      outputUploadUrl: transfer.outputUploadUrl,
    },
  });

  const response = await input.ecs.runTask({
    cluster: input.config.clusterArn,
    taskDefinition: input.config.taskDefinitionArn,
    overrides: {
      containerOverrides: [
        {
          name: "builder",
          environmentFiles: [{ value: envelope.value, type: "s3" }],
        },
      ],
    },
    clientToken: claims.jobId,
    startedBy: claims.jobId,
    count: 1,
    launchType: "FARGATE",
    platformVersion: "1.4.0",
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: [...input.config.privateSubnetIds],
        securityGroups: [input.config.securityGroupId],
        assignPublicIp: "DISABLED",
      },
    },
    tags: [
      { key: "EngineeringOSPreviewBuildJob", value: claims.jobId },
      { key: "Product", value: "EngineeringOSPreview" },
    ],
  });
  const task = response.tasks?.[0];
  if (
    response.failures?.length ||
    response.tasks?.length !== 1 ||
    !task?.taskArn ||
    !TASK_ARN_PATTERN.test(task.taskArn) ||
    task.clusterArn !== input.config.clusterArn ||
    task.startedBy !== claims.jobId ||
    task.taskDefinitionArn !== input.config.taskDefinitionArn ||
    task.lastStatus === "STOPPED"
  ) {
    throw new PreviewBuilderRunnerError("PREVIEW_BUILDER_LAUNCH_REJECTED");
  }
  return {
    jobId: claims.jobId,
    buildId: claims.buildId,
    taskArn: task.taskArn,
  };
}
