import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import test from "node:test";
import {
  attestPreviewBuild,
  createS3PreviewAttestorStorage,
  previewAttestorStartedBy,
} from "./attest.mjs";
import { canonicalPreviewBuildReceiptPayload } from "./receipt.mjs";

const now = new Date("2026-11-12T13:00:00.000Z");
const jobKeys = generateKeyPairSync("ed25519");
const receiptKeys = generateKeyPairSync("ed25519");
const jobPublicKeyPem = jobKeys.publicKey
  .export({
    type: "spki",
    format: "pem",
  })
  .toString();
const receiptPrivateKeyPem = receiptKeys.privateKey
  .export({
    type: "pkcs8",
    format: "pem",
  })
  .toString();
const receiptPublicKey = receiptKeys.publicKey;
const jobId = "11234567-89ab-42cd-8abc-0123456789ab";
const buildId = "01234567-89ab-42cd-8abc-0123456789ab";
const taskArn =
  "arn:aws:ecs:us-east-1:123456789012:task/preview/abcdef0123456789abcdef0123456789";
const clusterArn = "arn:aws:ecs:us-east-1:123456789012:cluster/preview";
const taskDefinitionArn =
  "arn:aws:ecs:us-east-1:123456789012:task-definition/preview-builder:4";
const builderImageDigest = `sha256:${"a".repeat(64)}`;
const bytes = Buffer.from("immutable output archive");
const outputDigest = createHash("sha256").update(bytes).digest("hex");
const signingDomain = Buffer.from(
  "EngineeringOS Preview Build Receipt v1\n",
  "utf8",
);

const jobFields = [
  "version",
  "action",
  "jobId",
  "buildId",
  "builderProfile",
  "builderImageDigest",
  "projectId",
  "proposalId",
  "operationId",
  "proposalRevision",
  "candidateRevision",
  "changeSetHash",
  "sourceRoot",
  "sourceDigest",
  "inputArtifactKey",
  "archiveDigest",
  "outputArtifactKey",
  "issuedAt",
  "expiresAt",
];
const jobFieldsV2 = [
  ...jobFields.slice(0, -2),
  "attemptId",
  "idempotencyKey",
  "dispatchGeneration",
  "issuedAt",
  "expiresAt",
];

function signedJobToken() {
  const claims = {
    version: 1,
    action: "preview-build",
    jobId,
    buildId,
    builderProfile: "vite-react-static-v1",
    builderImageDigest,
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 3,
    candidateRevision: "b".repeat(64),
    changeSetHash: "c".repeat(64),
    sourceRoot: "web",
    sourceDigest: "d".repeat(64),
    inputArtifactKey: `build-inputs/${"e".repeat(64)}/${"f".repeat(64)}.zip`,
    archiveDigest: "f".repeat(64),
    outputArtifactKey: `preview-build-outputs/${buildId}/site.tar.gz`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  const payload = Buffer.from(
    JSON.stringify(
      Object.fromEntries(jobFields.map((key) => [key, claims[key]])),
    ),
  );
  const signature = signBytes(
    null,
    Buffer.concat([
      Buffer.from("EngineeringOS Preview Build Job v1\n"),
      payload,
    ]),
    jobKeys.privateKey,
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

function signedJobTokenV2({
  dispatchGeneration = 2,
  outputArtifactKey = `preview-build-outputs/${buildId}/g2/site.tar.gz`,
} = {}) {
  const claims = {
    version: 2,
    action: "preview-build",
    jobId,
    buildId,
    builderProfile: "vite-react-static-v1",
    builderImageDigest,
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 3,
    candidateRevision: "b".repeat(64),
    changeSetHash: "c".repeat(64),
    sourceRoot: "web",
    sourceDigest: "d".repeat(64),
    inputArtifactKey: `build-inputs/${"e".repeat(64)}/${"f".repeat(64)}.zip`,
    archiveDigest: "f".repeat(64),
    outputArtifactKey,
    attemptId: jobId,
    idempotencyKey: "21234567-89ab-42cd-8abc-0123456789ab",
    dispatchGeneration,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  const payload = Buffer.from(
    JSON.stringify(
      Object.fromEntries(jobFieldsV2.map((key) => [key, claims[key]])),
    ),
  );
  const signature = signBytes(
    null,
    Buffer.concat([
      Buffer.from("EngineeringOS Preview Build Job v2\n", "utf8"),
      payload,
    ]),
    jobKeys.privateKey,
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

function validConfig() {
  return {
    region: "us-east-1",
    bucketName: "preview-artifacts-example",
    clusterArn,
    builderTaskDefinitionArn: taskDefinitionArn,
    builderEcrRepositoryUri:
      "123456789012.dkr.ecr.us-east-1.amazonaws.com/preview-builder",
    builderImageDigest,
    builderExecutionRoleArn:
      "arn:aws:iam::123456789012:role/preview-builder-execution",
    jobPublicKeyPem,
    receiptPrivateKeyPem,
    now: () => now,
  };
}

function validTaskDefinition() {
  return {
    taskDefinitionArn,
    taskRoleArn: null,
    executionRoleArn:
      "arn:aws:iam::123456789012:role/preview-builder-execution",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "1024",
    memory: "2048",
    runtimePlatform: {
      operatingSystemFamily: "LINUX",
      cpuArchitecture: "X86_64",
    },
    volumes: [{ name: "builder-tmp" }],
    containerDefinitions: [
      {
        name: "builder",
        image: `123456789012.dkr.ecr.us-east-1.amazonaws.com/preview-builder@${builderImageDigest}`,
        essential: true,
        user: "1000:1000",
        readonlyRootFilesystem: true,
        privileged: false,
        linuxParameters: { capabilities: { drop: ["ALL"] } },
        command: [],
        entryPoint: [],
        mountPoints: [
          {
            sourceVolume: "builder-tmp",
            containerPath: "/tmp",
            readOnly: false,
          },
        ],
        environment: [
          { name: "AWS_REGION", value: "us-east-1" },
          { name: "PREVIEW_S3_BUCKET", value: "preview-artifacts-example" },
          { name: "PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM", value: jobPublicKeyPem },
        ],
        secrets: [],
        environmentFiles: [],
        portMappings: [],
      },
    ],
  };
}

function validTask() {
  return {
    taskArn,
    clusterArn,
    startedBy: previewAttestorStartedBy(jobId),
    taskDefinitionArn,
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

function dependencies(overrides = {}) {
  const stored = [];
  const ecs = {
    describeTaskDefinition: async () => validTaskDefinition(),
    describeTask: async () => validTask(),
    ...overrides.ecs,
  };
  const storage = {
    headOutput: async () => ({
      contentLength: bytes.length,
      serverSideEncryption: "AES256",
    }),
    getOutput: async () =>
      (async function* () {
        yield bytes;
      })(),
    putReceipt: async (value) => stored.push(value),
    ...overrides.storage,
  };
  return { ecs, storage, stored };
}

test("attests the exact stopped task and stores a signed, digest-bound receipt", async () => {
  const deps = dependencies();
  const result = await attestPreviewBuild({
    jobToken: signedJobToken(),
    taskArn,
    config: validConfig(),
    ...deps,
  });
  assert.deepEqual(
    {
      jobId: result.jobId,
      buildId: result.buildId,
      outputDigest: result.outputDigest,
      contentLength: result.contentLength,
    },
    {
      jobId,
      buildId,
      outputDigest,
      contentLength: bytes.length,
    },
  );
  assert.equal(deps.stored.length, 1);
  assert.equal(
    deps.stored[0].key,
    `preview-build-receipts/${jobId}/${result.receiptId}.json`,
  );
  const record = JSON.parse(deps.stored[0].body.toString("utf8"));
  assert.equal(record.jobId, jobId);
  assert.equal(record.buildId, buildId);
  const [payloadPart, signaturePart] = record.token.split(".");
  const payload = Buffer.from(payloadPart, "base64url");
  const receipt = JSON.parse(payload.toString("utf8"));
  assert.equal(receipt.buildOutputDigest, outputDigest);
  assert.equal(
    verifyBytes(
      null,
      Buffer.concat([
        signingDomain,
        Buffer.from(canonicalPreviewBuildReceiptPayload(receipt)),
      ]),
      receiptPublicKey,
      Buffer.from(signaturePart, "base64url"),
    ),
    true,
  );
});

test("attests output in the exact dispatch-generation prefix", async () => {
  const outputArtifactKey = `preview-build-outputs/${buildId}/g2/site.tar.gz`;
  const deps = dependencies({
    storage: {
      headOutput: async ({ key }) => {
        assert.equal(key, outputArtifactKey);
        return {
          contentLength: bytes.length,
          serverSideEncryption: "AES256",
        };
      },
      getOutput: async ({ key }) => {
        assert.equal(key, outputArtifactKey);
        return (async function* () {
          yield bytes;
        })();
      },
    },
  });
  const result = await attestPreviewBuild({
    jobToken: signedJobTokenV2(),
    taskArn,
    config: validConfig(),
    ...deps,
  });
  assert.equal(result.outputDigest, outputDigest);
  const record = JSON.parse(deps.stored[0].body.toString("utf8"));
  const [payloadPart] = record.token.split(".");
  assert.equal(
    JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"))
      .outputArtifactKey,
    outputArtifactKey,
  );
});

test("rejects a V2 claim whose output path belongs to another generation", async () => {
  const deps = dependencies();
  await assert.rejects(
    attestPreviewBuild({
      jobToken: signedJobTokenV2({
        dispatchGeneration: 2,
        outputArtifactKey: `preview-build-outputs/${buildId}/g1/site.tar.gz`,
      }),
      taskArn,
      config: validConfig(),
      ...deps,
    }),
    { code: "PREVIEW_ATTESTOR_JOB_REJECTED" },
  );
  assert.equal(deps.stored.length, 0);
});

test("rejects persistent or broader Builder scratch storage", async () => {
  for (const taskDefinition of [
    {
      ...validTaskDefinition(),
      volumes: [
        {
          name: "builder-tmp",
          efsVolumeConfiguration: { fileSystemId: "fs-0123456789abcdef0" },
        },
      ],
    },
    {
      ...validTaskDefinition(),
      containerDefinitions: [
        {
          ...validTaskDefinition().containerDefinitions[0],
          mountPoints: [
            {
              sourceVolume: "builder-tmp",
              containerPath: "/workspace",
              readOnly: false,
            },
          ],
        },
      ],
    },
    {
      ...validTaskDefinition(),
      runtimePlatform: {
        operatingSystemFamily: "LINUX",
        cpuArchitecture: "ARM64",
      },
    },
  ]) {
    const deps = dependencies({
      ecs: { describeTaskDefinition: async () => taskDefinition },
    });
    await assert.rejects(
      attestPreviewBuild({
        jobToken: signedJobToken(),
        taskArn,
        config: validConfig(),
        ...deps,
      }),
      { code: "PREVIEW_ATTESTOR_BUILDER_DEFINITION_REJECTED" },
    );
    assert.equal(deps.stored.length, 0);
  }
});

test("uses a distinct deterministic ECS startedBy value for Attestor tasks", () => {
  const value = previewAttestorStartedBy(jobId);
  assert.equal(value, previewAttestorStartedBy(jobId));
  assert.match(value, /^att-[a-f0-9]{32}$/u);
  assert.notEqual(value, jobId);
  assert.equal(
    value,
    `att-${createHash("sha256")
      .update("EngineeringOS Preview Attestor Task v1\n")
      .update(jobId)
      .digest("hex")
      .slice(0, 32)}`,
  );
});

test("refuses a task from another job or builder image", async () => {
  const mismatched = dependencies({
    ecs: {
      describeTask: async () => ({ ...validTask(), startedBy: "another-job" }),
    },
  });
  await assert.rejects(
    attestPreviewBuild({
      jobToken: signedJobToken(),
      taskArn,
      config: validConfig(),
      ...mismatched,
    }),
    { code: "PREVIEW_ATTESTOR_BUILDER_TASK_REJECTED" },
  );

  const wrongImage = dependencies({
    ecs: {
      describeTask: async () => ({
        ...validTask(),
        containers: [
          {
            name: "builder",
            exitCode: 0,
            imageDigest: `sha256:${"9".repeat(64)}`,
          },
        ],
      }),
    },
  });
  await assert.rejects(
    attestPreviewBuild({
      jobToken: signedJobToken(),
      taskArn,
      config: validConfig(),
      ...wrongImage,
    }),
    { code: "PREVIEW_ATTESTOR_BUILDER_TASK_REJECTED" },
  );
});

test("refuses failed builds, unencrypted output, and oversized output", async () => {
  const failed = dependencies({
    ecs: {
      describeTask: async () => ({
        ...validTask(),
        containers: [
          { name: "builder", exitCode: 3, imageDigest: builderImageDigest },
        ],
      }),
    },
  });
  await assert.rejects(
    attestPreviewBuild({
      jobToken: signedJobToken(),
      taskArn,
      config: validConfig(),
      ...failed,
    }),
    { code: "PREVIEW_ATTESTOR_BUILDER_TASK_REJECTED" },
  );

  const unencrypted = dependencies({
    storage: {
      headOutput: async () => ({
        contentLength: bytes.length,
        serverSideEncryption: "aws:kms",
      }),
    },
  });
  await assert.rejects(
    attestPreviewBuild({
      jobToken: signedJobToken(),
      taskArn,
      config: validConfig(),
      ...unencrypted,
    }),
    { code: "PREVIEW_ATTESTOR_OUTPUT_REJECTED" },
  );

  const oversized = dependencies({
    storage: {
      headOutput: async () => ({
        contentLength: 1,
        serverSideEncryption: "AES256",
      }),
      getOutput: async () =>
        (async function* () {
          yield Buffer.alloc(32 * 1024 * 1024 + 1);
        })(),
    },
  });
  await assert.rejects(
    attestPreviewBuild({
      jobToken: signedJobToken(),
      taskArn,
      config: validConfig(),
      ...oversized,
    }),
    { code: "PREVIEW_ATTESTOR_OUTPUT_REJECTED" },
  );
});

test("rejects stale or altered build tokens before observing AWS", async () => {
  const deps = dependencies();
  await assert.rejects(
    attestPreviewBuild({
      jobToken: "malformed",
      taskArn,
      config: validConfig(),
      ...deps,
    }),
    { code: "PREVIEW_ATTESTOR_JOB_REJECTED" },
  );
  assert.equal(deps.stored.length, 0);
});

test("S3 adapter ignores optional checksums and writes receipts conditionally encrypted", async () => {
  const commands = [];
  const storage = createS3PreviewAttestorStorage({
    async send(command) {
      commands.push(command);
      if (command.constructor.name === "HeadObjectCommand") {
        return {
          ContentLength: bytes.length,
          ServerSideEncryption: "AES256",
          ChecksumSHA256: "untrusted-optional-metadata",
        };
      }
      if (command.constructor.name === "GetObjectCommand") {
        return { Body: bytes };
      }
      return {};
    },
  });
  const head = await storage.headOutput({
    bucketName: "preview-artifacts-example",
    key: `preview-build-outputs/${buildId}/site.tar.gz`,
  });
  assert.deepEqual(head, {
    contentLength: bytes.length,
    serverSideEncryption: "AES256",
  });
  assert.equal(
    await storage.getOutput({
      bucketName: "preview-artifacts-example",
      key: `preview-build-outputs/${buildId}/site.tar.gz`,
    }),
    bytes,
  );
  await storage.putReceipt({
    bucketName: "preview-artifacts-example",
    key: `preview-build-receipts/${jobId}/receipt.json`,
    body: Buffer.from("{}"),
  });
  assert.deepEqual(
    commands.map((command) => command.input.Bucket),
    [
      "preview-artifacts-example",
      "preview-artifacts-example",
      "preview-artifacts-example",
    ],
  );
  assert.equal(commands[2].input.ServerSideEncryption, "AES256");
  assert.equal(commands[2].input.IfNoneMatch, "*");
  assert.equal(commands[2].input.CacheControl, "no-store");
});
