import {
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
  RunTaskCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  type GetCommandInput,
  type PutCommandInput,
  type UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  PreviewEcsClient,
  PreviewEcsTask,
  PreviewTaskDefinition,
} from "./preview-ecs-runner.js";
import { createDynamoPreviewCommandFenceStorage } from "./preview-command-fence.js";
import {
  createS3PreviewBuildInputObjectStore,
  type PreviewS3CommandClient,
} from "./preview-build-input-s3.js";
import {
  createS3PreviewBuildOutputUrlProvider,
  type PreviewBuildOutputS3Client,
} from "./preview-build-output-s3.js";
import {
  createS3PreviewBuildTransferProvider,
  type PreviewBuildTransferS3Client,
} from "./preview-build-transfer-s3.js";
import { createDynamoPreviewBuildJobFenceStorage } from "./preview-build-job-fence.js";
import { createS3PreviewBuildJobEnvelopeStore } from "./preview-build-job-envelope.js";
import { createDynamoPreviewBuildAttestorFence } from "./preview-build-attestor-fence.js";
import { createS3PreviewBuildAttestorEnvelopeStore } from "./preview-build-attestor-envelope.js";
import { createS3PreviewBuildAttestorReceiptStore } from "./preview-build-attestor-receipt-store.js";

export type PreviewAwsCommandClient = {
  send(command: unknown): Promise<unknown>;
};

function sendCommand(
  client: PreviewAwsCommandClient,
  command: unknown,
): Promise<unknown> {
  return client.send(command as never);
}

function mapTaskDefinition(value: unknown): PreviewTaskDefinition | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.taskDefinitionArn !== "string") return null;
  const containerDefinitions = Array.isArray(record.containerDefinitions)
    ? record.containerDefinitions.map((value) => {
        const container = value as Record<string, unknown>;
        const linuxParameters =
          container.linuxParameters &&
          typeof container.linuxParameters === "object"
            ? (container.linuxParameters as Record<string, unknown>)
            : undefined;
        const capabilities =
          linuxParameters?.capabilities &&
          typeof linuxParameters.capabilities === "object"
            ? (linuxParameters.capabilities as Record<string, unknown>)
            : undefined;
        return {
          name: container.name as string | undefined,
          image: container.image as string | undefined,
          essential: container.essential as boolean | undefined,
          user: container.user as string | undefined,
          readonlyRootFilesystem: container.readonlyRootFilesystem as
            boolean | undefined,
          privileged: container.privileged as boolean | undefined,
          command: container.command as string[] | undefined,
          entryPoint: container.entryPoint as string[] | undefined,
          environment: container.environment as
            Array<{ name?: string; value?: string }> | undefined,
          secrets: container.secrets as
            Array<{ name?: string; valueFrom?: string }> | undefined,
          environmentFiles: container.environmentFiles as
            Array<{ value?: string; type?: string }> | undefined,
          mountPoints: container.mountPoints as Array<unknown> | undefined,
          portMappings: container.portMappings as
            | Array<{
                containerPort?: number;
                hostPort?: number;
                protocol?: string;
              }>
            | undefined,
          linuxParameters: capabilities
            ? {
                capabilities: {
                  add: capabilities.add as string[] | undefined,
                  drop: capabilities.drop as string[] | undefined,
                },
              }
            : undefined,
        };
      })
    : [];
  return {
    taskDefinitionArn: record.taskDefinitionArn,
    taskRoleArn: record.taskRoleArn as string | null | undefined,
    executionRoleArn: record.executionRoleArn as string | undefined,
    networkMode: record.networkMode as string | undefined,
    requiresCompatibilities: record.requiresCompatibilities as
      string[] | undefined,
    cpu: record.cpu as string | undefined,
    memory: record.memory as string | undefined,
    runtimePlatform: record.runtimePlatform as
      | {
          operatingSystemFamily?: string;
          cpuArchitecture?: string;
        }
      | undefined,
    volumes: record.volumes as Array<unknown> | undefined,
    containerDefinitions,
  };
}

function mapTask(value: unknown): PreviewEcsTask | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const containers = Array.isArray(record.containers)
    ? record.containers.map((containerValue) => {
        const container = containerValue as Record<string, unknown>;
        return {
          name: container.name as string | undefined,
          exitCode: container.exitCode as number | undefined,
          imageDigest: container.imageDigest as string | undefined,
        };
      })
    : undefined;
  return {
    taskArn: record.taskArn as string | undefined,
    clusterArn: record.clusterArn as string | undefined,
    startedBy: record.startedBy as string | undefined,
    taskDefinitionArn: record.taskDefinitionArn as string | undefined,
    lastStatus: record.lastStatus as string | undefined,
    ...(containers ? { containers } : {}),
  };
}

export function createPreviewEcsSdkClient(
  client: PreviewAwsCommandClient,
): PreviewEcsClient {
  const commandClient = client;
  return {
    async describeTaskDefinition(taskDefinitionArn) {
      const response = (await sendCommand(
        commandClient,
        new DescribeTaskDefinitionCommand({
          taskDefinition: taskDefinitionArn,
        }),
      )) as { taskDefinition?: unknown };
      return mapTaskDefinition(response.taskDefinition);
    },

    async runTask(input) {
      const response = (await sendCommand(
        commandClient,
        new RunTaskCommand({
          cluster: input.cluster,
          taskDefinition: input.taskDefinition,
          overrides: input.overrides,
          clientToken: input.clientToken,
          startedBy: input.startedBy,
          count: input.count,
          launchType: input.launchType,
          platformVersion: input.platformVersion,
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: input.networkConfiguration.awsvpcConfiguration.subnets,
              securityGroups:
                input.networkConfiguration.awsvpcConfiguration.securityGroups,
              assignPublicIp:
                input.networkConfiguration.awsvpcConfiguration.assignPublicIp,
            },
          },
          tags: input.tags,
        }),
      )) as {
        tasks?: unknown[];
        failures?: unknown[];
      };
      return {
        tasks: response.tasks
          ?.map(mapTask)
          .filter((task): task is PreviewEcsTask => task !== null),
        failures: response.failures,
      };
    },

    async describeTask(input) {
      const response = (await sendCommand(
        commandClient,
        new DescribeTasksCommand({
          cluster: input.cluster,
          tasks: [input.taskArn],
        }),
      )) as { tasks?: unknown[] };
      return mapTask(response.tasks?.[0]);
    },

    async stopTask(input) {
      await sendCommand(
        commandClient,
        new StopTaskCommand({
          cluster: input.cluster,
          task: input.taskArn,
          reason: input.reason,
        }),
      );
    },

    async listTasks(input) {
      const taskArns: string[] = [];
      let nextToken: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const response = (await sendCommand(
          commandClient,
          new ListTasksCommand({
            cluster: input.cluster,
            startedBy: input.startedBy,
            desiredStatus: input.desiredStatus,
            maxResults: 100,
            ...(nextToken ? { nextToken } : {}),
          }),
        )) as { taskArns?: string[]; nextToken?: string };
        taskArns.push(...(response.taskArns ?? []));
        nextToken = response.nextToken;
        if (!nextToken) return taskArns;
      }
      if (nextToken) {
        throw new Error("Preview task list exceeded its bounded page limit.");
      }
      return taskArns;
    },
  };
}

export function createPreviewCommandFenceSdkStorage(input: {
  client: DynamoDBDocumentClient;
  tableName: string;
}) {
  return createDynamoPreviewCommandFenceStorage({
    tableName: input.tableName,
    client: input.client as unknown as {
      send(command: unknown): Promise<unknown>;
    },
    commands: {
      update: (commandInput) =>
        new UpdateCommand(commandInput as UpdateCommandInput),
      get: (commandInput) => new GetCommand(commandInput as GetCommandInput),
    },
  });
}

export function createPreviewAwsClients(region: string) {
  if (!region.trim()) throw new Error("AWS region is not configured.");
  const ecs = new ECSClient({ region });
  const dynamoDocument = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region }),
    {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false,
      },
    },
  );
  const s3 = new S3Client({ region });
  return {
    ecs: createPreviewEcsSdkClient(ecs as unknown as PreviewAwsCommandClient),
    fenceStorage: (tableName: string) =>
      createPreviewCommandFenceSdkStorage({
        client: dynamoDocument,
        tableName,
      }),
    buildJobFenceStorage: (tableName: string) =>
      createDynamoPreviewBuildJobFenceStorage({
        client: dynamoDocument,
        tableName,
        commands: {
          put: (commandInput) =>
            new PutCommand(commandInput as PutCommandInput),
          get: (commandInput) =>
            new GetCommand(commandInput as GetCommandInput),
        },
      }),
    buildAttestorFenceStorage: (tableName: string) =>
      createDynamoPreviewBuildAttestorFence({
        client: dynamoDocument,
        tableName,
      }),
    buildInputObjectStore: (bucketName: string) =>
      createS3PreviewBuildInputObjectStore({
        client: s3 as unknown as PreviewS3CommandClient,
        bucketName,
      }),
    buildOutputUrlProvider: (bucketName: string) =>
      createS3PreviewBuildOutputUrlProvider({
        client: s3 as unknown as PreviewBuildOutputS3Client,
        bucketName,
        region,
        presign: (command, expiresInSeconds) =>
          getSignedUrl(s3, command, { expiresIn: expiresInSeconds }),
      }),
    buildTransferProvider: (bucketName: string) =>
      createS3PreviewBuildTransferProvider({
        client: s3 as unknown as PreviewBuildTransferS3Client,
        bucketName,
        region,
        presign: (command, expiresInSeconds) =>
          getSignedUrl(s3, command as never, { expiresIn: expiresInSeconds }),
      }),
    buildJobEnvelopeStore: (bucketName: string) =>
      createS3PreviewBuildJobEnvelopeStore({
        client: s3 as unknown as { send(command: unknown): Promise<unknown> },
        bucketName,
        region,
      }),
    buildAttestorEnvelopeStore: (bucketName: string) =>
      createS3PreviewBuildAttestorEnvelopeStore({
        client: s3 as unknown as { send(command: unknown): Promise<unknown> },
        bucketName,
        region,
      }),
    buildAttestorReceiptStore: (bucketName: string) =>
      createS3PreviewBuildAttestorReceiptStore({
        client: s3 as unknown as { send(command: unknown): Promise<unknown> },
        bucketName,
      }),
    destroy() {
      ecs.destroy();
      dynamoDocument.destroy();
      s3.destroy();
    },
  };
}
