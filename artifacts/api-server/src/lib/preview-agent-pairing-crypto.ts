import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type KeyObject,
} from "node:crypto";

const PAIRING_PROOF_DOMAIN = Buffer.from(
  "EngineeringOS Preview Agent Pairing Proof v1\n",
  "utf8",
);
const PAIRING_CODE_BYTES = 32;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;

export class PreviewAgentPairingCryptoError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_AGENT_PAIRING_CODE_INVALID"
      | "PREVIEW_AGENT_KEY_INVALID"
      | "PREVIEW_AGENT_PROOF_INVALID",
  ) {
    super("Preview Agent pairing is invalid or unavailable.");
    this.name = "PreviewAgentPairingCryptoError";
  }
}

export function createPreviewAgentPairingCode(): string {
  return randomBytes(PAIRING_CODE_BYTES).toString("base64url");
}

export function hashPreviewAgentPairingCode(code: string): string {
  if (!PAIRING_CODE_PATTERN.test(code)) {
    throw new PreviewAgentPairingCryptoError(
      "PREVIEW_AGENT_PAIRING_CODE_INVALID",
    );
  }
  return createHash("sha256").update(code, "ascii").digest("hex");
}

function parseAgentPublicKey(pem: string): KeyObject {
  if (
    typeof pem !== "string" ||
    pem.length > 16_384 ||
    !pem.includes("-----BEGIN")
  ) {
    throw new PreviewAgentPairingCryptoError("PREVIEW_AGENT_KEY_INVALID");
  }
  try {
    const key = createPublicKey(pem.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("Expected Ed25519 key.");
    }
    return key;
  } catch {
    throw new PreviewAgentPairingCryptoError("PREVIEW_AGENT_KEY_INVALID");
  }
}

export function previewAgentPublicKeyFingerprint(publicKeyPem: string): string {
  const key = parseAgentPublicKey(publicKeyPem);
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

export function canonicalPreviewAgentPublicKeyPem(publicKeyPem: string): string {
  return parseAgentPublicKey(publicKeyPem)
    .export({ type: "spki", format: "pem" })
    .toString();
}

export function previewAgentPairingProofPayload(input: {
  pairingCode: string;
  nodeId: string;
  storeId: string;
  expiresAt: Date;
}): Buffer {
  if (
    !PAIRING_CODE_PATTERN.test(input.pairingCode) ||
    !UUID_PATTERN.test(input.nodeId) ||
    !UUID_PATTERN.test(input.storeId) ||
    !Number.isFinite(input.expiresAt.getTime())
  ) {
    throw new PreviewAgentPairingCryptoError(
      "PREVIEW_AGENT_PAIRING_CODE_INVALID",
    );
  }
  const codeHash = hashPreviewAgentPairingCode(input.pairingCode);
  return Buffer.concat([
    PAIRING_PROOF_DOMAIN,
    Buffer.from(
      `${codeHash}\n${input.nodeId}\n${input.storeId}\n${input.expiresAt.toISOString()}`,
      "utf8",
    ),
  ]);
}

export function verifyPreviewAgentPairingProof(input: {
  pairingCode: string;
  nodeId: string;
  storeId: string;
  expiresAt: Date;
  publicKeyPem: string;
  proof: string;
}): string {
  if (
    typeof input.proof !== "string" ||
    !SIGNATURE_PATTERN.test(input.proof)
  ) {
    throw new PreviewAgentPairingCryptoError("PREVIEW_AGENT_PROOF_INVALID");
  }
  const key = parseAgentPublicKey(input.publicKeyPem);
  const payload = previewAgentPairingProofPayload(input);
  const signature = Buffer.from(input.proof, "base64url");
  if (
    signature.length !== 64 ||
    signature.toString("base64url") !== input.proof ||
    !verify(null, payload, key, signature)
  ) {
    throw new PreviewAgentPairingCryptoError("PREVIEW_AGENT_PROOF_INVALID");
  }
  return previewAgentPublicKeyFingerprint(input.publicKeyPem);
}
