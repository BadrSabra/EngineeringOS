import { createPrivateKey, randomUUID, sign as signBytes } from "node:crypto";

const DOMAIN = Buffer.from("EngineeringOS Preview Build Receipt v1\n");
const RECEIPT_TTL_MS = 90_000;
const HASH = /^[a-f0-9]{64}$/i;

function requireSigningKey(pem) {
  if (
    typeof pem !== "string" ||
    pem.length > 16_384 ||
    !pem.includes("-----BEGIN")
  ) {
    throw new Error("Attestor signing configuration is invalid.");
  }
  let key;
  try {
    key = createPrivateKey(pem.replace(/\\n/g, "\n"));
  } catch {
    throw new Error("Attestor signing configuration is invalid.");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Attestor signing configuration is invalid.");
  }
  return key;
}

export function canonicalPreviewBuildReceiptPayload(receipt) {
  return JSON.stringify({
    version: receipt.version,
    action: receipt.action,
    receiptId: receipt.receiptId,
    buildId: receipt.buildId,
    builderProfile: receipt.builderProfile,
    builderImageDigest: receipt.builderImageDigest,
    projectId: receipt.projectId,
    proposalId: receipt.proposalId,
    operationId: receipt.operationId,
    proposalRevision: receipt.proposalRevision,
    candidateRevision: receipt.candidateRevision,
    changeSetHash: receipt.changeSetHash,
    sourceDigest: receipt.sourceDigest,
    archiveDigest: receipt.archiveDigest,
    buildOutputDigest: receipt.buildOutputDigest,
    outputArtifactKey: receipt.outputArtifactKey,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
  });
}

export function signPreviewBuildReceipt({
  claims,
  buildOutputDigest,
  privateKeyPem,
  now = new Date(),
}) {
  if (
    !claims ||
    claims.action !== "preview-build" ||
    claims.builderProfile !== "vite-react-static-v1" ||
    !HASH.test(buildOutputDigest) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new Error("Attestor receipt claims are invalid.");
  }
  const receipt = {
    version: 1,
    action: "preview-build-ready",
    receiptId: randomUUID(),
    buildId: claims.buildId,
    builderProfile: claims.builderProfile,
    builderImageDigest: claims.builderImageDigest,
    projectId: claims.projectId,
    proposalId: claims.proposalId,
    operationId: claims.operationId,
    proposalRevision: claims.proposalRevision,
    candidateRevision: claims.candidateRevision,
    changeSetHash: claims.changeSetHash,
    sourceDigest: claims.sourceDigest,
    archiveDigest: claims.archiveDigest,
    buildOutputDigest: buildOutputDigest.toLowerCase(),
    outputArtifactKey: claims.outputArtifactKey,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
  };
  const payload = Buffer.from(
    canonicalPreviewBuildReceiptPayload(receipt),
    "utf8",
  );
  const signature = signBytes(
    null,
    Buffer.concat([DOMAIN, payload]),
    requireSigningKey(privateKeyPem),
  );
  return {
    receipt,
    token: `${payload.toString("base64url")}.${signature.toString("base64url")}`,
  };
}
