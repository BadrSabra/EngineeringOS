import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { z } from "zod/v4";

const SIGNING_DOMAIN = Buffer.from(
  "EngineeringOS Preview Runner Command v1\n",
  "utf8",
);
const MAX_TOKEN_LENGTH = 16_384;
const MAX_PAYLOAD_BYTES = 12_288;
const MAX_COMMAND_TTL_MS = 30_000;
const MAX_SESSION_TTL_MS = 30 * 60_000;
const CLOCK_SKEW_MS = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;

const uuidSchema = z.string().regex(UUID_PATTERN);
const digestSchema = z.string().regex(DIGEST_PATTERN);
const timestampSchema = z.string().refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value,
  "Expected a canonical UTC timestamp.",
);

const artifactRefSchema = z
  .object({
    artifactId: uuidSchema,
    digest: digestSchema,
    manifestDigest: digestSchema,
    sizeBytes: z.number().int().positive().max(512 * 1024 * 1024),
  })
  .strict();

const runtimeProfileSchema = z
  .object({
    profileId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i),
    version: z.number().int().positive().max(10_000),
    runtimeImageDigest: z.string().regex(IMAGE_DIGEST_PATTERN),
    launcherDigest: digestSchema,
    requiredIsolationClass: z.enum(["syscall_sandbox", "microvm"]),
    filesystemPolicyDigest: digestSchema,
    networkPolicyDigest: digestSchema,
    resourcePolicyDigest: digestSchema,
    exposureProtocol: z.literal("session_uds_v1"),
    qualificationRecordId: uuidSchema,
  })
  .strict();

const resourceLimitsSchema = z
  .object({
    cpuMillicores: z.number().int().min(100).max(16_000),
    memoryBytes: z
      .number()
      .int()
      .min(64 * 1024 * 1024)
      .max(64 * 1024 * 1024 * 1024),
    scratchBytes: z
      .number()
      .int()
      .min(1024 * 1024)
      .max(10 * 1024 * 1024 * 1024),
    pidLimit: z.number().int().min(1).max(2_048),
    startupTimeoutMs: z.number().int().min(1_000).max(180_000),
    idleTimeoutMs: z.number().int().min(1_000).max(MAX_SESSION_TTL_MS),
    sessionTtlMs: z.number().int().min(1_000).max(MAX_SESSION_TTL_MS),
  })
  .strict()
  .refine((limits) => limits.idleTimeoutMs <= limits.sessionTtlMs, {
    message: "Idle timeout cannot exceed the session TTL.",
    path: ["idleTimeoutMs"],
  });

const bindingFields = {
  protocolVersion: z.literal(1),
  commandId: uuidSchema,
  idempotencyKey: uuidSchema,
  nodeId: z.string().min(1).max(255),
  sessionId: uuidSchema,
  stateVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  executionGeneration: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
  fencingGeneration: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
  projectId: z.string().min(1).max(255),
  proposalId: z.string().min(1).max(255),
  operationId: z.string().min(1).max(255),
  proposalRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  baseRevision: digestSchema,
  candidateRevision: digestSchema,
  changeSetHash: digestSchema,
  buildReceiptId: uuidSchema,
  artifactDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  channelRef: uuidSchema,
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
};

const startCommandSchema = z
  .object({
    ...bindingFields,
    action: z.literal("start"),
    stateVersion: z.literal(0),
    artifactRef: artifactRefSchema,
    runtimeProfile: runtimeProfileSchema,
    resourceLimits: resourceLimitsSchema,
  })
  .strict()
  .superRefine((command, context) => {
    if (command.artifactDigest !== command.artifactRef.digest) {
      context.addIssue({
        code: "custom",
        message: "Artifact reference digest does not match the command binding.",
        path: ["artifactDigest"],
      });
    }
  });

const stopCommandSchema = z
  .object({
    ...bindingFields,
    action: z.literal("stop"),
    stateVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    executionRef: z.string().regex(/^exec_[A-Za-z0-9_-]{16,96}$/),
    reason: z.enum([
      "cancelled",
      "expired",
      "startup_failed",
      "owner_stopped",
      "superseded",
    ]),
  })
  .strict();

const observeCommandSchema = z
  .object({
    ...bindingFields,
    action: z.literal("observe"),
    stateVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    executionRef: z.string().regex(/^exec_[A-Za-z0-9_-]{16,96}$/),
  })
  .strict();

const commandSchema = z.discriminatedUnion("action", [
  startCommandSchema,
  observeCommandSchema,
  stopCommandSchema,
]);

export type PreviewArtifactRefV1 = z.infer<typeof artifactRefSchema>;
export type PreviewRuntimeProfileV1 = z.infer<typeof runtimeProfileSchema>;
export type PreviewRunnerResourceLimitsV1 = z.infer<
  typeof resourceLimitsSchema
>;
export type PreviewRunnerStartCommandV1 = z.infer<typeof startCommandSchema>;
export type PreviewRunnerObserveCommandV1 = z.infer<
  typeof observeCommandSchema
>;
export type PreviewRunnerStopCommandV1 = z.infer<typeof stopCommandSchema>;
export type PreviewRunnerCommandV1 = z.infer<typeof commandSchema>;

declare const verifiedCommandBrand: unique symbol;
export type VerifiedPreviewRunnerCommandV1 = PreviewRunnerCommandV1 & {
  readonly [verifiedCommandBrand]: true;
};

export type PreviewRunnerCommandBindingV1 = Pick<
  PreviewRunnerCommandV1,
  | "action"
  | "commandId"
  | "idempotencyKey"
  | "channelRef"
  | "nodeId"
  | "sessionId"
  | "stateVersion"
  | "executionGeneration"
  | "fencingGeneration"
  | "projectId"
  | "proposalId"
  | "operationId"
  | "proposalRevision"
  | "baseRevision"
  | "candidateRevision"
  | "changeSetHash"
  | "buildReceiptId"
  | "artifactDigest"
  | "runtimeProfileDigest"
>;

const verifiedCommands = new WeakSet<object>();

/**
 * Cryptographic validation only. Callers must still enforce durable
 * idempotency/fencing, current Candidate ownership, and Runner qualification.
 */
export class PreviewRunnerCommandError extends Error {
  constructor(
    readonly code:
      | "RUNNER_COMMAND_KEY_INVALID"
      | "RUNNER_COMMAND_INVALID"
      | "RUNNER_COMMAND_SIGNATURE_INVALID"
      | "RUNNER_COMMAND_EXPIRED"
      | "RUNNER_COMMAND_BINDING_MISMATCH"
      | "RUNNER_PROFILE_DIGEST_MISMATCH",
  ) {
    super("Preview Runner command is invalid or unavailable.");
    this.name = "PreviewRunnerCommandError";
  }
}

function parseKey(
  pem: string | undefined,
  kind: "private" | "public",
): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_KEY_INVALID");
  }
  try {
    const key =
      kind === "private"
        ? createPrivateKey(pem.replace(/\\n/g, "\n"))
        : createPublicKey(pem.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("Unexpected Runner key type.");
    }
    return key;
  } catch {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_KEY_INVALID");
  }
}

function canonicalRuntimeProfile(profile: PreviewRuntimeProfileV1): string {
  return JSON.stringify({
    profileId: profile.profileId,
    version: profile.version,
    runtimeImageDigest: profile.runtimeImageDigest,
    launcherDigest: profile.launcherDigest,
    requiredIsolationClass: profile.requiredIsolationClass,
    filesystemPolicyDigest: profile.filesystemPolicyDigest,
    networkPolicyDigest: profile.networkPolicyDigest,
    resourcePolicyDigest: profile.resourcePolicyDigest,
    exposureProtocol: profile.exposureProtocol,
    qualificationRecordId: profile.qualificationRecordId,
  });
}

export function previewRuntimeProfileDigest(
  profileInput: PreviewRuntimeProfileV1,
): string {
  const parsed = runtimeProfileSchema.safeParse(profileInput);
  if (!parsed.success) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }
  return createHash("sha256")
    .update("EngineeringOS Preview Runtime Profile v1\n", "utf8")
    .update(canonicalRuntimeProfile(parsed.data), "utf8")
    .digest("hex");
}

function canonicalCommand(command: PreviewRunnerCommandV1): string {
  const shared = {
    protocolVersion: command.protocolVersion,
    action: command.action,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    nodeId: command.nodeId,
    sessionId: command.sessionId,
    stateVersion: command.stateVersion,
    executionGeneration: command.executionGeneration,
    fencingGeneration: command.fencingGeneration,
    projectId: command.projectId,
    proposalId: command.proposalId,
    operationId: command.operationId,
    proposalRevision: command.proposalRevision,
    baseRevision: command.baseRevision,
    candidateRevision: command.candidateRevision,
    changeSetHash: command.changeSetHash,
    buildReceiptId: command.buildReceiptId,
    artifactDigest: command.artifactDigest,
    runtimeProfileDigest: command.runtimeProfileDigest,
    channelRef: command.channelRef,
    issuedAt: command.issuedAt,
    expiresAt: command.expiresAt,
  };

  if (command.action === "start") {
    return JSON.stringify({
      ...shared,
      artifactRef: {
        artifactId: command.artifactRef.artifactId,
        digest: command.artifactRef.digest,
        manifestDigest: command.artifactRef.manifestDigest,
        sizeBytes: command.artifactRef.sizeBytes,
      },
      runtimeProfile: JSON.parse(
        canonicalRuntimeProfile(command.runtimeProfile),
      ) as PreviewRuntimeProfileV1,
      resourceLimits: {
        cpuMillicores: command.resourceLimits.cpuMillicores,
        memoryBytes: command.resourceLimits.memoryBytes,
        scratchBytes: command.resourceLimits.scratchBytes,
        pidLimit: command.resourceLimits.pidLimit,
        startupTimeoutMs: command.resourceLimits.startupTimeoutMs,
        idleTimeoutMs: command.resourceLimits.idleTimeoutMs,
        sessionTtlMs: command.resourceLimits.sessionTtlMs,
      },
    });
  }

  if (command.action === "stop") {
    return JSON.stringify({
      ...shared,
      executionRef: command.executionRef,
      reason: command.reason,
    });
  }

  return JSON.stringify({
    ...shared,
    executionRef: command.executionRef,
  });
}

function validateCommandTime(command: PreviewRunnerCommandV1, now: Date): void {
  if (!Number.isFinite(now.getTime())) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }
  const issuedAt = Date.parse(command.issuedAt);
  const expiresAt = Date.parse(command.expiresAt);
  if (
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_COMMAND_TTL_MS
  ) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_EXPIRED");
  }
  if (
    command.action === "start" &&
    command.resourceLimits.sessionTtlMs > MAX_SESSION_TTL_MS
  ) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }
}

function validateProfileDigest(command: PreviewRunnerCommandV1): void {
  if (
    command.action === "start" &&
    previewRuntimeProfileDigest(command.runtimeProfile) !==
      command.runtimeProfileDigest
  ) {
    throw new PreviewRunnerCommandError(
      "RUNNER_PROFILE_DIGEST_MISMATCH",
    );
  }
}

function parseCommand(value: unknown, now: Date): PreviewRunnerCommandV1 {
  const parsed = commandSchema.safeParse(value);
  if (!parsed.success) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }
  validateCommandTime(parsed.data, now);
  validateProfileDigest(parsed.data);
  return parsed.data;
}

function encodeBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return encodeBase64Url(decoded) === value ? decoded : undefined;
}

function matchesExpectedBinding(
  command: PreviewRunnerCommandV1,
  expected: PreviewRunnerCommandBindingV1,
): boolean {
  return (
    command.action === expected.action &&
    command.commandId === expected.commandId &&
    command.idempotencyKey === expected.idempotencyKey &&
    command.channelRef === expected.channelRef &&
    command.nodeId === expected.nodeId &&
    command.sessionId === expected.sessionId &&
    command.stateVersion === expected.stateVersion &&
    command.executionGeneration === expected.executionGeneration &&
    command.fencingGeneration === expected.fencingGeneration &&
    command.projectId === expected.projectId &&
    command.proposalId === expected.proposalId &&
    command.operationId === expected.operationId &&
    command.proposalRevision === expected.proposalRevision &&
    command.baseRevision === expected.baseRevision &&
    command.candidateRevision === expected.candidateRevision &&
    command.changeSetHash === expected.changeSetHash &&
    command.buildReceiptId === expected.buildReceiptId &&
    command.artifactDigest === expected.artifactDigest &&
    command.runtimeProfileDigest === expected.runtimeProfileDigest
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function signPreviewRunnerCommandV1(input: {
  command: unknown;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const command = parseCommand(input.command, now);
  const payload = Buffer.from(canonicalCommand(command), "utf8");
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }
  const privateKey = parseKey(input.privateKeyPem, "private");
  const signature = sign(
    null,
    Buffer.concat([SIGNING_DOMAIN, payload]),
    privateKey,
  );
  return `${encodeBase64Url(payload)}.${encodeBase64Url(signature)}`;
}

export function verifyPreviewRunnerCommandV1(input: {
  token: string;
  publicKeyPem: string | undefined;
  expected: PreviewRunnerCommandBindingV1;
  now?: Date;
}): VerifiedPreviewRunnerCommandV1 {
  if (
    typeof input.token !== "string" ||
    input.token.length === 0 ||
    input.token.length > MAX_TOKEN_LENGTH
  ) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }
  const separator = input.token.indexOf(".");
  if (separator <= 0 || separator !== input.token.lastIndexOf(".")) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }
  const payload = decodeCanonicalBase64Url(input.token.slice(0, separator));
  const signature = decodeCanonicalBase64Url(
    input.token.slice(separator + 1),
  );
  if (
    !payload ||
    payload.length > MAX_PAYLOAD_BYTES ||
    !signature ||
    signature.length !== 64
  ) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }
  const command = parseCommand(decoded, input.now ?? new Date());
  const canonical = Buffer.from(canonicalCommand(command), "utf8");
  if (!payload.equals(canonical)) {
    throw new PreviewRunnerCommandError("RUNNER_COMMAND_INVALID");
  }

  const publicKey = parseKey(input.publicKeyPem, "public");
  if (
    !verify(
      null,
      Buffer.concat([SIGNING_DOMAIN, canonical]),
      publicKey,
      signature,
    )
  ) {
    throw new PreviewRunnerCommandError(
      "RUNNER_COMMAND_SIGNATURE_INVALID",
    );
  }
  if (!matchesExpectedBinding(command, input.expected)) {
    throw new PreviewRunnerCommandError(
      "RUNNER_COMMAND_BINDING_MISMATCH",
    );
  }

  const frozen = deepFreeze(command) as VerifiedPreviewRunnerCommandV1;
  verifiedCommands.add(frozen);
  return frozen;
}

export function isVerifiedPreviewRunnerCommandV1(
  value: unknown,
): value is VerifiedPreviewRunnerCommandV1 {
  return (
    value !== null &&
    typeof value === "object" &&
    verifiedCommands.has(value)
  );
}
