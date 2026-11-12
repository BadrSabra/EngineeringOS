import { createServer } from "node:http";
import { createPreviewAwsClients } from "./lib/preview-aws-clients.js";
import { createPreviewCommandFence } from "./lib/preview-command-fence.js";
import { assertPreviewControlPublicKeyPem } from "./lib/preview-control-command.js";
import { createPreviewGatewayControlHandler } from "./lib/preview-gateway-control-handler.js";
import { createPreviewGatewayApp } from "./lib/preview-gateway-server.js";
import { createPreviewBuildInputUploadHandler } from "./lib/preview-build-upload.js";
import { assertPreviewBuildJobPublicKeyPem } from "./lib/preview-build-job.js";
import { createPreviewBuilderHandler } from "./lib/preview-builder-handler.js";
import { createPreviewBuildReconcileHandler } from "./lib/preview-build-reconcile.js";
import {
  assertPreviewBuilderRunnerConfig,
  type PreviewBuilderRunnerConfig,
} from "./lib/preview-builder-runner.js";
import {
  assertPreviewEcsRunnerConfig,
  type PreviewEcsRunnerConfig,
} from "./lib/preview-ecs-runner.js";
import {
  assertPreviewBuildAttestorRunnerConfig,
  type PreviewBuildAttestorRunnerConfig,
} from "./lib/preview-build-attestor-runner.js";
import { createPreviewBuildAttestorHandler } from "./lib/preview-build-attestor-handler.js";

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required Gateway setting: ${name}`);
  return value;
}

function requiredS3BucketName(env: NodeJS.ProcessEnv, name: string): string {
  const value = requiredEnvironment(env, name);
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value) ||
    value.includes("..") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
  ) {
    throw new Error("Preview artifact bucket configuration is invalid.");
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 8080;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Gateway port is invalid.");
  }
  return port;
}

function parseSubnetIds(value: string): string[] {
  const subnetIds = value
    .split(",")
    .map((subnet) => subnet.trim())
    .filter(Boolean);
  if (subnetIds.length < 1 || subnetIds.length > 4) {
    throw new Error("Gateway private subnet configuration is invalid.");
  }
  if (new Set(subnetIds).size !== subnetIds.length) {
    throw new Error("Gateway private subnet configuration is invalid.");
  }
  return subnetIds;
}

export function loadPreviewGatewayConfiguration(env: NodeJS.ProcessEnv): {
  region: string;
  port: number;
  publicKeyPem: string;
  commandFenceTableName: string;
  buildJobFenceTableName: string;
  buildAttestorFenceTableName?: string;
  buildInputBucketName: string;
  runnerConfig: PreviewEcsRunnerConfig;
  builderConfig: PreviewBuilderRunnerConfig;
  attestorConfig?: PreviewBuildAttestorRunnerConfig;
} {
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim();
  if (!region) throw new Error("AWS region is not configured.");
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
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "AWS_PROFILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_CONFIG_FILE",
  ]) {
    if (env[forbidden]) {
      throw new Error("Gateway environment contains a forbidden credential.");
    }
  }
  if (
    !/^\/v2\/credentials\/[A-Za-z0-9._-]{1,128}$/.test(
      env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ?? "",
    )
  ) {
    throw new Error("Gateway ECS task-role credentials are not available.");
  }
  const runnerConfig: PreviewEcsRunnerConfig = {
    clusterArn: requiredEnvironment(env, "PREVIEW_ECS_CLUSTER_ARN"),
    taskDefinitionArnPrefix: requiredEnvironment(
      env,
      "PREVIEW_TASK_DEFINITION_ARN_PREFIX",
    ),
    ecrRepositoryUri: requiredEnvironment(env, "PREVIEW_ECR_REPOSITORY_URI"),
    executionRoleArn: requiredEnvironment(
      env,
      "PREVIEW_RUNNER_EXECUTION_ROLE_ARN",
    ),
    privateSubnetIds: parseSubnetIds(
      requiredEnvironment(env, "PREVIEW_PRIVATE_SUBNET_IDS"),
    ),
    runnerSecurityGroupId: requiredEnvironment(
      env,
      "PREVIEW_RUNNER_SECURITY_GROUP_ID",
    ),
  };
  assertPreviewEcsRunnerConfig(runnerConfig);
  const builderConfig: PreviewBuilderRunnerConfig = {
    clusterArn: runnerConfig.clusterArn,
    taskDefinitionArn: requiredEnvironment(
      env,
      "PREVIEW_BUILDER_TASK_DEFINITION_ARN",
    ),
    ecrRepositoryUri: requiredEnvironment(
      env,
      "PREVIEW_BUILDER_ECR_REPOSITORY_URI",
    ),
    imageDigest: requiredEnvironment(env, "PREVIEW_BUILDER_IMAGE_DIGEST"),
    executionRoleArn: requiredEnvironment(
      env,
      "PREVIEW_BUILDER_EXECUTION_ROLE_ARN",
    ),
    buildInputBucketName: requiredS3BucketName(
      env,
      "PREVIEW_BUILD_INPUT_BUCKET",
    ),
    region,
    publicKeyPem: requiredEnvironment(env, "PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM"),
    privateSubnetIds: parseSubnetIds(
      requiredEnvironment(env, "PREVIEW_BUILDER_PRIVATE_SUBNET_IDS"),
    ),
    securityGroupId: requiredEnvironment(
      env,
      "PREVIEW_BUILDER_SECURITY_GROUP_ID",
    ),
  };
  assertPreviewBuilderRunnerConfig(builderConfig);
  assertPreviewBuildJobPublicKeyPem(builderConfig.publicKeyPem);
  const buildInputBucketName = requiredS3BucketName(
    env,
    "PREVIEW_BUILD_INPUT_BUCKET",
  );
  const attestorEnvironmentNames = [
    "PREVIEW_BUILD_ATTESTOR_FENCE_TABLE",
    "PREVIEW_ATTESTOR_TASK_DEFINITION_ARN",
    "PREVIEW_ATTESTOR_ECR_REPOSITORY_URI",
    "PREVIEW_ATTESTOR_IMAGE_DIGEST",
    "PREVIEW_ATTESTOR_EXECUTION_ROLE_ARN",
    "PREVIEW_ATTESTOR_TASK_ROLE_ARN",
    "PREVIEW_ATTESTOR_RECEIPT_SIGNING_SECRET_ARN",
    "PREVIEW_ATTESTOR_PRIVATE_SUBNET_IDS",
    "PREVIEW_ATTESTOR_SECURITY_GROUP_ID",
  ] as const;
  const hasAttestorConfiguration = attestorEnvironmentNames.some((name) =>
    env[name]?.trim(),
  );
  let buildAttestorFenceTableName: string | undefined;
  let attestorConfig: PreviewBuildAttestorRunnerConfig | undefined;
  if (hasAttestorConfiguration) {
    buildAttestorFenceTableName = requiredEnvironment(
      env,
      "PREVIEW_BUILD_ATTESTOR_FENCE_TABLE",
    );
    attestorConfig = {
      region,
      bucketName: buildInputBucketName,
      clusterArn: runnerConfig.clusterArn,
      builderConfig,
      taskDefinitionArn: requiredEnvironment(
        env,
        "PREVIEW_ATTESTOR_TASK_DEFINITION_ARN",
      ),
      ecrRepositoryUri: requiredEnvironment(
        env,
        "PREVIEW_ATTESTOR_ECR_REPOSITORY_URI",
      ),
      imageDigest: requiredEnvironment(env, "PREVIEW_ATTESTOR_IMAGE_DIGEST"),
      executionRoleArn: requiredEnvironment(
        env,
        "PREVIEW_ATTESTOR_EXECUTION_ROLE_ARN",
      ),
      taskRoleArn: requiredEnvironment(env, "PREVIEW_ATTESTOR_TASK_ROLE_ARN"),
      receiptSigningSecretArn: requiredEnvironment(
        env,
        "PREVIEW_ATTESTOR_RECEIPT_SIGNING_SECRET_ARN",
      ),
      privateSubnetIds: parseSubnetIds(
        requiredEnvironment(env, "PREVIEW_ATTESTOR_PRIVATE_SUBNET_IDS"),
      ),
      securityGroupId: requiredEnvironment(
        env,
        "PREVIEW_ATTESTOR_SECURITY_GROUP_ID",
      ),
    };
    assertPreviewBuildAttestorRunnerConfig(attestorConfig);
  }
  const publicKeyPem = requiredEnvironment(
    env,
    "PREVIEW_CONTROL_PUBLIC_KEY_PEM",
  );
  assertPreviewControlPublicKeyPem(publicKeyPem);
  return {
    region,
    port: parsePort(env.PORT),
    publicKeyPem,
    commandFenceTableName: requiredEnvironment(
      env,
      "PREVIEW_COMMAND_FENCE_TABLE",
    ),
    buildJobFenceTableName: requiredEnvironment(
      env,
      "PREVIEW_BUILD_JOB_FENCE_TABLE",
    ),
    buildInputBucketName,
    runnerConfig,
    builderConfig,
    ...(buildAttestorFenceTableName ? { buildAttestorFenceTableName } : {}),
    ...(attestorConfig ? { attestorConfig } : {}),
  };
}

export async function startPreviewGateway(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReturnType<typeof createServer>> {
  const configuration = loadPreviewGatewayConfiguration(env);
  const aws = createPreviewAwsClients(configuration.region);
  const handler = createPreviewGatewayControlHandler({
    publicKeyPem: configuration.publicKeyPem,
    ecs: aws.ecs,
    buildOutputUrlProvider: aws.buildOutputUrlProvider(
      configuration.buildInputBucketName,
    ),
    fence: createPreviewCommandFence(
      aws.fenceStorage(configuration.commandFenceTableName),
    ),
    config: configuration.runnerConfig,
  });
  const buildInputUploadHandler = createPreviewBuildInputUploadHandler({
    publicKeyPem: configuration.publicKeyPem,
    objectStore: aws.buildInputObjectStore(configuration.buildInputBucketName),
  });
  const buildTransferProvider = aws.buildTransferProvider(
    configuration.buildInputBucketName,
  );
  const builderHandler = createPreviewBuilderHandler({
    ecs: aws.ecs,
    fence: aws.buildJobFenceStorage(configuration.buildJobFenceTableName),
    transferProvider: buildTransferProvider,
    envelopeStore: aws.buildJobEnvelopeStore(
      configuration.buildInputBucketName,
    ),
    config: configuration.builderConfig,
  });
  const builderReconcileHandler = createPreviewBuildReconcileHandler({
    ecs: aws.ecs,
    transferProvider: buildTransferProvider,
    config: configuration.builderConfig,
  });
  const buildAttestorHandler =
    configuration.attestorConfig && configuration.buildAttestorFenceTableName
      ? createPreviewBuildAttestorHandler({
          ecs: aws.ecs,
          fence: aws.buildAttestorFenceStorage(
            configuration.buildAttestorFenceTableName,
          ),
          envelopeStore: aws.buildAttestorEnvelopeStore(
            configuration.buildInputBucketName,
          ),
          receiptStore: aws.buildAttestorReceiptStore(
            configuration.buildInputBucketName,
          ),
          config: configuration.attestorConfig,
        })
      : undefined;
  const app = createPreviewGatewayApp(
    handler,
    buildInputUploadHandler,
    builderHandler,
    builderReconcileHandler,
    buildAttestorHandler,
  );
  const server = createServer(app);
  server.headersTimeout = 8_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 24;
  server.maxRequestsPerSocket = 100;

  const shutdown = () => {
    server.close();
  };
  server.on("close", () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    aws.destroy();
  });
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      aws.destroy();
      reject(error);
    });
    server.listen(configuration.port, "0.0.0.0", () => {
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
      resolve(server);
    });
  });
}

if (process.argv[1]?.endsWith("preview-gateway.mjs")) {
  void startPreviewGateway().catch(() => {
    console.error("Preview Gateway startup was rejected by configuration.");
    process.exitCode = 1;
  });
}
