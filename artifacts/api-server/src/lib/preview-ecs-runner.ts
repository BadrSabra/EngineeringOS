import {
  previewControlCommandFingerprint,
  verifyPreviewControlCommand,
  type PreviewControlCommand,
} from "./preview-control-command.js";
import type { PreviewBuildOutputUrlProvider } from "./preview-build-output-s3.js";

const TASK_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;
const TASK_DEFINITION_PREFIX_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task-definition\/[A-Za-z0-9_-]+:$/i;
const CLUSTER_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:cluster\/[A-Za-z0-9_-]+$/i;
const SUBNET_ID_PATTERN = /^subnet-[a-f0-9]{8,17}$/i;
const SECURITY_GROUP_ID_PATTERN = /^sg-[a-f0-9]{8,17}$/i;

export class PreviewEcsRunnerError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_ECS_CONFIG_INVALID"
      | "PREVIEW_ECS_TASK_DEFINITION_REJECTED"
      | "PREVIEW_ECS_LAUNCH_REJECTED"
      | "PREVIEW_ECS_TASK_IDENTITY_MISMATCH"
      | "PREVIEW_ECS_COMMAND_STALE",
  ) {
    super("Preview ECS operation was rejected.");
    this.name = "PreviewEcsRunnerError";
  }
}

export type PreviewTaskDefinition = {
  taskDefinitionArn: string;
  taskRoleArn?: string | null;
  executionRoleArn?: string | null;
  networkMode?: string;
  requiresCompatibilities?: string[];
  cpu?: string;
  memory?: string;
  runtimePlatform?: {
    operatingSystemFamily?: string;
    cpuArchitecture?: string;
  };
  volumes?: Array<unknown>;
  containerDefinitions?: Array<{
    name?: string;
    image?: string;
    essential?: boolean;
    user?: string;
    readonlyRootFilesystem?: boolean;
    privileged?: boolean;
    linuxParameters?: { capabilities?: { add?: string[]; drop?: string[] } };
    command?: string[];
    entryPoint?: string[];
    environment?: Array<{ name?: string; value?: string }>;
    secrets?: Array<{ name?: string; valueFrom?: string }>;
    environmentFiles?: Array<{ value?: string; type?: string }>;
    mountPoints?: Array<unknown>;
    portMappings?: Array<{
      containerPort?: number;
      hostPort?: number;
      protocol?: string;
    }>;
  }>;
};

export type PreviewEcsTask = {
  taskArn?: string;
  clusterArn?: string;
  startedBy?: string;
  taskDefinitionArn?: string;
  lastStatus?: string;
  containers?: Array<{
    name?: string;
    exitCode?: number;
    imageDigest?: string;
  }>;
};

export type PreviewEcsClient = {
  describeTaskDefinition(
    taskDefinitionArn: string,
  ): Promise<PreviewTaskDefinition | null>;
  runTask(input: {
    cluster: string;
    taskDefinition: string;
    overrides: {
      containerOverrides: Array<{
        name: string;
        environment?: Array<{ name: string; value: string }>;
        environmentFiles?: Array<{ value: string; type: "s3" }>;
      }>;
    };
    clientToken: string;
    startedBy: string;
    count: 1;
    launchType: "FARGATE";
    platformVersion: "1.4.0";
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: string[];
        securityGroups: string[];
        assignPublicIp: "DISABLED";
      };
    };
    tags: Array<{ key: string; value: string }>;
  }): Promise<{ tasks?: PreviewEcsTask[]; failures?: Array<unknown> }>;
  describeTask(input: {
    cluster: string;
    taskArn: string;
  }): Promise<PreviewEcsTask | null>;
  stopTask(input: {
    cluster: string;
    taskArn: string;
    reason: string;
  }): Promise<void>;
  listTasks(input: {
    cluster: string;
    startedBy: string;
    desiredStatus: "PENDING" | "RUNNING" | "STOPPED";
  }): Promise<string[]>;
};

export type PreviewCommandFence = {
  claim(input: {
    command: PreviewControlCommand;
    fingerprint: string;
    expiresAtEpoch: number;
  }): Promise<boolean>;
  isCurrent(input: {
    sessionId: string;
    stateVersion: number;
  }): Promise<boolean>;
};

export type PreviewEcsRunnerConfig = {
  clusterArn: string;
  taskDefinitionArnPrefix: string;
  ecrRepositoryUri: string;
  executionRoleArn: string;
  privateSubnetIds: string[];
  runnerSecurityGroupId: string;
};

export type PreviewEcsCommandResult =
  | { action: "start"; taskArn: string; taskDefinitionArn: string }
  | { action: "stop"; taskArn?: string; stopped: boolean };

export function assertPreviewEcsRunnerConfig(
  config: PreviewEcsRunnerConfig,
): void {
  if (
    !CLUSTER_ARN_PATTERN.test(config.clusterArn) ||
    !TASK_DEFINITION_PREFIX_PATTERN.test(config.taskDefinitionArnPrefix) ||
    !/^arn:(aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/i.test(
      config.executionRoleArn,
    ) ||
    !/^([0-9]{12})\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9/_-]+$/i.test(
      config.ecrRepositoryUri,
    ) ||
    !Array.isArray(config.privateSubnetIds) ||
    config.privateSubnetIds.length < 1 ||
    config.privateSubnetIds.length > 4 ||
    !config.privateSubnetIds.every((subnet) =>
      SUBNET_ID_PATTERN.test(subnet),
    ) ||
    !SECURITY_GROUP_ID_PATTERN.test(config.runnerSecurityGroupId)
  ) {
    throw new PreviewEcsRunnerError("PREVIEW_ECS_CONFIG_INVALID");
  }
}

function validateTaskDefinition(
  taskDefinition: PreviewTaskDefinition | null,
  command: Extract<PreviewControlCommand, { action: "start" }>,
  config: PreviewEcsRunnerConfig,
): void {
  const container = taskDefinition?.containerDefinitions?.[0];
  const taskDefinitionArn = command.taskDefinitionArn;
  const expectedImage = `${config.ecrRepositoryUri}@${command.imageDigest}`;
  const uid = container?.user?.split(":")[0];
  const numericUid = uid ? Number(uid) : Number.NaN;

  if (
    !taskDefinition ||
    taskDefinition.taskDefinitionArn !== taskDefinitionArn ||
    !taskDefinitionArn.startsWith(config.taskDefinitionArnPrefix) ||
    taskDefinition.taskRoleArn ||
    taskDefinition.executionRoleArn !== config.executionRoleArn ||
    taskDefinition.networkMode !== "awsvpc" ||
    !taskDefinition.requiresCompatibilities?.includes("FARGATE") ||
    taskDefinition.cpu !== "256" ||
    taskDefinition.memory !== "512" ||
    (taskDefinition.volumes?.length ?? 0) > 0 ||
    taskDefinition.containerDefinitions?.length !== 1 ||
    container?.name !== "preview" ||
    container.image !== expectedImage ||
    container.essential !== true ||
    !Number.isInteger(numericUid) ||
    numericUid <= 0 ||
    container.readonlyRootFilesystem !== true ||
    container.privileged === true ||
    !container.linuxParameters?.capabilities?.drop?.includes("ALL") ||
    (container.command?.length ?? 0) > 0 ||
    (container.entryPoint?.length ?? 0) > 0 ||
    (container.environment?.length ?? 0) > 0 ||
    (container.secrets?.length ?? 0) > 0 ||
    (container.mountPoints?.length ?? 0) > 0 ||
    container.portMappings?.length !== 1 ||
    container.portMappings[0]?.containerPort !== 8080 ||
    container.portMappings[0]?.hostPort !== 8080 ||
    (container.portMappings[0]?.protocol ?? "tcp") !== "tcp"
  ) {
    throw new PreviewEcsRunnerError("PREVIEW_ECS_TASK_DEFINITION_REJECTED");
  }
}

function validateTaskIdentity(
  task: PreviewEcsTask | undefined,
  config: PreviewEcsRunnerConfig,
  sessionId: string,
  taskDefinitionArn: string,
): string {
  if (
    !task?.taskArn ||
    !TASK_ARN_PATTERN.test(task.taskArn) ||
    task.clusterArn !== config.clusterArn ||
    task.startedBy !== sessionId ||
    task.taskDefinitionArn !== taskDefinitionArn
  ) {
    throw new PreviewEcsRunnerError("PREVIEW_ECS_TASK_IDENTITY_MISMATCH");
  }
  return task.taskArn;
}

async function startPreviewTask(
  command: Extract<PreviewControlCommand, { action: "start" }>,
  outputArtifactUrl: string,
  ecs: PreviewEcsClient,
  config: PreviewEcsRunnerConfig,
): Promise<Extract<PreviewEcsCommandResult, { action: "start" }>> {
  const taskDefinition = await ecs.describeTaskDefinition(
    command.taskDefinitionArn,
  );
  validateTaskDefinition(taskDefinition, command, config);

  const response = await ecs.runTask({
    cluster: config.clusterArn,
    taskDefinition: command.taskDefinitionArn,
    overrides: {
      containerOverrides: [
        {
          name: "preview",
          environment: [
            {
              name: "PREVIEW_BUILD_OUTPUT_KEY",
              value: command.outputArtifactKey,
            },
            {
              name: "PREVIEW_BUILD_OUTPUT_SHA256",
              value: command.outputArtifactDigest,
            },
            {
              name: "PREVIEW_BUILD_OUTPUT_URL",
              value: outputArtifactUrl,
            },
          ],
        },
      ],
    },
    clientToken: command.sessionId,
    startedBy: command.sessionId,
    count: 1,
    launchType: "FARGATE",
    platformVersion: "1.4.0",
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: [...config.privateSubnetIds],
        securityGroups: [config.runnerSecurityGroupId],
        assignPublicIp: "DISABLED",
      },
    },
    tags: [
      { key: "EngineeringOSPreviewSession", value: command.sessionId },
      { key: "Product", value: "EngineeringOSPreview" },
    ],
  });
  if (response.failures?.length || response.tasks?.length !== 1) {
    throw new PreviewEcsRunnerError("PREVIEW_ECS_LAUNCH_REJECTED");
  }

  const taskArn = validateTaskIdentity(
    response.tasks[0],
    config,
    command.sessionId,
    command.taskDefinitionArn,
  );
  if (response.tasks?.[0]?.lastStatus === "STOPPED") {
    throw new PreviewEcsRunnerError("PREVIEW_ECS_LAUNCH_REJECTED");
  }
  return {
    action: "start",
    taskArn,
    taskDefinitionArn: command.taskDefinitionArn,
  };
}

async function stopPreviewTask(
  command: Extract<PreviewControlCommand, { action: "stop" }>,
  ecs: PreviewEcsClient,
  config: PreviewEcsRunnerConfig,
): Promise<PreviewEcsCommandResult> {
  if (!command.taskDefinitionArn.startsWith(config.taskDefinitionArnPrefix)) {
    throw new PreviewEcsRunnerError("PREVIEW_ECS_TASK_IDENTITY_MISMATCH");
  }

  const taskArns = command.taskArn
    ? [command.taskArn]
    : [
        ...new Set([
          ...(await ecs.listTasks({
            cluster: config.clusterArn,
            startedBy: command.sessionId,
            desiredStatus: "PENDING",
          })),
          ...(await ecs.listTasks({
            cluster: config.clusterArn,
            startedBy: command.sessionId,
            desiredStatus: "RUNNING",
          })),
        ]),
      ];
  let stopped = false;
  const confirmedTaskArns: string[] = [];
  for (const taskArn of taskArns) {
    if (!TASK_ARN_PATTERN.test(taskArn)) {
      throw new PreviewEcsRunnerError("PREVIEW_ECS_TASK_IDENTITY_MISMATCH");
    }
    const task = await ecs.describeTask({
      cluster: config.clusterArn,
      taskArn,
    });
    if (!task) continue;
    validateTaskIdentity(
      task,
      config,
      command.sessionId,
      command.taskDefinitionArn,
    );
    confirmedTaskArns.push(taskArn);
    if (task.lastStatus === "STOPPED") continue;
    await ecs.stopTask({
      cluster: config.clusterArn,
      taskArn,
      reason: `Preview session ${command.sessionId} closed`,
    });
    stopped = true;
  }
  const responseTaskArn =
    command.taskArn ??
    (confirmedTaskArns.length === 1 ? confirmedTaskArns[0] : undefined);
  return {
    action: "stop",
    ...(responseTaskArn ? { taskArn: responseTaskArn } : {}),
    stopped,
  };
}

export async function executePreviewGatewayCommand(input: {
  token: string;
  publicKeyPem: string | undefined;
  ecs: PreviewEcsClient;
  buildOutputUrlProvider: PreviewBuildOutputUrlProvider;
  fence: PreviewCommandFence;
  config: PreviewEcsRunnerConfig;
  now?: Date;
}): Promise<PreviewEcsCommandResult> {
  assertPreviewEcsRunnerConfig(input.config);
  const command = verifyPreviewControlCommand(
    input.token,
    input.publicKeyPem,
    input.now,
  );
  const claimed = await input.fence.claim({
    command,
    fingerprint: previewControlCommandFingerprint(command),
    expiresAtEpoch: Math.floor(
      Date.parse(command.sessionExpiresAt) / 1_000 + 86_400,
    ),
  });
  if (!claimed) {
    throw new PreviewEcsRunnerError("PREVIEW_ECS_COMMAND_STALE");
  }

  if (command.action === "stop") {
    return stopPreviewTask(command, input.ecs, input.config);
  }

  const outputArtifactUrl =
    command.action === "start"
      ? await input.buildOutputUrlProvider.createDownloadUrl({
          objectKey: command.outputArtifactKey,
          sha256: command.outputArtifactDigest,
        })
      : undefined;
  if (!outputArtifactUrl) {
    throw new PreviewEcsRunnerError("PREVIEW_ECS_LAUNCH_REJECTED");
  }
  const result = await startPreviewTask(
    command,
    outputArtifactUrl,
    input.ecs,
    input.config,
  );
  const stillCurrent = await input.fence.isCurrent({
    sessionId: command.sessionId,
    stateVersion: command.stateVersion,
  });
  if (!stillCurrent) {
    await input.ecs.stopTask({
      cluster: input.config.clusterArn,
      taskArn: result.taskArn,
      reason: `Preview session ${command.sessionId} was superseded`,
    });
    throw new PreviewEcsRunnerError("PREVIEW_ECS_COMMAND_STALE");
  }
  return result;
}
