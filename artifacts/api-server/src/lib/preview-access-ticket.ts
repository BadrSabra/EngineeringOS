import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod/v4";

const TICKET_VERSION = 1;
const TICKET_ISSUER = "engineeringos-api";
const TICKET_AUDIENCE = "engineeringos-preview-gateway";
const TICKET_LIFETIME_SECONDS = 30;
const MAX_TOKEN_LENGTH = 4096;
const MAX_PRUNE_ROWS = 200;
const SIGNING_CONTEXT = "EngineeringOS/preview-access-ticket/v1";

const bindingSchema = z
  .object({
    userId: z.string().min(1).max(255),
    projectId: z.string().min(1).max(255),
    previewSessionId: z.string().uuid(),
    proposalId: z.string().min(1).max(255),
    proposalRevision: z.number().int().nonnegative(),
    candidateRevision: z.string().min(1).max(160),
    changeSetHash: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

const claimsSchema = z
  .object({
    version: z.literal(TICKET_VERSION),
    issuer: z.literal(TICKET_ISSUER),
    audience: z.literal(TICKET_AUDIENCE),
    ticketId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    userId: z.string().min(1).max(255),
    projectId: z.string().min(1).max(255),
    previewSessionId: z.string().uuid(),
    proposalId: z.string().min(1).max(255),
    proposalRevision: z.number().int().nonnegative(),
    candidateRevision: z.string().min(1).max(160),
    changeSetHash: z.string().regex(/^[a-f0-9]{64}$/i),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type VerifiedPreviewSessionBinding = z.infer<typeof bindingSchema>;
export type PreviewAccessTicketClaims = z.infer<typeof claimsSchema>;

export type PreviewAccessTicketRecord = VerifiedPreviewSessionBinding & {
  ticketDigest: string;
  issuedAt: Date;
  expiresAt: Date;
};

export interface PreviewAccessTicketLedger {
  isBindingActive(
    binding: VerifiedPreviewSessionBinding,
    now: Date,
  ): Promise<boolean>;
  insert(record: PreviewAccessTicketRecord): Promise<void>;
  consume(
    record: PreviewAccessTicketRecord,
    consumedAt: Date,
  ): Promise<boolean>;
  pruneExpired(before: Date, limit: number): Promise<void>;
}

export class PreviewAccessTicketError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_TICKET_UNAVAILABLE"
      | "PREVIEW_TICKET_INVALID"
      | "PREVIEW_TICKET_BINDING_INVALID",
    readonly status: 400 | 401 | 503,
  ) {
    super(
      code === "PREVIEW_TICKET_UNAVAILABLE"
        ? "Preview ticket signing is unavailable."
        : code === "PREVIEW_TICKET_BINDING_INVALID"
          ? "Preview ticket binding is invalid."
          : "Preview access ticket is invalid, expired, or already used.",
    );
    this.name = "PreviewAccessTicketError";
  }
}

function signingKey(secret: string | undefined): Buffer {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new PreviewAccessTicketError("PREVIEW_TICKET_UNAVAILABLE", 503);
  }

  // Domain separation prevents this ticket key from being interchangeable
  // with other HMAC uses of SESSION_SECRET.
  return createHmac("sha256", secret).update(SIGNING_CONTEXT).digest();
}

function digestTicketId(ticketId: string): string {
  return createHash("sha256").update(ticketId, "utf8").digest("hex");
}

function encodeBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return encodeBase64Url(decoded) === value ? decoded : undefined;
}

function signClaims(claims: PreviewAccessTicketClaims, key: Buffer): string {
  const payload = encodeBase64Url(Buffer.from(JSON.stringify(claims), "utf8"));
  const signature = createHmac("sha256", key).update(payload).digest();
  return `${payload}.${encodeBase64Url(signature)}`;
}

function verifyClaims(
  token: string,
  key: Buffer,
  nowSeconds: number,
): PreviewAccessTicketClaims {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH
  ) {
    throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
  }

  const separator = token.indexOf(".");
  if (separator <= 0 || separator !== token.lastIndexOf(".")) {
    throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
  }

  const payloadSegment = token.slice(0, separator);
  const signatureSegment = token.slice(separator + 1);
  const payloadBytes = decodeCanonicalBase64Url(payloadSegment);
  const signatureBytes = decodeCanonicalBase64Url(signatureSegment);
  if (!payloadBytes || !signatureBytes) {
    throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
  }

  const expectedSignature = createHmac("sha256", key)
    .update(payloadSegment)
    .digest();
  if (
    signatureBytes.length !== expectedSignature.length ||
    !timingSafeEqual(signatureBytes, expectedSignature)
  ) {
    throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
  }

  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
  }

  const claims = parsed.data;
  if (
    claims.expiresAt <= nowSeconds ||
    claims.issuedAt > nowSeconds + 5 ||
    claims.expiresAt <= claims.issuedAt ||
    claims.expiresAt - claims.issuedAt > TICKET_LIFETIME_SECONDS
  ) {
    throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
  }
  return claims;
}

export function createPreviewAccessTicketService(
  ledger: PreviewAccessTicketLedger,
  getSecret: () => string | undefined,
) {
  return {
    async issue(
      bindingInput: VerifiedPreviewSessionBinding,
      now = new Date(),
    ): Promise<{ ticket: string; expiresAt: string }> {
      const binding = bindingSchema.safeParse(bindingInput);
      if (!binding.success || !Number.isFinite(now.getTime())) {
        throw new PreviewAccessTicketError(
          "PREVIEW_TICKET_BINDING_INVALID",
          400,
        );
      }

      const key = signingKey(getSecret());
      const issuedAt = Math.floor(now.getTime() / 1000);
      if (issuedAt <= 0) {
        throw new PreviewAccessTicketError(
          "PREVIEW_TICKET_BINDING_INVALID",
          400,
        );
      }

      const expiresAt = issuedAt + TICKET_LIFETIME_SECONDS;
      const issuedAtDate = new Date(issuedAt * 1000);
      if (!(await ledger.isBindingActive(binding.data, issuedAtDate))) {
        throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
      }
      const ticketId = randomBytes(32).toString("base64url");
      const claims = claimsSchema.parse({
        version: TICKET_VERSION,
        issuer: TICKET_ISSUER,
        audience: TICKET_AUDIENCE,
        ticketId,
        ...binding.data,
        issuedAt,
        expiresAt,
      });
      const expiresAtDate = new Date(expiresAt * 1000);

      await ledger.pruneExpired(issuedAtDate, MAX_PRUNE_ROWS);
      await ledger.insert({
        ...binding.data,
        ticketDigest: digestTicketId(ticketId),
        issuedAt: issuedAtDate,
        expiresAt: expiresAtDate,
      });

      return {
        ticket: signClaims(claims, key),
        expiresAt: expiresAtDate.toISOString(),
      };
    },

    async redeem(
      token: string,
      now = new Date(),
    ): Promise<PreviewAccessTicketClaims> {
      if (!Number.isFinite(now.getTime())) {
        throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
      }
      const nowSeconds = Math.floor(now.getTime() / 1000);
      const claims = verifyClaims(token, signingKey(getSecret()), nowSeconds);
      const record: PreviewAccessTicketRecord = {
        userId: claims.userId,
        projectId: claims.projectId,
        previewSessionId: claims.previewSessionId,
        proposalId: claims.proposalId,
        proposalRevision: claims.proposalRevision,
        candidateRevision: claims.candidateRevision,
        changeSetHash: claims.changeSetHash,
        ticketDigest: digestTicketId(claims.ticketId),
        issuedAt: new Date(claims.issuedAt * 1000),
        expiresAt: new Date(claims.expiresAt * 1000),
      };
      const consumed = await ledger.consume(
        record,
        new Date(nowSeconds * 1000),
      );
      if (!consumed) {
        throw new PreviewAccessTicketError("PREVIEW_TICKET_INVALID", 401);
      }
      return claims;
    },
  };
}
