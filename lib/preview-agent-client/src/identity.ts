import {
  canonicalPreviewAgentPublicKeyPem,
  previewAgentPublicKeyFingerprint,
  previewAgentPublicKeyFingerprintFromPrivateKey,
} from "@workspace/preview-agent-contract";

export type PendingHeartbeat = {
  sequence: number;
  challenge: string;
  signature: string;
  expiresAt: string;
};

export type PendingArtifactDelete = {
  jobId: string;
  commandToken: string;
  receiptToken?: string;
};

export type PreviewAgentIdentity = {
  version: 1;
  state: "pairing" | "active";
  nodeId: string;
  storeId: string;
  keyVersion: number;
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;
  commandPublicKeyPem?: string;
  sequence: number;
  pairing?: {
    code: string;
    expiresAt: string;
  };
  lastChallengeRequestedAt?: string;
  pendingHeartbeat?: PendingHeartbeat;
  pendingArtifactDelete?: PendingArtifactDelete;
  lastSeenAt?: string;
};

export class PreviewAgentIdentityError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_AGENT_IDENTITY_INVALID"
      | "PREVIEW_AGENT_IDENTITY_KEY_MISMATCH",
  ) {
    super("Preview Agent identity is invalid or unavailable.");
    this.name = "PreviewAgentIdentityError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function validatePreviewAgentIdentity(
  value: unknown,
): PreviewAgentIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    (record.state !== "pairing" && record.state !== "active") ||
    typeof record.nodeId !== "string" ||
    !UUID_PATTERN.test(record.nodeId) ||
    typeof record.storeId !== "string" ||
    !UUID_PATTERN.test(record.storeId) ||
    !Number.isSafeInteger(record.keyVersion) ||
    (record.keyVersion as number) < 0 ||
    (record.keyVersion as number) > 1_000_000 ||
    typeof record.publicKeyPem !== "string" ||
    record.publicKeyPem.length > 16_384 ||
    typeof record.privateKeyPem !== "string" ||
    record.privateKeyPem.length > 16_384 ||
    typeof record.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.fingerprint) ||
    !Number.isSafeInteger(record.sequence) ||
    (record.sequence as number) < 0 ||
    (record.sequence as number) > 2_147_483_647
  ) {
    throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
  }

  let fingerprint: string;
  try {
    fingerprint = previewAgentPublicKeyFingerprint(record.publicKeyPem);
    const privateKeyFingerprint = previewAgentPublicKeyFingerprintFromPrivateKey(
      record.privateKeyPem,
    );
    if (privateKeyFingerprint !== fingerprint) {
      throw new PreviewAgentIdentityError(
        "PREVIEW_AGENT_IDENTITY_KEY_MISMATCH",
      );
    }
  } catch (error) {
    if (error instanceof PreviewAgentIdentityError) throw error;
    throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
  }
  if (record.fingerprint !== fingerprint) {
    throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_KEY_MISMATCH");
  }

  if (record.state === "pairing") {
    const pairing = record.pairing as
      | Record<string, unknown>
      | undefined;
    if (
      !pairing ||
      typeof pairing !== "object" ||
      Array.isArray(pairing) ||
      typeof pairing.code !== "string" ||
      !TOKEN_PATTERN.test(pairing.code) ||
      !isDate(pairing.expiresAt) ||
      record.keyVersion !== 0
    ) {
      throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
    }
  } else if (
    record.keyVersion === 0 ||
    record.pairing !== undefined
  ) {
    throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
  }

  if (
    record.commandPublicKeyPem !== undefined &&
    (typeof record.commandPublicKeyPem !== "string" ||
      record.commandPublicKeyPem.length > 16_384)
  ) {
    throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
  }

  let commandPublicKeyPem: string | undefined;
  if (record.commandPublicKeyPem !== undefined) {
    try {
      commandPublicKeyPem = canonicalPreviewAgentPublicKeyPem(
        record.commandPublicKeyPem as string,
      );
    } catch {
      throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
    }
  }

  if (
    record.lastChallengeRequestedAt !== undefined &&
    !isDate(record.lastChallengeRequestedAt)
  ) {
    throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
  }
  if (record.lastSeenAt !== undefined && !isDate(record.lastSeenAt)) {
    throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
  }
  if (record.pendingHeartbeat !== undefined) {
    const pending = record.pendingHeartbeat as
      | Record<string, unknown>
      | null;
    if (
      !pending ||
      typeof pending !== "object" ||
      Array.isArray(pending) ||
      pending.sequence !== record.sequence ||
      typeof pending.challenge !== "string" ||
      !TOKEN_PATTERN.test(pending.challenge) ||
      typeof pending.signature !== "string" ||
      !SIGNATURE_PATTERN.test(pending.signature) ||
      !isDate(pending.expiresAt)
    ) {
      throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
    }
  }
  if (record.pendingArtifactDelete !== undefined) {
    const pending = record.pendingArtifactDelete as
      | Record<string, unknown>
      | null;
    if (
      !pending ||
      typeof pending !== "object" ||
      Array.isArray(pending) ||
      typeof pending.jobId !== "string" ||
      !UUID_PATTERN.test(pending.jobId) ||
      typeof pending.commandToken !== "string" ||
      pending.commandToken.length < 1 ||
      pending.commandToken.length > 8_192 ||
      (pending.receiptToken !== undefined &&
        (typeof pending.receiptToken !== "string" ||
          pending.receiptToken.length < 1 ||
          pending.receiptToken.length > 8_192))
    ) {
      throw new PreviewAgentIdentityError("PREVIEW_AGENT_IDENTITY_INVALID");
    }
  }

  const identity: PreviewAgentIdentity = {
    version: 1,
    state: record.state,
    nodeId: record.nodeId,
    storeId: record.storeId,
    keyVersion: record.keyVersion as number,
    publicKeyPem: record.publicKeyPem,
    privateKeyPem: record.privateKeyPem,
    fingerprint: record.fingerprint,
    sequence: record.sequence as number,
  };
  if (commandPublicKeyPem) identity.commandPublicKeyPem = commandPublicKeyPem;
  if (record.state === "pairing") {
    const pairing = record.pairing as Record<string, unknown>;
    identity.pairing = {
      code: pairing.code as string,
      expiresAt: pairing.expiresAt as string,
    };
  }
  if (record.lastChallengeRequestedAt !== undefined) {
    identity.lastChallengeRequestedAt =
      record.lastChallengeRequestedAt as string;
  }
  if (record.lastSeenAt !== undefined) {
    identity.lastSeenAt = record.lastSeenAt as string;
  }
  if (record.pendingHeartbeat !== undefined) {
    const pending = record.pendingHeartbeat as Record<string, unknown>;
    identity.pendingHeartbeat = {
      sequence: pending.sequence as number,
      challenge: pending.challenge as string,
      signature: pending.signature as string,
      expiresAt: pending.expiresAt as string,
    };
  }
  if (record.pendingArtifactDelete !== undefined) {
    const pending = record.pendingArtifactDelete as Record<string, unknown>;
    identity.pendingArtifactDelete = {
      jobId: pending.jobId as string,
      commandToken: pending.commandToken as string,
      ...(pending.receiptToken !== undefined
        ? { receiptToken: pending.receiptToken as string }
        : {}),
    };
  }
  return identity;
}
