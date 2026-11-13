import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { z } from "zod/v4";
import type { PreviewRunnerCommandBindingV1 } from "./runner-command.js";

const SIGNING_DOMAIN = Buffer.from(
  "EngineeringOS Preview Runner Result v1\n",
  "utf8",
);
const MAX_TOKEN_LENGTH = 16_384;
const MAX_PAYLOAD_BYTES = 12_288;
const MAX_MESSAGE_TTL_MS = 30_000;
const MAX_OBSERVATION_AGE_MS = 5_000;
const CLOCK_SKEW_MS = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const EXECUTION_REF_PATTERN = /^exec_[A-Za-z0-9_-]{16,96}$/;

const uuidSchema = z.string().regex(UUID_PATTERN);
const digestSchema = z.string().regex(DIGEST_PATTERN);
const executionRefSchema = z.string().regex(EXECUTION_REF_PATTERN);
const timestampSchema = z.string().refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value,
  "Expected a canonical UTC timestamp.",
);

const evidenceSchema = z
  .object({
    artifactDigest: digestSchema,
    runtimeImageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
    launcherDigest: digestSchema,
    filesystemPolicyDigest: digestSchema,
    networkPolicyDigest: digestSchema,
    resourcePolicyDigest: digestSchema,
    isolationEvidenceDigest: digestSchema,
    channelRef: uuidSchema,
  })
  .strict();

const commonFields = {
  protocolVersion: z.literal(1),
  messageId: uuidSchema,
  keyId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  nodeId: z.string().min(1).max(255),
  commandId: uuidSchema,
  idempotencyKey: uuidSchema,
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
  runtimeProfileDigest: digestSchema,
  artifactDigest: digestSchema,
  channelRef: uuidSchema,
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
};

const startAckSchema = z
  .object({
    ...commonFields,
    messageType: z.literal("start_ack"),
    status: z.enum(["accepted", "already_accepted", "outcome_unknown"]),
    executionRef: executionRefSchema.nullable(),
    appliedEvidence: evidenceSchema.nullable(),
  })
  .strict()
  .superRefine((message, context) => {
    const accepted =
      message.status === "accepted" || message.status === "already_accepted";
    if (accepted && (!message.executionRef || !message.appliedEvidence)) {
      context.addIssue({
        code: "custom",
        message: "Accepted start requires its execution and applied evidence.",
      });
    }
    if (!accepted && (message.executionRef || message.appliedEvidence)) {
      context.addIssue({
        code: "custom",
        message: "Unknown start outcome cannot assert an execution.",
      });
    }
    if (
      message.appliedEvidence &&
      message.appliedEvidence.artifactDigest !== message.artifactDigest
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied artifact digest does not match the command binding.",
        path: ["appliedEvidence", "artifactDigest"],
      });
    }
  });

const observationSchema = z
  .object({
    ...commonFields,
    messageType: z.literal("observation"),
    executionRef: executionRefSchema,
    state: z.enum([
      "provisioning",
      "ready",
      "stopping",
      "stopped",
      "failed",
      "unknown",
    ]),
    observedAt: timestampSchema,
    evidence: evidenceSchema.nullable(),
    terminationConfirmed: z.boolean().nullable(),
    channelClosed: z.boolean().nullable(),
    cleanupConfirmed: z.boolean().nullable(),
    failureCode: z
      .enum([
        "CAPACITY_UNAVAILABLE",
        "STARTUP_FAILED",
        "POLICY_MISMATCH",
        "ARTIFACT_INVALID",
        "INTERNAL_FAILURE",
      ])
      .nullable(),
  })
  .strict()
  .superRefine((message, context) => {
    if (message.state === "ready") {
      if (
        !message.evidence ||
        message.evidence.artifactDigest !== message.artifactDigest ||
        message.terminationConfirmed !== false ||
        message.channelClosed !== false ||
        message.cleanupConfirmed !== false ||
        message.failureCode !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Ready requires matching evidence and a live channel.",
        });
      }
      return;
    }
    if (message.state === "stopped") {
      if (
        message.terminationConfirmed !== true ||
        message.channelClosed !== true ||
        message.cleanupConfirmed !== true ||
        message.failureCode !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Stopped requires confirmed termination and cleanup.",
        });
      }
      return;
    }
    if (message.state === "failed") {
      if (!message.failureCode) {
        context.addIssue({
          code: "custom",
          message: "Failed requires a bounded failure code.",
        });
      }
      return;
    }
    if (
      message.evidence ||
      message.terminationConfirmed !== null ||
      message.channelClosed !== null ||
      message.cleanupConfirmed !== null ||
      message.failureCode !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-terminal observations cannot assert readiness or cleanup.",
      });
    }
  });

const stopAckSchema = z
  .object({
    ...commonFields,
    messageType: z.literal("stop_ack"),
    status: z.enum(["stopped", "outcome_unknown", "stop_unconfirmed"]),
    executionRef: executionRefSchema,
    terminationConfirmed: z.boolean(),
    channelClosed: z.boolean(),
    cleanupConfirmed: z.boolean(),
  })
  .strict()
  .superRefine((message, context) => {
    const allConfirmed =
      message.terminationConfirmed &&
      message.channelClosed &&
      message.cleanupConfirmed;
    if (message.status === "stopped" && !allConfirmed) {
      context.addIssue({
        code: "custom",
        message: "Stopped requires confirmed termination and cleanup.",
      });
    }
    if (message.status !== "stopped" && allConfirmed) {
      context.addIssue({
        code: "custom",
        message: "Confirmed cleanup cannot be reported as an unknown stop.",
      });
    }
  });

const runnerMessageSchema = z.discriminatedUnion("messageType", [
  startAckSchema,
  observationSchema,
  stopAckSchema,
]);

export type PreviewRunnerStartAckV1 = z.infer<typeof startAckSchema>;
export type PreviewRunnerObservationV1 = z.infer<typeof observationSchema>;
export type PreviewRunnerStopAckV1 = z.infer<typeof stopAckSchema>;
export type PreviewRunnerMessageV1 = z.infer<typeof runnerMessageSchema>;

export type ExpectedPreviewRunnerMessageBindingV1 =
  PreviewRunnerCommandBindingV1 & {
    keyId: string;
    runtimeImageDigest: string;
    launcherDigest: string;
    filesystemPolicyDigest: string;
    networkPolicyDigest: string;
    resourcePolicyDigest: string;
  };

declare const verifiedMessageBrand: unique symbol;
export type VerifiedPreviewRunnerMessageV1 = PreviewRunnerMessageV1 & {
  readonly [verifiedMessageBrand]: true;
};

const verifiedMessages = new WeakSet<object>();

export class PreviewRunnerMessageError extends Error {
  constructor(
    readonly code:
      | "RUNNER_MESSAGE_KEY_INVALID"
      | "RUNNER_MESSAGE_INVALID"
      | "RUNNER_MESSAGE_SIGNATURE_INVALID"
      | "RUNNER_MESSAGE_EXPIRED"
      | "RUNNER_MESSAGE_BINDING_MISMATCH"
      | "RUNNER_MESSAGE_STALE",
  ) {
    super("Preview Runner message is invalid or unavailable.");
    this.name = "PreviewRunnerMessageError";
  }
}

function parseKey(
  pem: string | undefined,
  kind: "private" | "public",
): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_KEY_INVALID");
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
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_KEY_INVALID");
  }
}

function canonicalMessage(message: PreviewRunnerMessageV1): string {
  const common = {
    protocolVersion: message.protocolVersion,
    messageType: message.messageType,
    messageId: message.messageId,
    keyId: message.keyId,
    nodeId: message.nodeId,
    commandId: message.commandId,
    idempotencyKey: message.idempotencyKey,
    sessionId: message.sessionId,
    stateVersion: message.stateVersion,
    executionGeneration: message.executionGeneration,
    fencingGeneration: message.fencingGeneration,
    projectId: message.projectId,
    proposalId: message.proposalId,
    operationId: message.operationId,
    proposalRevision: message.proposalRevision,
    baseRevision: message.baseRevision,
    candidateRevision: message.candidateRevision,
    changeSetHash: message.changeSetHash,
    buildReceiptId: message.buildReceiptId,
    runtimeProfileDigest: message.runtimeProfileDigest,
    artifactDigest: message.artifactDigest,
    channelRef: message.channelRef,
    issuedAt: message.issuedAt,
    expiresAt: message.expiresAt,
  };

  if (message.messageType === "start_ack") {
    return JSON.stringify({
      ...common,
      status: message.status,
      executionRef: message.executionRef,
      appliedEvidence: message.appliedEvidence,
    });
  }
  if (message.messageType === "observation") {
    return JSON.stringify({
      ...common,
      executionRef: message.executionRef,
      state: message.state,
      observedAt: message.observedAt,
      evidence: message.evidence,
      terminationConfirmed: message.terminationConfirmed,
      channelClosed: message.channelClosed,
      cleanupConfirmed: message.cleanupConfirmed,
      failureCode: message.failureCode,
    });
  }
  return JSON.stringify({
    ...common,
    status: message.status,
    executionRef: message.executionRef,
    terminationConfirmed: message.terminationConfirmed,
    channelClosed: message.channelClosed,
    cleanupConfirmed: message.cleanupConfirmed,
  });
}

function validateTime(message: PreviewRunnerMessageV1, now: Date): void {
  const nowMs = now.getTime();
  const issuedAt = Date.parse(message.issuedAt);
  const expiresAt = Date.parse(message.expiresAt);
  if (
    !Number.isFinite(nowMs) ||
    issuedAt > nowMs + CLOCK_SKEW_MS ||
    expiresAt <= nowMs ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_MESSAGE_TTL_MS
  ) {
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_EXPIRED");
  }
  if (message.messageType === "observation") {
    const observedAt = Date.parse(message.observedAt);
    if (
      observedAt > nowMs + CLOCK_SKEW_MS ||
      observedAt > issuedAt + CLOCK_SKEW_MS ||
      nowMs - observedAt > MAX_OBSERVATION_AGE_MS
    ) {
      throw new PreviewRunnerMessageError("RUNNER_MESSAGE_STALE");
    }
  }
}

function parseMessage(
  value: unknown,
  now: Date,
): PreviewRunnerMessageV1 {
  const parsed = runnerMessageSchema.safeParse(value);
  if (!parsed.success) {
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_INVALID");
  }
  validateTime(parsed.data, now);
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
  message: PreviewRunnerMessageV1,
  expected: ExpectedPreviewRunnerMessageBindingV1,
): boolean {
  const expectedMessageType =
    expected.action === "start"
      ? "start_ack"
      : expected.action === "observe"
        ? "observation"
        : "stop_ack";
  return (
    message.messageType === expectedMessageType &&
    message.keyId === expected.keyId &&
    message.nodeId === expected.nodeId &&
    message.commandId === expected.commandId &&
    message.idempotencyKey === expected.idempotencyKey &&
    message.sessionId === expected.sessionId &&
    message.stateVersion === expected.stateVersion &&
    message.executionGeneration === expected.executionGeneration &&
    message.fencingGeneration === expected.fencingGeneration &&
    message.projectId === expected.projectId &&
    message.proposalId === expected.proposalId &&
    message.operationId === expected.operationId &&
    message.proposalRevision === expected.proposalRevision &&
    message.baseRevision === expected.baseRevision &&
    message.candidateRevision === expected.candidateRevision &&
    message.changeSetHash === expected.changeSetHash &&
    message.buildReceiptId === expected.buildReceiptId &&
    message.runtimeProfileDigest === expected.runtimeProfileDigest &&
    message.artifactDigest === expected.artifactDigest &&
    message.channelRef === expected.channelRef
  );
}

function matchesExpectedAppliedProfile(
  message: PreviewRunnerMessageV1,
  expected: ExpectedPreviewRunnerMessageBindingV1,
): boolean {
  const evidence =
    message.messageType === "start_ack"
      ? message.appliedEvidence
      : message.messageType === "observation" && message.state === "ready"
        ? message.evidence
        : null;
  if (!evidence) return true;
  return (
    evidence.artifactDigest === expected.artifactDigest &&
    evidence.runtimeImageDigest === expected.runtimeImageDigest &&
    evidence.launcherDigest === expected.launcherDigest &&
    evidence.filesystemPolicyDigest === expected.filesystemPolicyDigest &&
    evidence.networkPolicyDigest === expected.networkPolicyDigest &&
    evidence.resourcePolicyDigest === expected.resourcePolicyDigest &&
    evidence.channelRef === expected.channelRef
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function signPreviewRunnerMessageV1(input: {
  message: unknown;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const message = parseMessage(input.message, input.now ?? new Date());
  const payload = Buffer.from(canonicalMessage(message), "utf8");
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_INVALID");
  }
  const signature = sign(
    null,
    Buffer.concat([SIGNING_DOMAIN, payload]),
    parseKey(input.privateKeyPem, "private"),
  );
  return `${encodeBase64Url(payload)}.${encodeBase64Url(signature)}`;
}

export function verifyPreviewRunnerMessageV1(input: {
  token: string;
  publicKeyPem: string | undefined;
  expected: ExpectedPreviewRunnerMessageBindingV1;
  now?: Date;
}): VerifiedPreviewRunnerMessageV1 {
  if (
    typeof input.token !== "string" ||
    input.token.length === 0 ||
    input.token.length > MAX_TOKEN_LENGTH
  ) {
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_INVALID");
  }
  const separator = input.token.indexOf(".");
  if (separator <= 0 || separator !== input.token.lastIndexOf(".")) {
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_INVALID");
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
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_INVALID");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_INVALID");
  }
  const message = parseMessage(decoded, input.now ?? new Date());
  const canonical = Buffer.from(canonicalMessage(message), "utf8");
  if (!payload.equals(canonical)) {
    throw new PreviewRunnerMessageError("RUNNER_MESSAGE_INVALID");
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
    throw new PreviewRunnerMessageError(
      "RUNNER_MESSAGE_SIGNATURE_INVALID",
    );
  }
  if (!matchesExpectedBinding(message, input.expected)) {
    throw new PreviewRunnerMessageError(
      "RUNNER_MESSAGE_BINDING_MISMATCH",
    );
  }
  if (!matchesExpectedAppliedProfile(message, input.expected)) {
    throw new PreviewRunnerMessageError(
      "RUNNER_MESSAGE_BINDING_MISMATCH",
    );
  }
  const frozen = deepFreeze(message) as VerifiedPreviewRunnerMessageV1;
  verifiedMessages.add(frozen);
  return frozen;
}

export function isVerifiedPreviewRunnerMessageV1(
  value: unknown,
): value is VerifiedPreviewRunnerMessageV1 {
  return (
    value !== null &&
    typeof value === "object" &&
    verifiedMessages.has(value)
  );
}
