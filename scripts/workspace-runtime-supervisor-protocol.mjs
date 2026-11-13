import { createHash, randomUUID, sign, verify } from "node:crypto";

export const WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_VERSION = 1;
export const WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_TTL_MS = 15_000;
export const WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_MAX_TTL_MS = 30_000;
export const WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_CLOCK_SKEW_MS = 5_000;

const ACTIONS = new Set(["start", "adopt", "stop", "observe-start"]);
const HEX_256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createWorkspaceRuntimeSupervisorCommand(input) {
  const issuedAt = input.now ?? Date.now();
  const body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  if (!body) throw new Error("Supervisor command body is required.");
  const envelope = {
    version: WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_VERSION,
    commandId: randomUUID(),
    nonce: randomUUID(),
    issuedAt,
    expiresAt: issuedAt + WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_TTL_MS,
    action: input.action,
    projectId: input.projectId,
    sessionId: input.sessionId ?? null,
    stateVersion: input.stateVersion,
    processIdentity: input.processIdentity ?? null,
    bodySha256: sha256(Buffer.from(body, "utf8")),
  };
  const envelopeBytes = Buffer.from(JSON.stringify(envelope), "utf8");
  const signature = sign(null, envelopeBytes, input.privateKey);
  return {
    body,
    encodedCommand: envelopeBytes.toString("base64url"),
    signature: signature.toString("base64url"),
    envelope,
  };
}

export function verifyWorkspaceRuntimeSupervisorCommand(input) {
  const encoded = input.encodedCommand;
  const signatureText = input.signature;
  if (
    typeof encoded !== "string"
    || encoded.length < 16
    || encoded.length > 8_192
    || typeof signatureText !== "string"
    || signatureText.length < 80
    || signatureText.length > 256
    || !/^[A-Za-z0-9_-]+$/.test(encoded)
    || !/^[A-Za-z0-9_-]+$/.test(signatureText)
  ) {
    throw Object.assign(new Error("Supervisor command authentication is invalid."), { status: 401 });
  }

  let envelopeBytes;
  let envelope;
  let signature;
  try {
    envelopeBytes = Buffer.from(encoded, "base64url");
    if (envelopeBytes.toString("base64url") !== encoded) throw new Error("Non-canonical command encoding.");
    signature = Buffer.from(signatureText, "base64url");
    if (signature.toString("base64url") !== signatureText) throw new Error("Non-canonical signature encoding.");
    envelope = JSON.parse(envelopeBytes.toString("utf8"));
  } catch {
    throw Object.assign(new Error("Supervisor command authentication is invalid."), { status: 401 });
  }

  if (!verify(null, envelopeBytes, input.publicKey, signature)) {
    throw Object.assign(new Error("Supervisor command signature is invalid."), { status: 401 });
  }

  const now = input.now ?? Date.now();
  const expectedKeys = [
    "version",
    "commandId",
    "nonce",
    "issuedAt",
    "expiresAt",
    "action",
    "projectId",
    "sessionId",
    "stateVersion",
    "processIdentity",
    "bodySha256",
  ];
  if (
    !envelope
    || typeof envelope !== "object"
    || Array.isArray(envelope)
    || Object.keys(envelope).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(envelope, key))
    || envelope.version !== WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_VERSION
    || !UUID.test(envelope.commandId)
    || !UUID.test(envelope.nonce)
    || !Number.isSafeInteger(envelope.issuedAt)
    || !Number.isSafeInteger(envelope.expiresAt)
    || envelope.expiresAt <= envelope.issuedAt
    || envelope.expiresAt - envelope.issuedAt > WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_MAX_TTL_MS
    || envelope.issuedAt > now + WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_CLOCK_SKEW_MS
    || envelope.expiresAt < now
    || !ACTIONS.has(envelope.action)
    || typeof envelope.projectId !== "string"
    || envelope.projectId.length < 1
    || envelope.projectId.length > 200
    || !(envelope.sessionId === null
      || (typeof envelope.sessionId === "string" && envelope.sessionId.length >= 1 && envelope.sessionId.length <= 200))
    || typeof envelope.stateVersion !== "string"
    || !HEX_256.test(envelope.stateVersion)
    || !HEX_256.test(envelope.bodySha256)
    || !(envelope.processIdentity === null
      || (typeof envelope.processIdentity === "object" && !Array.isArray(envelope.processIdentity)))
  ) {
    throw Object.assign(new Error("Supervisor command is expired or malformed."), { status: 401 });
  }

  const bodyBytes = Buffer.from(input.body, "utf8");
  if (sha256(bodyBytes) !== envelope.bodySha256) {
    throw Object.assign(new Error("Supervisor command body does not match its signature."), { status: 401 });
  }
  return envelope;
}
