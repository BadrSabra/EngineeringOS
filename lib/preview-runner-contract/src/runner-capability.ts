import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { z } from "zod/v4";

const SIGNING_DOMAIN = Buffer.from(
  "EngineeringOS Preview Runner Capability v1\n",
  "utf8",
);
const MAX_TOKEN_LENGTH = 8_192;
const MAX_PAYLOAD_BYTES = 4_096;
const MAX_CAPABILITY_TTL_MS = 30_000;
const MAX_OBSERVATION_AGE_MS = 5_000;
const CLOCK_SKEW_MS = 5_000;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;

const timestampSchema = z.string().refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value,
  "Expected a canonical UTC timestamp.",
);

const capabilitySchema = z
  .object({
    protocolVersion: z.literal(1),
    nodeId: z.string().min(1).max(255),
    agentVersion: z.string().min(1).max(128),
    sandboxProviderId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    sandboxRuntimeVersion: z.string().min(1).max(128),
    isolationClass: z.enum(["shared_kernel", "syscall_sandbox", "microvm"]),
    runtimeProfileDigest: z.string().regex(DIGEST_PATTERN),
    sandboxPolicyDigest: z.string().regex(DIGEST_PATTERN),
    qualificationRecordId: z.string().uuid(),
    observedAt: timestampSchema,
    expiresAt: timestampSchema,
    evidenceMode: z.enum(["local_observed", "remote_attested"]),
    evidenceKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  })
  .strict();

export type PreviewRunnerCapabilityV1 = z.infer<typeof capabilitySchema>;

export type ExpectedPreviewRunnerCapabilityBindingV1 = Pick<
  PreviewRunnerCapabilityV1,
  | "nodeId"
  | "agentVersion"
  | "sandboxProviderId"
  | "sandboxRuntimeVersion"
  | "isolationClass"
  | "runtimeProfileDigest"
  | "sandboxPolicyDigest"
  | "qualificationRecordId"
  | "evidenceMode"
  | "evidenceKeyId"
>;

declare const verifiedCapabilityBrand: unique symbol;
export type VerifiedPreviewRunnerCapabilityV1 =
  PreviewRunnerCapabilityV1 & {
    readonly [verifiedCapabilityBrand]: true;
  };

const verifiedCapabilities = new WeakSet<object>();

export class PreviewRunnerCapabilityError extends Error {
  constructor(
    readonly code:
      | "RUNNER_CAPABILITY_KEY_INVALID"
      | "RUNNER_CAPABILITY_INVALID"
      | "RUNNER_CAPABILITY_SIGNATURE_INVALID"
      | "RUNNER_CAPABILITY_EXPIRED"
      | "RUNNER_CAPABILITY_STALE"
      | "RUNNER_CAPABILITY_BINDING_MISMATCH",
  ) {
    super("Preview Runner capability is invalid or unavailable.");
    this.name = "PreviewRunnerCapabilityError";
  }
}

function parseKey(
  pem: string | undefined,
  kind: "private" | "public",
): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_KEY_INVALID");
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
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_KEY_INVALID");
  }
}

function canonicalCapability(capability: PreviewRunnerCapabilityV1): string {
  return JSON.stringify({
    protocolVersion: capability.protocolVersion,
    nodeId: capability.nodeId,
    agentVersion: capability.agentVersion,
    sandboxProviderId: capability.sandboxProviderId,
    sandboxRuntimeVersion: capability.sandboxRuntimeVersion,
    isolationClass: capability.isolationClass,
    runtimeProfileDigest: capability.runtimeProfileDigest,
    sandboxPolicyDigest: capability.sandboxPolicyDigest,
    qualificationRecordId: capability.qualificationRecordId,
    observedAt: capability.observedAt,
    expiresAt: capability.expiresAt,
    evidenceMode: capability.evidenceMode,
    evidenceKeyId: capability.evidenceKeyId,
  });
}

function parseCapability(value: unknown): PreviewRunnerCapabilityV1 {
  const parsed = capabilitySchema.safeParse(value);
  if (!parsed.success) {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_INVALID");
  }
  return parsed.data;
}

function validateCapabilityTime(
  capability: PreviewRunnerCapabilityV1,
  now: Date,
): void {
  const nowMs = now.getTime();
  const observedAt = Date.parse(capability.observedAt);
  const expiresAt = Date.parse(capability.expiresAt);
  if (!Number.isFinite(nowMs)) {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_INVALID");
  }
  if (
    observedAt > nowMs + CLOCK_SKEW_MS ||
    expiresAt <= nowMs ||
    expiresAt <= observedAt ||
    expiresAt - observedAt > MAX_CAPABILITY_TTL_MS
  ) {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_EXPIRED");
  }
  if (nowMs - observedAt > MAX_OBSERVATION_AGE_MS) {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_STALE");
  }
}

function matchesExpectedBinding(
  capability: PreviewRunnerCapabilityV1,
  expected: ExpectedPreviewRunnerCapabilityBindingV1,
): boolean {
  return (
    capability.nodeId === expected.nodeId &&
    capability.agentVersion === expected.agentVersion &&
    capability.sandboxProviderId === expected.sandboxProviderId &&
    capability.sandboxRuntimeVersion === expected.sandboxRuntimeVersion &&
    capability.isolationClass === expected.isolationClass &&
    capability.isolationClass !== "shared_kernel" &&
    capability.runtimeProfileDigest === expected.runtimeProfileDigest &&
    capability.sandboxPolicyDigest === expected.sandboxPolicyDigest &&
    capability.qualificationRecordId === expected.qualificationRecordId &&
    capability.evidenceMode === expected.evidenceMode &&
    capability.evidenceKeyId === expected.evidenceKeyId
  );
}

function encodeBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return encodeBase64Url(decoded) === value ? decoded : undefined;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Signs a Runner's capability report. The signature proves which key made the
 * report; it does not independently attest that the reported isolation exists.
 */
export function signPreviewRunnerCapabilityV1(input: {
  capability: unknown;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const capability = parseCapability(input.capability);
  validateCapabilityTime(capability, input.now ?? new Date());
  const payload = Buffer.from(canonicalCapability(capability), "utf8");
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_INVALID");
  }
  const signature = sign(
    null,
    Buffer.concat([SIGNING_DOMAIN, payload]),
    parseKey(input.privateKeyPem, "private"),
  );
  return `${encodeBase64Url(payload)}.${encodeBase64Url(signature)}`;
}

/**
 * Verifies the signed report against an API-owned node/qualification record.
 * Revocation and qualification-record lookup remain the caller's responsibility.
 */
export function verifyPreviewRunnerCapabilityV1(input: {
  token: string;
  publicKeyPem: string | undefined;
  expected: ExpectedPreviewRunnerCapabilityBindingV1;
  now?: Date;
}): VerifiedPreviewRunnerCapabilityV1 {
  if (
    typeof input.token !== "string" ||
    input.token.length === 0 ||
    input.token.length > MAX_TOKEN_LENGTH
  ) {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_INVALID");
  }
  const separator = input.token.indexOf(".");
  if (separator <= 0 || separator !== input.token.lastIndexOf(".")) {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_INVALID");
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
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_INVALID");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_INVALID");
  }
  const capability = parseCapability(decoded);
  const canonical = Buffer.from(canonicalCapability(capability), "utf8");
  if (!payload.equals(canonical)) {
    throw new PreviewRunnerCapabilityError("RUNNER_CAPABILITY_INVALID");
  }
  validateCapabilityTime(capability, input.now ?? new Date());

  const publicKey = parseKey(input.publicKeyPem, "public");
  if (
    !verify(
      null,
      Buffer.concat([SIGNING_DOMAIN, canonical]),
      publicKey,
      signature,
    )
  ) {
    throw new PreviewRunnerCapabilityError(
      "RUNNER_CAPABILITY_SIGNATURE_INVALID",
    );
  }
  if (!matchesExpectedBinding(capability, input.expected)) {
    throw new PreviewRunnerCapabilityError(
      "RUNNER_CAPABILITY_BINDING_MISMATCH",
    );
  }

  const frozen = deepFreeze(capability) as VerifiedPreviewRunnerCapabilityV1;
  verifiedCapabilities.add(frozen);
  return frozen;
}

export function isVerifiedPreviewRunnerCapabilityV1(
  value: unknown,
): value is VerifiedPreviewRunnerCapabilityV1 {
  return (
    value !== null &&
    typeof value === "object" &&
    verifiedCapabilities.has(value)
  );
}
