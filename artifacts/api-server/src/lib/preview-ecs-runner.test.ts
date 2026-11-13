import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signPreviewControlCommand,
  type PreviewControlCommand,
} from "./preview-control-command.js";
import {
  createPreviewCommandFence,
  type PreviewCommandFenceStorage,
} from "./preview-command-fence.js";
import {
  executePreviewGatewayCommand,
  PreviewEcsRunnerError,
  type PreviewEcsClient,
  type PreviewEcsRunnerConfig,
  type PreviewTaskDefinition,
} from "./preview-ecs-runner.js";

const now = new Date("2026-11-11T00:00:00.000Z");
const sessionId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const taskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:4";
const clusterArn =
  "arn:aws:ecs:eu-central-1:123456789012:cluster/engineeringos-preview";
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/engineeringos-preview/abcdef0123456789abcdef0123456789";
const outputArtifactUrl =
  "https://engineeringos-preview-artifacts.s3.eu-central-1.amazonaws.com/preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/g1/site.tar.gz?sig=test";
const outputUrlProvider = {
  createDownloadUrl: async () => outputArtifactUrl,
};
const imageDigest = `sha256:${"c".repeat(64)}`;
const repository =
  "123456789012.dkr.ecr.eu-central-1.amazonaws.com/preview-vite";
const executionRoleArn =
  "arn:aws:iam::123456789012:role/engineeringos-preview-execution";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

const config: PreviewEcsRunnerConfig = {
  clusterArn,
  taskDefinitionArnPrefix:
    "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:",
  ecrRepositoryUri: repository,
  executionRoleArn,
  privateSubnetIds: ["subnet-12345678", "subnet-abcdef12"],
  runnerSecurityGroupId: "sg-12345678",
};

function startCommand(
  overrides: Partial<Extract<PreviewControlCommand, { action: "start" }>> = {},
) {
  return {
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
      "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/g1/site.tar.gz",
    outputArtifactDigest: "d".repeat(64),
    imageDigest,
    taskDefinitionArn,
    sessionExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    ...overrides,
  } satisfies Extract<PreviewControlCommand, { action: "start" }>;
}

function taskDefinition(
  overrides: Partial<PreviewTaskDefinition> = {},
): PreviewTaskDefinition {
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
    ...overrides,
  };
}

class FakeEcs implements PreviewEcsClient {
  definition = taskDefinition();
  launched: Parameters<PreviewEcsClient["runTask"]>[0][] = [];
  stopped: Parameters<PreviewEcsClient["stopTask"]>[0][] = [];
  describedTask: Awaited<ReturnType<PreviewEcsClient["describeTask"]>> = {
    taskArn,
    clusterArn,
    startedBy: sessionId,
    taskDefinitionArn,
    lastStatus: "RUNNING",
  };
  async listTasks(_input: {
    cluster: string;
    startedBy: string;
    desiredStatus: "PENDING" | "RUNNING";
  }) {
    return _input.desiredStatus === "RUNNING" ? [taskArn] : [];
  }
  launchResponse = {
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

  async describeTaskDefinition() {
    return this.definition;
  }

  async runTask(input: Parameters<PreviewEcsClient["runTask"]>[0]) {
    this.launched.push(input);
    return this.launchResponse;
  }

  async describeTask() {
    return this.describedTask;
  }

  async stopTask(input: Parameters<PreviewEcsClient["stopTask"]>[0]) {
    this.stopped.push(input);
  }
}

class MemoryFenceStorage implements PreviewCommandFenceStorage {
  readonly records = new Map<
    string,
    Awaited<ReturnType<PreviewCommandFenceStorage["read"]>>
  >();

  async advance(
    record: Parameters<PreviewCommandFenceStorage["advance"]>[0],
  ): Promise<"advanced" | "conflict"> {
    const current = this.records.get(record.sessionId);
    if (current && current.stateVersion >= record.stateVersion) {
      return "conflict";
    }
    this.records.set(record.sessionId, record);
    return "advanced";
  }

  async read(sessionId: string) {
    return this.records.get(sessionId) ?? null;
  }
}

async function execute(
  command: PreviewControlCommand,
  ecs = new FakeEcs(),
  runnerConfig = config,
  fence = createPreviewCommandFence(new MemoryFenceStorage()),
) {
  const token = signPreviewControlCommand(command, privateKeyPem, now);
  const result = await executePreviewGatewayCommand({
    token,
    publicKeyPem,
    ecs,
    buildOutputUrlProvider: outputUrlProvider,
    fence,
    config: runnerConfig,
    now,
  });
  return { result, ecs };
}

describe("Preview ECS command execution", () => {
  it("launches only the signed immutable image in private Fargate networking", async () => {
    const { result, ecs } = await execute(startCommand());

    expect(result).toEqual({
      action: "start",
      taskArn,
      taskDefinitionArn,
    });
    expect(ecs.launched).toEqual([
      {
        cluster: clusterArn,
        taskDefinition: taskDefinitionArn,
        overrides: {
          containerOverrides: [
            {
              name: "preview",
              environment: [
                {
                  name: "PREVIEW_BUILD_OUTPUT_KEY",
                  value:
                    "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/g1/site.tar.gz",
                },
                {
                  name: "PREVIEW_BUILD_OUTPUT_SHA256",
                  value: "d".repeat(64),
                },
                {
                  name: "PREVIEW_BUILD_OUTPUT_URL",
                  value: outputArtifactUrl,
                },
              ],
            },
          ],
        },
        clientToken: sessionId,
        startedBy: sessionId,
        count: 1,
        launchType: "FARGATE",
        platformVersion: "1.4.0",
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.privateSubnetIds,
            securityGroups: [config.runnerSecurityGroupId],
            assignPublicIp: "DISABLED",
          },
        },
        tags: [
          { key: "EngineeringOSPreviewSession", value: sessionId },
          { key: "Product", value: "EngineeringOSPreview" },
        ],
      },
    ]);
  });

  it("fails closed for task definitions with capabilities or secret injection", async () => {
    const ecs = new FakeEcs();
    ecs.definition = taskDefinition({
      taskRoleArn: "arn:aws:iam::123456789012:role/untrusted-task",
    });
    const token = signPreviewControlCommand(startCommand(), privateKeyPem, now);

    await expect(
      executePreviewGatewayCommand({
        token,
        publicKeyPem,
        ecs,
        buildOutputUrlProvider: outputUrlProvider,
        fence: createPreviewCommandFence(new MemoryFenceStorage()),
        config,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_ECS_TASK_DEFINITION_REJECTED",
    });
    expect(ecs.launched).toHaveLength(0);

    ecs.definition = taskDefinition({
      containerDefinitions: [
        {
          ...taskDefinition().containerDefinitions![0],
          secrets: [{ name: "SECRET", valueFrom: "secret-arn" }],
        },
      ],
    });
    await expect(
      executePreviewGatewayCommand({
        token,
        publicKeyPem,
        ecs,
        buildOutputUrlProvider: outputUrlProvider,
        fence: createPreviewCommandFence(new MemoryFenceStorage()),
        config,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_ECS_TASK_DEFINITION_REJECTED",
    });
    expect(ecs.launched).toHaveLength(0);
  });

  it("does not launch when the output object is missing or its checksum is invalid", async () => {
    const ecs = new FakeEcs();
    await expect(
      executePreviewGatewayCommand({
        token: signPreviewControlCommand(startCommand(), privateKeyPem, now),
        publicKeyPem,
        ecs,
        buildOutputUrlProvider: {
          createDownloadUrl: async () => {
            throw new Error("output checksum mismatch");
          },
        },
        fence: createPreviewCommandFence(new MemoryFenceStorage()),
        config,
        now,
      }),
    ).rejects.toThrow("output checksum mismatch");
    expect(ecs.launched).toHaveLength(0);
  });

  it("does not launch when the image digest or task identity differs", async () => {
    const ecs = new FakeEcs();
    ecs.definition = taskDefinition({
      containerDefinitions: [
        {
          ...taskDefinition().containerDefinitions![0],
          image: `${repository}@sha256:${"d".repeat(64)}`,
        },
      ],
    });
    const token = signPreviewControlCommand(startCommand(), privateKeyPem, now);
    await expect(
      executePreviewGatewayCommand({
        token,
        publicKeyPem,
        ecs,
        buildOutputUrlProvider: outputUrlProvider,
        fence: createPreviewCommandFence(new MemoryFenceStorage()),
        config,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_ECS_TASK_DEFINITION_REJECTED",
    });
    expect(ecs.launched).toHaveLength(0);

    ecs.definition = taskDefinition();
    ecs.launchResponse = {
      tasks: [
        {
          taskArn,
          clusterArn,
          startedBy: "another-session",
          taskDefinitionArn,
          lastStatus: "PROVISIONING",
        },
      ],
    };
    await expect(
      executePreviewGatewayCommand({
        token,
        publicKeyPem,
        ecs,
        buildOutputUrlProvider: outputUrlProvider,
        fence: createPreviewCommandFence(new MemoryFenceStorage()),
        config,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_ECS_TASK_IDENTITY_MISMATCH",
    });
  });

  it("rejects partial or multi-task ECS responses instead of guessing", async () => {
    const ecs = new FakeEcs();
    ecs.launchResponse = {
      tasks: [ecs.launchResponse.tasks![0], ecs.launchResponse.tasks![0]],
    };
    await expect(execute(startCommand(), ecs)).rejects.toMatchObject({
      code: "PREVIEW_ECS_LAUNCH_REJECTED",
    });
    expect(ecs.launched).toHaveLength(1);
  });

  it("stops only the exact session-owned task and treats an absent task idempotently", async () => {
    const stopCommand = {
      version: 1,
      action: "stop",
      commandId: "88a2ac82-09ee-4f51-b53a-bbf120c4f9e4",
      sessionId,
      stateVersion: 1,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15_000).toISOString(),
      sessionExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      taskArn,
      taskDefinitionArn,
    } satisfies Extract<PreviewControlCommand, { action: "stop" }>;
    const { result, ecs } = await execute(stopCommand);

    expect(result).toEqual({ action: "stop", taskArn, stopped: true });
    expect(ecs.stopped).toEqual([
      {
        cluster: clusterArn,
        taskArn,
        reason: `Preview session ${sessionId} closed`,
      },
    ]);

    const absent = new FakeEcs();
    absent.describedTask = null;
    await expect(execute(stopCommand, absent)).resolves.toMatchObject({
      result: { action: "stop", taskArn, stopped: false },
    });
    expect(absent.stopped).toHaveLength(0);

    const foreign = new FakeEcs();
    foreign.describedTask = {
      ...foreign.describedTask!,
      startedBy: "another-session",
    };
    await expect(execute(stopCommand, foreign)).rejects.toBeInstanceOf(
      PreviewEcsRunnerError,
    );
    expect(foreign.stopped).toHaveLength(0);
  });

  it("rejects a delayed Start after a newer Stop has fenced the session", async () => {
    const storage = new MemoryFenceStorage();
    const fence = createPreviewCommandFence(storage);
    const stopCommand = {
      version: 1,
      action: "stop",
      commandId: "88a2ac82-09ee-4f51-b53a-bbf120c4f9e4",
      sessionId,
      stateVersion: 1,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15_000).toISOString(),
      sessionExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      taskDefinitionArn,
    } satisfies Extract<PreviewControlCommand, { action: "stop" }>;

    await execute(startCommand(), new FakeEcs(), config, fence);
    const { result, ecs } = await execute(
      stopCommand,
      new FakeEcs(),
      config,
      fence,
    );
    expect(result.action).toBe("stop");
    expect(ecs.stopped).toHaveLength(1);

    const delayedStart = new FakeEcs();
    await expect(
      execute(startCommand(), delayedStart, config, fence),
    ).rejects.toMatchObject({ code: "PREVIEW_ECS_COMMAND_STALE" });
    expect(delayedStart.launched).toHaveLength(0);
  });

  it("stops a task when Stop wins while RunTask is still in flight", async () => {
    const storage = new MemoryFenceStorage();
    const fence = createPreviewCommandFence(storage);
    const ecs = new (class extends FakeEcs {
      override async runTask(
        input: Parameters<PreviewEcsClient["runTask"]>[0],
      ) {
        const result = await super.runTask(input);
        await storage.advance({
          sessionId,
          stateVersion: 1,
          action: "stop",
          fingerprint: "newer-stop-command",
          expiresAtEpoch: Math.floor(now.getTime() / 1_000) + 86_400,
        });
        return result;
      }
    })();

    await expect(
      execute(startCommand(), ecs, config, fence),
    ).rejects.toMatchObject({ code: "PREVIEW_ECS_COMMAND_STALE" });
    expect(ecs.stopped).toEqual([
      {
        cluster: clusterArn,
        taskArn,
        reason: `Preview session ${sessionId} was superseded`,
      },
    ]);
  });

  it("rejects expired commands before making any ECS calls", async () => {
    const ecs = new FakeEcs();
    const command = startCommand({
      issuedAt: new Date(now.getTime() - 40_000).toISOString(),
      expiresAt: new Date(now.getTime() - 10_000).toISOString(),
    });
    const token = signPreviewControlCommand(
      command,
      privateKeyPem,
      new Date(now.getTime() - 40_000),
    );

    await expect(
      executePreviewGatewayCommand({
        token,
        publicKeyPem,
        ecs,
        buildOutputUrlProvider: outputUrlProvider,
        fence: createPreviewCommandFence(new MemoryFenceStorage()),
        config,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_CONTROL_COMMAND_EXPIRED",
    });
    expect(ecs.launched).toHaveLength(0);
    expect(ecs.stopped).toHaveLength(0);
  });
});
