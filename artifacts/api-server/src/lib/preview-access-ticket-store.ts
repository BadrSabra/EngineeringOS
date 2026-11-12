import {
  and,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import {
  aiChangeProposalsTable,
  db,
  previewAccessTicketsTable,
  previewSessionsTable,
  projectsTable,
} from "@workspace/db";
import type {
  PreviewAccessTicketLedger,
  PreviewAccessTicketRecord,
  VerifiedPreviewSessionBinding,
} from "./preview-access-ticket.js";

const MAX_PRUNE_ROWS = 200;

function activePreviewSessionQuery(
  binding: VerifiedPreviewSessionBinding,
  now: Date,
) {
  return db
    .select({ id: previewSessionsTable.id })
    .from(previewSessionsTable)
    .innerJoin(
      aiChangeProposalsTable,
      eq(previewSessionsTable.proposalId, aiChangeProposalsTable.id),
    )
    .innerJoin(
      projectsTable,
      eq(aiChangeProposalsTable.projectId, projectsTable.id),
    )
    .where(
      and(
        eq(previewSessionsTable.id, binding.previewSessionId),
        eq(previewSessionsTable.proposalId, binding.proposalId),
        eq(previewSessionsTable.userId, binding.userId),
        eq(previewSessionsTable.proposalRevision, binding.proposalRevision),
        eq(previewSessionsTable.candidateRevision, binding.candidateRevision),
        eq(previewSessionsTable.changeSetHash, binding.changeSetHash),
        eq(previewSessionsTable.status, "ready"),
        isNotNull(previewSessionsTable.runnerTaskArn),
        gt(previewSessionsTable.expiresAt, now),
        eq(aiChangeProposalsTable.revision, binding.proposalRevision),
        eq(aiChangeProposalsTable.candidateTreeHash, binding.candidateRevision),
        eq(aiChangeProposalsTable.changeSetHash, binding.changeSetHash),
        eq(aiChangeProposalsTable.status, "pending"),
        inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"]),
        eq(projectsTable.id, binding.projectId),
        eq(projectsTable.ownerId, binding.userId),
      ),
    )
    .limit(1);
}

export const postgresPreviewAccessTicketLedger: PreviewAccessTicketLedger = {
  async isBindingActive(
    binding: VerifiedPreviewSessionBinding,
    now: Date,
  ): Promise<boolean> {
    const rows = await activePreviewSessionQuery(binding, now);
    return rows.length === 1;
  },

  async insert(record: PreviewAccessTicketRecord): Promise<void> {
    await db.insert(previewAccessTicketsTable).values({
      ticketDigest: record.ticketDigest,
      projectId: record.projectId,
      userId: record.userId,
      previewSessionId: record.previewSessionId,
      proposalId: record.proposalId,
      proposalRevision: record.proposalRevision,
      candidateRevision: record.candidateRevision,
      changeSetHash: record.changeSetHash,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
    });
  },

  async consume(
    record: PreviewAccessTicketRecord,
    consumedAt: Date,
  ): Promise<boolean> {
    const rows = await db
      .update(previewAccessTicketsTable)
      .set({ consumedAt })
      .where(
        and(
          eq(previewAccessTicketsTable.ticketDigest, record.ticketDigest),
          eq(previewAccessTicketsTable.projectId, record.projectId),
          eq(previewAccessTicketsTable.userId, record.userId),
          eq(
            previewAccessTicketsTable.previewSessionId,
            record.previewSessionId,
          ),
          eq(previewAccessTicketsTable.proposalId, record.proposalId),
          eq(
            previewAccessTicketsTable.proposalRevision,
            record.proposalRevision,
          ),
          eq(
            previewAccessTicketsTable.candidateRevision,
            record.candidateRevision,
          ),
          eq(previewAccessTicketsTable.changeSetHash, record.changeSetHash),
          eq(previewAccessTicketsTable.issuedAt, record.issuedAt),
          eq(previewAccessTicketsTable.expiresAt, record.expiresAt),
          gt(previewAccessTicketsTable.expiresAt, consumedAt),
          isNull(previewAccessTicketsTable.consumedAt),
          exists(activePreviewSessionQuery(record, consumedAt)),
        ),
      )
      .returning({ ticketDigest: previewAccessTicketsTable.ticketDigest });

    return rows.length === 1;
  },

  async pruneExpired(before: Date, limit: number): Promise<void> {
    const requestedLimit = Number.isSafeInteger(limit) ? limit : MAX_PRUNE_ROWS;
    const boundedLimit = Math.min(MAX_PRUNE_ROWS, Math.max(1, requestedLimit));
    await db.execute(sql`
      DELETE FROM ${previewAccessTicketsTable}
      WHERE ${previewAccessTicketsTable.ticketDigest} IN (
        SELECT ${previewAccessTicketsTable.ticketDigest}
        FROM ${previewAccessTicketsTable}
        WHERE ${previewAccessTicketsTable.expiresAt} <= ${before}
        ORDER BY ${previewAccessTicketsTable.expiresAt} ASC
        LIMIT ${boundedLimit}
      )
    `);
  },
};
