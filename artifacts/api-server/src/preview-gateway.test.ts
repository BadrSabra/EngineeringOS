import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadPreviewGatewayConfiguration } from "./preview-gateway.js";

const publicKeyPem = generateKeyPairSync("ed25519").publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

const validEnvironment: NodeJS.ProcessEnv = {
  AWS_REGION: "eu-central-1",
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI:
    "/v2/credentials/12345678-1234-1234-1234-123456789012",
  PREVIEW_CONTROL_PUBLIC_KEY_PEM: publicKeyPem,
  PREVIEW_COMMAND_FENCE_TABLE: "engineeringos-preview-command-fence",
  PREVIEW_BUILD_JOB_FENCE_TABLE: "engineeringos-preview-build-job-fence",
  PREVIEW_BUILD_ATTESTOR_FENCE_TABLE:
    "engineeringos-preview-build-attestor-fence",
  PREVIEW_BUILD_INPUT_BUCKET: "engineeringos-preview-artifacts",
  PREVIEW_ECS_CLUSTER_ARN:
    "arn:aws:ecs:eu-central-1:123456789012:cluster/preview-cluster",
  PREVIEW_TASK_DEFINITION_ARN_PREFIX:
    "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:",
  PREVIEW_ECR_REPOSITORY_URI:
    "123456789012.dkr.ecr.eu-central-1.amazonaws.com/engineeringos-preview-vite",
  PREVIEW_RUNNER_EXECUTION_ROLE_ARN:
    "arn:aws:iam::123456789012:role/engineeringos-preview-runner-execution",
  PREVIEW_PRIVATE_SUBNET_IDS: "subnet-12345678,subnet-87654321",
  PREVIEW_RUNNER_SECURITY_GROUP_ID: "sg-12345678",
  PREVIEW_BUILDER_TASK_DEFINITION_ARN:
    "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite-builder:3",
  PREVIEW_BUILDER_ECR_REPOSITORY_URI:
    "123456789012.dkr.ecr.eu-central-1.amazonaws.com/engineeringos-preview-vite-builder",
  PREVIEW_BUILDER_IMAGE_DIGEST: `sha256:${"c".repeat(64)}`,
  PREVIEW_BUILDER_EXECUTION_ROLE_ARN:
    "arn:aws:iam::123456789012:role/engineeringos-preview-builder-execution",
  PREVIEW_BUILDER_PRIVATE_SUBNET_IDS: "subnet-12345678,subnet-87654321",
  PREVIEW_BUILDER_SECURITY_GROUP_ID: "sg-87654321",
  PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM: publicKeyPem,
  PREVIEW_ATTESTOR_TASK_DEFINITION_ARN:
    "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-attestor:1",
  PREVIEW_ATTESTOR_ECR_REPOSITORY_URI:
    "123456789012.dkr.ecr.eu-central-1.amazonaws.com/engineeringos-preview-attestor",
  PREVIEW_ATTESTOR_IMAGE_DIGEST: `sha256:${"d".repeat(64)}`,
  PREVIEW_ATTESTOR_EXECUTION_ROLE_ARN:
    "arn:aws:iam::123456789012:role/engineeringos-preview-attestor-execution",
  PREVIEW_ATTESTOR_TASK_ROLE_ARN:
    "arn:aws:iam::123456789012:role/engineeringos-preview-attestor-task",
  PREVIEW_ATTESTOR_RECEIPT_SIGNING_SECRET_ARN:
    "arn:aws:secretsmanager:eu-central-1:123456789012:secret:engineeringos-preview-attestor-signing-abc123",
  PREVIEW_ATTESTOR_PRIVATE_SUBNET_IDS: "subnet-12345678,subnet-87654321",
  PREVIEW_ATTESTOR_SECURITY_GROUP_ID: "sg-aaaaaaaa",
};

describe("Preview Gateway startup configuration", () => {
  it("loads only the bounded AWS task-role configuration without database settings", () => {
    const config = loadPreviewGatewayConfiguration(validEnvironment);
    expect(config).toMatchObject({
      region: "eu-central-1",
      port: 8080,
      commandFenceTableName: "engineeringos-preview-command-fence",
      buildJobFenceTableName: "engineeringos-preview-build-job-fence",
      buildAttestorFenceTableName: "engineeringos-preview-build-attestor-fence",
      buildInputBucketName: "engineeringos-preview-artifacts",
      runnerConfig: {
        clusterArn: validEnvironment.PREVIEW_ECS_CLUSTER_ARN,
        privateSubnetIds: ["subnet-12345678", "subnet-87654321"],
        runnerSecurityGroupId: "sg-12345678",
      },
      builderConfig: {
        taskDefinitionArn: validEnvironment.PREVIEW_BUILDER_TASK_DEFINITION_ARN,
        imageDigest: validEnvironment.PREVIEW_BUILDER_IMAGE_DIGEST,
        publicKeyPem: publicKeyPem.trim(),
        privateSubnetIds: ["subnet-12345678", "subnet-87654321"],
        securityGroupId: "sg-87654321",
      },
      attestorConfig: {
        taskDefinitionArn:
          validEnvironment.PREVIEW_ATTESTOR_TASK_DEFINITION_ARN,
        imageDigest: validEnvironment.PREVIEW_ATTESTOR_IMAGE_DIGEST,
        taskRoleArn: validEnvironment.PREVIEW_ATTESTOR_TASK_ROLE_ARN,
        receiptSigningSecretArn:
          validEnvironment.PREVIEW_ATTESTOR_RECEIPT_SIGNING_SECRET_ARN,
        privateSubnetIds: ["subnet-12345678", "subnet-87654321"],
        securityGroupId: "sg-aaaaaaaa",
      },
    });
    expect(config).not.toHaveProperty("databaseUrl");
  });

  it.each([
    ["DATABASE_URL", "postgres://should-not-be-present"],
    ["PGPASSWORD", "should-not-be-present"],
    ["AWS_ACCESS_KEY_ID", "static-access-key"],
    ["AWS_SECRET_ACCESS_KEY", "static-secret"],
    ["AWS_SESSION_TOKEN", "static-session"],
    ["AWS_PROFILE", "local-profile"],
    ["AWS_CONTAINER_CREDENTIALS_FULL_URI", "http://127.0.0.1/credentials"],
  ])("fails closed if forbidden credential %s is injected", (name, value) => {
    expect(() =>
      loadPreviewGatewayConfiguration({
        ...validEnvironment,
        [name]: value,
      }),
    ).toThrow("forbidden credential");
  });

  it("rejects malformed task networking before the server listens", () => {
    expect(() =>
      loadPreviewGatewayConfiguration({
        ...validEnvironment,
        PREVIEW_PRIVATE_SUBNET_IDS: "not-a-subnet",
      }),
    ).toThrow();
  });

  it("keeps Builder and Preview Gateway startup available before Attestor is provisioned", () => {
    const environment = { ...validEnvironment };
    for (const name of [
      "PREVIEW_BUILD_ATTESTOR_FENCE_TABLE",
      "PREVIEW_ATTESTOR_TASK_DEFINITION_ARN",
      "PREVIEW_ATTESTOR_ECR_REPOSITORY_URI",
      "PREVIEW_ATTESTOR_IMAGE_DIGEST",
      "PREVIEW_ATTESTOR_EXECUTION_ROLE_ARN",
      "PREVIEW_ATTESTOR_TASK_ROLE_ARN",
      "PREVIEW_ATTESTOR_RECEIPT_SIGNING_SECRET_ARN",
      "PREVIEW_ATTESTOR_PRIVATE_SUBNET_IDS",
      "PREVIEW_ATTESTOR_SECURITY_GROUP_ID",
    ]) {
      delete environment[name];
    }
    const config = loadPreviewGatewayConfiguration(environment);
    expect(config.attestorConfig).toBeUndefined();
    expect(config.buildAttestorFenceTableName).toBeUndefined();
  });

  it("rejects partial Attestor configuration instead of silently disabling its route", () => {
    expect(() =>
      loadPreviewGatewayConfiguration({
        ...validEnvironment,
        PREVIEW_ATTESTOR_TASK_ROLE_ARN: undefined,
      }),
    ).toThrow(/PREVIEW_ATTESTOR_TASK_ROLE_ARN/u);
  });

  it("requires the relative ECS task-role credential endpoint", () => {
    expect(() =>
      loadPreviewGatewayConfiguration({
        ...validEnvironment,
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: undefined,
      }),
    ).toThrow("task-role credentials");
    expect(() =>
      loadPreviewGatewayConfiguration({
        ...validEnvironment,
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/absolute/external/path",
      }),
    ).toThrow("task-role credentials");
  });

  it("rejects a malformed Gateway verification key before listening", () => {
    expect(() =>
      loadPreviewGatewayConfiguration({
        ...validEnvironment,
        PREVIEW_CONTROL_PUBLIC_KEY_PEM: "not-a-public-key",
      }),
    ).toThrow();
  });

  it("rejects invalid artifact bucket names before listening", () => {
    expect(() =>
      loadPreviewGatewayConfiguration({
        ...validEnvironment,
        PREVIEW_BUILD_INPUT_BUCKET: "bad..bucket",
      }),
    ).toThrow("artifact bucket configuration is invalid");
  });
});
