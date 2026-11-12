import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPreviewAccessTicketService,
  PreviewAccessTicketError,
  type PreviewAccessTicketLedger,
  type PreviewAccessTicketRecord,
  type VerifiedPreviewSessionBinding,
} from "./preview-access-ticket.js";

const secret = "preview-ticket-test-secret-with-at-least-thirty-two-bytes";
const issuedAt = new Date("2026-11-11T00:00:00.000Z");
const binding: VerifiedPreviewSessionBinding = {
  userId: "user_test-owner",
  projectId: "project_test",
  previewSessionId: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
  proposalId: "proposal_test",
  proposalRevision: 3,
  candidateRevision: "a".repeat(64),
  changeSetHash: "b".repeat(64),
};

class MemoryTicketLedger implements PreviewAccessTicketLedger {
  isActive = true;
  readonly records = new Map<
    string,
    PreviewAccessTicketRecord & { consumedAt?: Date }
  >();

  async isBindingActive(): Promise<boolean> {
    return this.isActive;
  }

  async insert(record: PreviewAccessTicketRecord): Promise<void> {
    if (this.records.has(record.ticketDigest))
      throw new Error("duplicate ticket");
    this.records.set(record.ticketDigest, { ...record });
  }

  async consume(
    record: PreviewAccessTicketRecord,
    consumedAt: Date,
  ): Promise<boolean> {
    const stored = this.records.get(record.ticketDigest);
    if (
      !stored ||
      stored.consumedAt ||
      stored.expiresAt <= consumedAt ||
      stored.projectId !== record.projectId ||
      stored.userId !== record.userId ||
      stored.previewSessionId !== record.previewSessionId ||
      stored.proposalId !== record.proposalId ||
      stored.proposalRevision !== record.proposalRevision ||
      stored.candidateRevision !== record.candidateRevision ||
      stored.changeSetHash !== record.changeSetHash ||
      stored.issuedAt.getTime() !== record.issuedAt.getTime() ||
      stored.expiresAt.getTime() !== record.expiresAt.getTime()
    ) {
      return false;
    }
    stored.consumedAt = consumedAt;
    return true;
  }

  async pruneExpired(before: Date, limit: number): Promise<void> {
    let removed = 0;
    for (const [digest, record] of this.records) {
      if (record.expiresAt <= before && removed < limit) {
        this.records.delete(digest);
        removed += 1;
      }
    }
  }
}

function createService(
  ledger = new MemoryTicketLedger(),
  key: string | undefined = secret,
) {
  return {
    ledger,
    service: createPreviewAccessTicketService(ledger, () => key),
  };
}

function ticketIdFrom(token: string): string {
  const [payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    .ticketId as string;
}

describe("Preview access ticket", () => {
  it("stores only a digest and binds the short-lived ticket to a verified Candidate session", async () => {
    const { ledger, service } = createService();
    const result = await service.issue(binding, issuedAt);
    const ticketId = ticketIdFrom(result.ticket);
    const digest = createHash("sha256").update(ticketId).digest("hex");
    const stored = ledger.records.get(digest);

    expect(stored).toMatchObject({
      userId: binding.userId,
      projectId: binding.projectId,
      previewSessionId: binding.previewSessionId,
      proposalId: binding.proposalId,
      proposalRevision: binding.proposalRevision,
      candidateRevision: binding.candidateRevision,
      changeSetHash: binding.changeSetHash,
      ticketDigest: digest,
    });
    expect(stored).not.toHaveProperty("ticket");
    expect(result.expiresAt).toBe("2026-11-11T00:00:30.000Z");

    const claims = await service.redeem(
      result.ticket,
      new Date(issuedAt.getTime() + 1_000),
    );
    expect(claims.projectId).toBe(binding.projectId);
    expect(claims.candidateRevision).toBe(binding.candidateRevision);
    expect(stored?.consumedAt).toEqual(new Date(issuedAt.getTime() + 1_000));
  });

  it("allows exactly one concurrent redemption", async () => {
    const { service } = createService();
    const { ticket } = await service.issue(binding, issuedAt);
    const results = await Promise.allSettled([
      service.redeem(ticket, new Date(issuedAt.getTime() + 1_000)),
      service.redeem(ticket, new Date(issuedAt.getTime() + 1_000)),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("rejects altered, expired, and ledger-mismatched tickets without consuming a different binding", async () => {
    const { ledger, service } = createService();
    const { ticket } = await service.issue(binding, issuedAt);
    const [payload, signature] = ticket.split(".");
    const altered = `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

    await expect(
      service.redeem(altered, new Date(issuedAt.getTime() + 1_000)),
    ).rejects.toMatchObject({ code: "PREVIEW_TICKET_INVALID" });
    await expect(
      service.redeem(ticket, new Date(issuedAt.getTime() + 31_000)),
    ).rejects.toMatchObject({ code: "PREVIEW_TICKET_INVALID" });

    const digest = createHash("sha256")
      .update(ticketIdFrom(ticket))
      .digest("hex");
    const stored = ledger.records.get(digest);
    if (!stored) throw new Error("Issued ticket was not persisted.");
    stored.projectId = "another-project";

    await expect(
      service.redeem(ticket, new Date(issuedAt.getTime() + 1_000)),
    ).rejects.toMatchObject({ code: "PREVIEW_TICKET_INVALID" });
    expect(stored.consumedAt).toBeUndefined();
  });

  it("rejects malformed token input without touching the ledger", async () => {
    const { ledger, service } = createService();
    await expect(
      service.redeem(null as unknown as string, issuedAt),
    ).rejects.toMatchObject({ code: "PREVIEW_TICKET_INVALID" });
    expect(ledger.records.size).toBe(0);
  });

  it("fails closed when the signing secret is absent or too short", async () => {
    const missing = createPreviewAccessTicketService(
      new MemoryTicketLedger(),
      () => undefined,
    );
    await expect(missing.issue(binding, issuedAt)).rejects.toBeInstanceOf(
      PreviewAccessTicketError,
    );
    const weak = createService(new MemoryTicketLedger(), "short").service;
    await expect(weak.issue(binding, issuedAt)).rejects.toMatchObject({
      code: "PREVIEW_TICKET_UNAVAILABLE",
      status: 503,
    });
  });

  it("does not issue a ticket for an inactive or stale session", async () => {
    const ledger = new MemoryTicketLedger();
    ledger.isActive = false;
    const service = createPreviewAccessTicketService(ledger, () => secret);

    await expect(service.issue(binding, issuedAt)).rejects.toMatchObject({
      code: "PREVIEW_TICKET_INVALID",
    });
    expect(ledger.records.size).toBe(0);
  });

  it("rejects client-shaped or incomplete binding data before signing", async () => {
    const { service } = createService();
    await expect(
      service.issue(
        {
          ...binding,
          changeSetHash: "not-a-digest",
        },
        issuedAt,
      ),
    ).rejects.toMatchObject({
      code: "PREVIEW_TICKET_BINDING_INVALID",
      status: 400,
    });
  });
});
