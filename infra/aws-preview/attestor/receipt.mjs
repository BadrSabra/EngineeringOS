import { createPrivateKey, randomUUID, sign as signBytes } from "node:crypto";

const DOMAIN_V1 = Buffer.from("EngineeringOS Preview Build Receipt v1\n");
const DOMAIN_V2 = Buffer.from("EngineeringOS Preview Build Receipt v2\n");
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
  const base = {
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
  };
  return JSON.stringify(
    receipt.version === 2
      ? {
          ...base,
          attemptId: receipt.attemptId,
          idempotencyKey: receipt.idempotencyKey,
          dispatchGeneration: receipt.dispatchGeneration,
        }
      : base,
  );
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
    ![1, 2].includes(claims.version) ||
    (claims.version === 2 &&
      (claims.attemptId !== claims.jobId ||
        typeof claims.idempotencyKey !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          claims.idempotencyKey,
        ) ||
        !Number.isSafeInteger(claims.dispatchGeneration) ||
        claims.dispatchGeneration < 1)) ||
    !HASH.test(buildOutputDigest) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new Error("Attestor receipt claims are invalid.");
  }
  const receipt = {
    version: claims.version,
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
    ...(claims.version === 2
      ? {
          attemptId: claims.attemptId,
          idempotencyKey: claims.idempotencyKey,
          dispatchGeneration: claims.dispatchGeneration,
        }
      : {}),
  };
  const payload = Buffer.from(
    canonicalPreviewBuildReceiptPayload(receipt),
    "utf8",
  );
  const signature = signBytes(
    null,
    Buffer.concat([receipt.version === 1 ? DOMAIN_V1 : DOMAIN_V2, payload]),
    requireSigningKey(privateKeyPem),
  );
  return {
    receipt,
    token: `${payload.toString("base64url")}.${signature.toString("base64url")}`,
  };
}
