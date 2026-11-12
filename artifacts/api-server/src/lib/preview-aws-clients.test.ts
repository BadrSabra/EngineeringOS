import { describe, expect, it } from "vitest";
import {
  createPreviewEcsSdkClient,
  type PreviewAwsCommandClient,
} from "./preview-aws-clients.js";

const clusterArn =
  "arn:aws:ecs:eu-central-1:123456789012:cluster/preview-cluster";
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview-cluster/0123456789abcdef0123456789abcdef";
const taskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:4";
const sessionId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";

class FakeAwsClient implements PreviewAwsCommandClient {
  readonly calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  listPage = 0;
  describedTask: Record<string, unknown> | undefined;

  async send(command: unknown): Promise<unknown> {
    const value = command as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    this.calls.push({ name: value.constructor.name, input: value.input });
    switch (value.constructor.name) {
      case "DescribeTaskDefinitionCommand":
        return {
          taskDefinition: {
            taskDefinitionArn,
            executionRoleArn:
              "arn:aws:iam::123456789012:role/preview-runner-execution",
            networkMode: "awsvpc",
            requiresCompatibilities: ["FARGATE"],
            cpu: "256",
            memory: "512",
            volumes: [],
            containerDefinitions: [
              {
                name: "preview",
                image: `123456789012.dkr.ecr.eu-central-1.amazonaws.com/preview@sha256:${"a".repeat(64)}`,
                essential: true,
                user: "1000:1000",
                readonlyRootFilesystem: true,
                linuxParameters: { capabilities: { drop: ["ALL"] } },
                environment: [],
                secrets: [],
                mountPoints: [],
                portMappings: [
                  {
                    containerPort: 8080,
                    hostPort: 8080,
                    protocol: "tcp",
                  },
                ],
              },
            ],
          },
        };
      case "RunTaskCommand":
        return {
          tasks: [
            {
              taskArn,
              clusterArn,
              startedBy: sessionId,
              taskDefinitionArn,
              lastStatus: "PENDING",
            },
          ],
          failures: [],
        };
      case "DescribeTasksCommand":
        return {
          tasks: [
            this.describedTask ?? {
              taskArn,
              clusterArn,
              startedBy: sessionId,
              taskDefinitionArn,
              lastStatus: "RUNNING",
            },
          ],
        };
      case "ListTasksCommand":
        this.listPage += 1;
        return this.listPage === 1
          ? { taskArns: [taskArn], nextToken: "next-page" }
          : { taskArns: [taskArn] };
      case "StopTaskCommand":
        return {};
      default:
        throw new Error(`Unexpected AWS command: ${value.constructor.name}`);
    }
  }
}

describe("Preview ECS SDK adapter", () => {
  it("maps task definitions and pins launch requests to the private Fargate network", async () => {
    const aws = new FakeAwsClient();
    const ecs = createPreviewEcsSdkClient(aws);
    const definition = await ecs.describeTaskDefinition(taskDefinitionArn);
    expect(definition).toMatchObject({
      taskDefinitionArn,
      executionRoleArn:
        "arn:aws:iam::123456789012:role/preview-runner-execution",
      containerDefinitions: [
        {
          name: "preview",
          user: "1000:1000",
          readonlyRootFilesystem: true,
          linuxParameters: { capabilities: { drop: ["ALL"] } },
          portMappings: [{ containerPort: 8080, hostPort: 8080 }],
        },
      ],
    });

    const result = await ecs.runTask({
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
                  "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz",
              },
              { name: "PREVIEW_BUILD_OUTPUT_SHA256", value: "d".repeat(64) },
              {
                name: "PREVIEW_BUILD_OUTPUT_URL",
                value:
                  "https://engineeringos-preview-artifacts.s3.eu-central-1.amazonaws.com/preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz?sig=test",
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
          subnets: ["subnet-12345678", "subnet-87654321"],
          securityGroups: ["sg-12345678"],
          assignPublicIp: "DISABLED",
        },
      },
      tags: [{ key: "PreviewSession", value: sessionId }],
    });
    expect(result).toEqual({
      tasks: [
        {
          taskArn,
          clusterArn,
          startedBy: sessionId,
          taskDefinitionArn,
          lastStatus: "PENDING",
        },
      ],
      failures: [],
    });
    expect(aws.calls[1]?.input).toMatchObject({
      cluster: clusterArn,
      clientToken: sessionId,
      startedBy: sessionId,
      count: 1,
      launchType: "FARGATE",
      platformVersion: "1.4.0",
      overrides: {
        containerOverrides: [
          {
            name: "preview",
            environment: [
              {
                name: "PREVIEW_BUILD_OUTPUT_KEY",
                value:
                  "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz",
              },
              { name: "PREVIEW_BUILD_OUTPUT_SHA256", value: "d".repeat(64) },
              {
                name: "PREVIEW_BUILD_OUTPUT_URL",
                value:
                  "https://engineeringos-preview-artifacts.s3.eu-central-1.amazonaws.com/preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz?sig=test",
              },
            ],
          },
        ],
      },
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: ["subnet-12345678", "subnet-87654321"],
          securityGroups: ["sg-12345678"],
          assignPublicIp: "DISABLED",
        },
      },
    });
  });

  it("paginates task lookup and describes/stops only the supplied cluster task", async () => {
    const aws = new FakeAwsClient();
    const ecs = createPreviewEcsSdkClient(aws);
    await expect(
      ecs.listTasks({
        cluster: clusterArn,
        startedBy: sessionId,
        desiredStatus: "RUNNING",
      }),
    ).resolves.toEqual([taskArn, taskArn]);
    expect(aws.calls[0]?.input).toMatchObject({
      cluster: clusterArn,
      startedBy: sessionId,
      desiredStatus: "RUNNING",
      maxResults: 100,
    });
    expect(aws.calls[1]?.input).toMatchObject({ nextToken: "next-page" });

    await expect(
      ecs.describeTask({ cluster: clusterArn, taskArn }),
    ).resolves.toMatchObject({
      taskArn,
      clusterArn,
      startedBy: sessionId,
    });
    await ecs.stopTask({ cluster: clusterArn, taskArn, reason: "closed" });
    expect(aws.calls.at(-1)).toMatchObject({
      name: "StopTaskCommand",
      input: { cluster: clusterArn, task: taskArn, reason: "closed" },
    });
  });

  it("maps stopped Builder exit observations without exposing raw task diagnostics", async () => {
    const aws = new FakeAwsClient();
    aws.describedTask = {
      taskArn,
      clusterArn,
      startedBy: sessionId,
      taskDefinitionArn,
      lastStatus: "STOPPED",
      stoppedReason: "sensitive provider detail",
      containers: [
        {
          name: "builder",
          exitCode: 0,
          imageDigest: `sha256:${"b".repeat(64)}`,
        },
      ],
    };
    const ecs = createPreviewEcsSdkClient(aws);
    await expect(
      ecs.describeTask({ cluster: clusterArn, taskArn }),
    ).resolves.toEqual({
      taskArn,
      clusterArn,
      startedBy: sessionId,
      taskDefinitionArn,
      lastStatus: "STOPPED",
      containers: [
        {
          name: "builder",
          exitCode: 0,
          imageDigest: `sha256:${"b".repeat(64)}`,
        },
      ],
    });
    expect(
      JSON.stringify(await ecs.describeTask({ cluster: clusterArn, taskArn })),
    ).not.toContain("sensitive provider detail");
  });

  it("fails rather than silently truncating a task list after its page bound", async () => {
    const aws: PreviewAwsCommandClient = {
      async send() {
        return { taskArns: [taskArn], nextToken: "more" };
      },
    };
    const ecs = createPreviewEcsSdkClient(aws);
    await expect(
      ecs.listTasks({
        cluster: clusterArn,
        startedBy: sessionId,
        desiredStatus: "RUNNING",
      }),
    ).rejects.toThrow("bounded page limit");
  });
});
