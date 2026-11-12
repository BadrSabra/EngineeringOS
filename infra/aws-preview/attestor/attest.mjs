import { createHash } from "node:crypto";
import {
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
} from "@aws-sdk/client-ecs";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { verifyPreviewBuildJobToken } from "../builder/job-contract.mjs";
import { signPreviewBuildReceipt } from "./receipt.mjs";

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const TASK_ARN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;
const CLUSTER_ARN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:cluster\/[A-Za-z0-9_-]+$/i;
const TASK_DEFINITION_ARN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task-definition\/[A-Za-z0-9_-]+:\d+$/i;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/i;

export class PreviewAttestorError extends Error {
  constructor(code = "PREVIEW_ATTESTOR_UNAVAILABLE") {
    super("Preview build attestation failed or is unavailable.");
    this.name = "PreviewAttestorError";
    this.code = code;
  }
}

function fail(code) {
  throw new PreviewAttestorError(code);
}

export function validatePreviewAttestorConfig(config) {
  if (
    !config ||
    !CLUSTER_ARN.test(config.clusterArn ?? "") ||
    !TASK_DEFINITION_ARN.test(config.builderTaskDefinitionArn ?? "") ||
    !/^([0-9]{12})\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9/_-]+$/i.test(
      config.builderEcrRepositoryUri ?? "",
    ) ||
    !IMAGE_DIGEST.test(config.builderImageDigest ?? "") ||
    !/^arn:(aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/i.test(
      config.builderExecutionRoleArn ?? "",
    ) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucketName ?? "") ||
    config.bucketName.includes("..") ||
    !/^[a-z0-9-]+$/i.test(config.region ?? "") ||
    typeof config.jobPublicKeyPem !== "string" ||
    config.jobPublicKeyPem.length > 16_384 ||
    !config.jobPublicKeyPem.includes("-----BEGIN") ||
    typeof config.receiptPrivateKeyPem !== "string" ||
    config.receiptPrivateKeyPem.length > 16_384 ||
    !config.receiptPrivateKeyPem.includes("-----BEGIN")
  ) {
    fail("PREVIEW_ATTESTOR_CONFIG_INVALID");
  }
}

function validateTaskDefinition(definition, claims, config) {
  const container = definition?.containerDefinitions?.[0];
  const uid = container?.user?.split(":")[0];
  const numericUid = uid ? Number(uid) : Number.NaN;
  const volumes = definition?.volumes ?? [];
  const mounts = container?.mountPoints ?? [];
  const volume = volumes[0];
  const mount = mounts[0];
  const volumeRecord = volume && typeof volume === "object" ? volume : null;
  const mountRecord = mount && typeof mount === "object" ? mount : null;
  const hasBoundedScratchVolume =
    volumes.length === 1 &&
    mounts.length === 1 &&
    volumeRecord?.name === "builder-tmp" &&
    Object.entries(volumeRecord ?? {}).every(
      ([key, value]) =>
        key === "name" || (key === "configuredAtLaunch" && value === false),
    ) &&
    mountRecord?.sourceVolume === "builder-tmp" &&
    mountRecord.containerPath === "/tmp" &&
    mountRecord.readOnly !== true &&
    Object.keys(mountRecord).every((key) =>
      ["sourceVolume", "containerPath", "readOnly"].includes(key),
    );
  const environment = new Map(
    (container?.environment ?? []).map(({ name, value }) => [name, value]),
  );
  const expectedEnvironment = new Map([
    ["AWS_REGION", config.region],
    ["PREVIEW_S3_BUCKET", config.bucketName],
    ["PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM", config.jobPublicKeyPem.trim()],
  ]);
  if (
    !definition ||
    definition.taskDefinitionArn !== config.builderTaskDefinitionArn ||
    definition.taskRoleArn ||
    definition.executionRoleArn !== config.builderExecutionRoleArn ||
    definition.networkMode !== "awsvpc" ||
    !definition.requiresCompatibilities?.includes("FARGATE") ||
    definition.cpu !== "1024" ||
    definition.memory !== "2048" ||
    definition.runtimePlatform?.operatingSystemFamily !== "LINUX" ||
    definition.runtimePlatform.cpuArchitecture !== "X86_64" ||
    !hasBoundedScratchVolume ||
    definition.containerDefinitions?.length !== 1 ||
    container?.name !== "builder" ||
    container.image !==
      `${config.builderEcrRepositoryUri}@${claims.builderImageDigest}` ||
    container.essential !== true ||
    !Number.isInteger(numericUid) ||
    numericUid <= 0 ||
    container.readonlyRootFilesystem !== true ||
    container.privileged === true ||
    !container.linuxParameters?.capabilities?.drop?.includes("ALL") ||
    (container.command?.length ?? 0) !== 0 ||
    (container.entryPoint?.length ?? 0) !== 0 ||
    (container.secrets?.length ?? 0) !== 0 ||
    (container.environmentFiles?.length ?? 0) !== 0 ||
    (container.portMappings?.length ?? 0) !== 0 ||
    environment.size !== expectedEnvironment.size ||
    [...expectedEnvironment].some(
      ([name, value]) =>
        environment.get(name)?.replace(/\\n/g, "\n").trim() !== value,
    )
  ) {
    fail("PREVIEW_ATTESTOR_BUILDER_DEFINITION_REJECTED");
  }
}

function validateTask(task, claims, taskArn, config) {
  const containers = task?.containers ?? [];
  const builderContainers = containers.filter(
    (container) => container.name === "builder",
  );
  if (
    !task ||
    task.taskArn !== taskArn ||
    task.clusterArn !== config.clusterArn ||
    task.startedBy !== previewAttestorStartedBy(claims.jobId) ||
    task.taskDefinitionArn !== config.builderTaskDefinitionArn ||
    task.lastStatus !== "STOPPED" ||
    containers.length !== 1 ||
    builderContainers.length !== 1 ||
    builderContainers[0]?.exitCode !== 0 ||
    builderContainers[0]?.imageDigest !== claims.builderImageDigest
  ) {
    fail("PREVIEW_ATTESTOR_BUILDER_TASK_REJECTED");
  }
}

export function previewAttestorStartedBy(jobId) {
  if (
    typeof jobId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      jobId,
    )
  ) {
    fail("PREVIEW_ATTESTOR_JOB_REJECTED");
  }
  const digest = createHash("sha256")
    .update("EngineeringOS Preview Attestor Task v1\n")
    .update(jobId.toLowerCase())
    .digest("hex");
  return `att-${digest.slice(0, 32)}`;
}

async function hashBoundedBody(body) {
  if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body)) {
    fail("PREVIEW_ATTESTOR_OUTPUT_REJECTED");
  }
  const hash = createHash("sha256");
  let length = 0;
  try {
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array)) {
        fail("PREVIEW_ATTESTOR_OUTPUT_REJECTED");
      }
      length += chunk.byteLength;
      if (length < 1 || length > MAX_OUTPUT_BYTES) {
        const destroy = body.destroy;
        destroy?.call(body);
        fail("PREVIEW_ATTESTOR_OUTPUT_REJECTED");
      }
      hash.update(chunk);
    }
  } catch (error) {
    if (error instanceof PreviewAttestorError) throw error;
    fail("PREVIEW_ATTESTOR_OUTPUT_UNAVAILABLE");
  }
  if (length < 1) fail("PREVIEW_ATTESTOR_OUTPUT_REJECTED");
  return { outputDigest: hash.digest("hex"), contentLength: length };
}

async function attestOutput({ claims, taskArn, config, storage }) {
  const key = claims.outputArtifactKey;
  const expectedKey = `preview-build-outputs/${claims.buildId}/site.tar.gz`;
  if (key !== expectedKey) fail("PREVIEW_ATTESTOR_OUTPUT_REJECTED");
  let head;
  try {
    head = await storage.headOutput({ bucketName: config.bucketName, key });
  } catch {
    fail("PREVIEW_ATTESTOR_OUTPUT_UNAVAILABLE");
  }
  if (
    !Number.isSafeInteger(head?.contentLength) ||
    head.contentLength < 1 ||
    head.contentLength > MAX_OUTPUT_BYTES ||
    head.serverSideEncryption !== "AES256"
  ) {
    fail("PREVIEW_ATTESTOR_OUTPUT_REJECTED");
  }
  let body;
  try {
    body = await storage.getOutput({ bucketName: config.bucketName, key });
  } catch {
    fail("PREVIEW_ATTESTOR_OUTPUT_UNAVAILABLE");
  }
  const output = await hashBoundedBody(body);
  if (output.contentLength !== head.contentLength) {
    fail("PREVIEW_ATTESTOR_OUTPUT_REJECTED");
  }
  const { receipt, token } = signPreviewBuildReceipt({
    claims,
    buildOutputDigest: output.outputDigest,
    privateKeyPem: config.receiptPrivateKeyPem,
    now: config.now?.() ?? new Date(),
  });
  const receiptKey = `preview-build-receipts/${claims.jobId}/${receipt.receiptId}.json`;
  const bodyBytes = Buffer.from(
    JSON.stringify({
      jobId: claims.jobId,
      buildId: claims.buildId,
      receiptId: receipt.receiptId,
      token,
    }),
    "utf8",
  );
  try {
    await storage.putReceipt({
      bucketName: config.bucketName,
      key: receiptKey,
      body: bodyBytes,
    });
  } catch {
    fail("PREVIEW_ATTESTOR_RECEIPT_STORE_UNAVAILABLE");
  }
  return {
    jobId: claims.jobId,
    buildId: claims.buildId,
    receiptId: receipt.receiptId,
    receiptKey,
    outputDigest: output.outputDigest,
    contentLength: output.contentLength,
  };
}

export async function attestPreviewBuild(input) {
  validatePreviewAttestorConfig(input.config);
  if (
    typeof input.jobToken !== "string" ||
    input.jobToken.length < 1 ||
    input.jobToken.length > 8_192 ||
    typeof input.taskArn !== "string" ||
    !TASK_ARN.test(input.taskArn)
  ) {
    fail("PREVIEW_ATTESTOR_COMMAND_INVALID");
  }
  let claims;
  try {
    claims = verifyPreviewBuildJobToken(
      input.jobToken,
      input.config.jobPublicKeyPem,
      input.config.now?.() ?? new Date(),
    );
  } catch {
    fail("PREVIEW_ATTESTOR_JOB_REJECTED");
  }
  if (
    !IMAGE_DIGEST.test(claims.builderImageDigest) ||
    claims.builderImageDigest !== input.config.builderImageDigest ||
    claims.outputArtifactKey !==
      `preview-build-outputs/${claims.buildId}/site.tar.gz`
  ) {
    fail("PREVIEW_ATTESTOR_JOB_REJECTED");
  }

  let definition;
  let task;
  try {
    [definition, task] = await Promise.all([
      input.ecs.describeTaskDefinition(input.config.builderTaskDefinitionArn),
      input.ecs.describeTask({
        cluster: input.config.clusterArn,
        taskArn: input.taskArn,
      }),
    ]);
  } catch {
    fail("PREVIEW_ATTESTOR_ECS_UNAVAILABLE");
  }
  validateTaskDefinition(definition, claims, input.config);
  validateTask(task, claims, input.taskArn, input.config);
  return attestOutput({
    claims,
    taskArn: input.taskArn,
    config: input.config,
    storage: input.storage,
  });
}

export function createS3PreviewAttestorStorage(client) {
  return {
    async headOutput({ bucketName, key }) {
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
      );
      return {
        contentLength: head.ContentLength,
        serverSideEncryption: head.ServerSideEncryption,
      };
    },
    async getOutput({ bucketName, key }) {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
      );
      return result.Body;
    },
    async putReceipt({ bucketName, key, body }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentLength: body.length,
          ContentType: "application/json",
          CacheControl: "no-store",
          ServerSideEncryption: "AES256",
          IfNoneMatch: "*",
        }),
      );
    },
  };
}

async function main(env = process.env) {
  let ecsClient;
  let s3Client;
  const ecs = {
    async describeTaskDefinition(taskDefinitionArn) {
      const response = await ecsClient.send(
        new DescribeTaskDefinitionCommand({
          taskDefinition: taskDefinitionArn,
        }),
      );
      return response.taskDefinition ?? null;
    },
    async describeTask({ cluster, taskArn }) {
      const response = await ecsClient.send(
        new DescribeTasksCommand({
          cluster,
          tasks: [taskArn],
          include: ["TAGS"],
        }),
      );
      return response.tasks?.[0] ?? null;
    },
  };
  try {
    for (const forbidden of [
      "DATABASE_URL",
      "PGHOST",
      "PGPORT",
      "PGDATABASE",
      "PGUSER",
      "PGPASSWORD",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_SHARED_CREDENTIALS_FILE",
      "AWS_CONFIG_FILE",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_ROLE_ARN",
    ]) {
      if (env[forbidden]) fail("PREVIEW_ATTESTOR_CONFIG_INVALID");
    }
    if (
      !/^\/v2\/credentials\/[A-Za-z0-9._-]{1,128}$/.test(
        env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ?? "",
      )
    ) {
      fail("PREVIEW_ATTESTOR_CONFIG_INVALID");
    }
    const config = {
      region: env.AWS_REGION,
      bucketName: env.PREVIEW_S3_BUCKET,
      clusterArn: env.PREVIEW_ECS_CLUSTER_ARN,
      builderTaskDefinitionArn: env.PREVIEW_BUILDER_TASK_DEFINITION_ARN,
      builderEcrRepositoryUri: env.PREVIEW_BUILDER_ECR_REPOSITORY_URI,
      builderImageDigest: env.PREVIEW_BUILDER_IMAGE_DIGEST,
      builderExecutionRoleArn: env.PREVIEW_BUILDER_EXECUTION_ROLE_ARN,
      jobPublicKeyPem: env.PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM,
      receiptPrivateKeyPem: env.PREVIEW_BUILD_RECEIPT_PRIVATE_KEY_PEM,
    };
    const region = config.region?.trim();
    ecsClient = new ECSClient({ region });
    s3Client = new S3Client({ region });
    const result = await attestPreviewBuild({
      jobToken: env.PREVIEW_ATTESTOR_JOB_TOKEN,
      taskArn: env.PREVIEW_ATTESTOR_BUILDER_TASK_ARN,
      config,
      ecs,
      storage: createS3PreviewAttestorStorage(s3Client),
    });
    process.stdout.write(
      `${JSON.stringify({
        jobId: result.jobId,
        buildId: result.buildId,
        receiptId: result.receiptId,
        outputDigest: result.outputDigest,
      })}\n`,
    );
  } catch {
    process.stderr.write(
      `${JSON.stringify({ error: "PREVIEW_ATTESTOR_FAILED" })}\n`,
    );
    process.exitCode = 1;
  } finally {
    ecsClient?.destroy();
    s3Client?.destroy();
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  await main();
}
