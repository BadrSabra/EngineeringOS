import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  lte,
  or,
} from "drizzle-orm";
import {
  db,
  previewBuildJobsTable,
} from "@workspace/db";
import { lockPreviewArtifactDigest } from "./preview-artifact-db-lock.js";
import type { LocalPreviewBuildInputObjectStore } from "./preview-build-input-local.js";
import type { PreviewBuildJobStatus } from "./preview-build-job-state.js";

export const LOCAL_PREVIEW_INPUT_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const LOCAL_PREVIEW_INPUT_DELETE_GRACE_MS = 60 * 60 * 1_000;
export const LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS = 15 * 60 * 1_000;
const DEFAULT_BATCH_SIZE = 50;
const TERMINAL_BUILD_STATUSES: PreviewBuildJobStatus[] = [
  "verified",
  "failed",
  "expired",
  "cancelled",
];

export type PreviewBuildInputGcReference = {
  jobId: string;
  inputArtifactRefId: string;
  archiveDigest: string;
  inputArtifactKey: string;
};

export type PreviewBuildInputGcRepository = {
  markEligible(input: {
    now: Date;
    retentionMs: number;
    batchSize: number;
  }): Promise<number>;
  claimDue(input: {
    now: Date;
    graceMs: number;
    retentionMs: number;
    batchSize: number;
  }): Promise<PreviewBuildInputGcReference[]>;
  markDeleted(input: {
    reference: PreviewBuildInputGcReference;
    now: Date;
  }): Promise<boolean>;
};

export type PreviewBuildInputGcResult = {
  markedEligible: number;
  deletedReferences: number;
  deferredReferences: number;
  failedReferences: number;
};

function validBatchSize(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 500;
}

function isRetentionEligible(
  job: {
    status: PreviewBuildJobStatus;
    completedAt: Date | null;
  },
  cutoff: Date,
): boolean {
  return (
    TERMINAL_BUILD_STATUSES.includes(job.status) &&
    job.completedAt !== null &&
    job.completedAt.getTime() <= cutoff.getTime()
  );
}

const databaseRepository: PreviewBuildInputGcRepository = {
  async markEligible({ now, retentionMs, batchSize }) {
    const cutoff = new Date(now.getTime() - retentionMs);
    const candidates = await db
      .select({
        archiveDigest: previewBuildJobsTable.archiveDigest,
      })
      .from(previewBuildJobsTable)
      .where(
        and(
          eq(previewBuildJobsTable.inputArtifactProvider, "local"),
          eq(previewBuildJobsTable.inputArtifactGcState, "active"),
          isNotNull(previewBuildJobsTable.completedAt),
          inArray(previewBuildJobsTable.status, TERMINAL_BUILD_STATUSES),
          lte(previewBuildJobsTable.completedAt, cutoff),
        ),
      )
      .orderBy(asc(previewBuildJobsTable.completedAt))
      .limit(batchSize);

    let marked = 0;
    for (const { archiveDigest } of candidates) {
      marked += await db.transaction(async (tx) => {
        await lockPreviewArtifactDigest(tx, archiveDigest);
        const rows = await tx
          .select()
          .from(previewBuildJobsTable)
          .where(
            and(
              eq(previewBuildJobsTable.archiveDigest, archiveDigest),
              eq(previewBuildJobsTable.inputArtifactProvider, "local"),
            ),
          )
          .for("update");
        if (
          rows.length === 0 ||
          rows.some((row) => !isRetentionEligible(row, cutoff)) ||
          rows.some((row) => row.inputArtifactGcState === "deleting")
        ) {
          return 0;
        }

        const [result] = await tx
          .update(previewBuildJobsTable)
          .set({
            inputArtifactGcState: "eligible_for_gc",
            inputArtifactGcMarkedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(previewBuildJobsTable.archiveDigest, archiveDigest),
              eq(previewBuildJobsTable.inputArtifactProvider, "local"),
              eq(previewBuildJobsTable.inputArtifactGcState, "active"),
            ),
          )
          .returning({ jobId: previewBuildJobsTable.jobId });
        return result ? 1 : 0;
      });
    }
    return marked;
  },

  async claimDue({ now, graceMs, retentionMs, batchSize }) {
    const graceCutoff = new Date(now.getTime() - graceMs);
    const leaseCutoff = new Date(
      now.getTime() - LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS,
    );
    const candidates = await db
      .select({
        jobId: previewBuildJobsTable.jobId,
        archiveDigest: previewBuildJobsTable.archiveDigest,
        inputArtifactKey: previewBuildJobsTable.inputArtifactKey,
        inputArtifactRefId: previewBuildJobsTable.inputArtifactRefId,
      })
      .from(previewBuildJobsTable)
      .where(
        and(
          eq(previewBuildJobsTable.inputArtifactProvider, "local"),
          or(
            and(
              eq(
                previewBuildJobsTable.inputArtifactGcState,
                "eligible_for_gc",
              ),
              lte(previewBuildJobsTable.inputArtifactGcMarkedAt, graceCutoff),
            ),
            and(
              eq(previewBuildJobsTable.inputArtifactGcState, "deleting"),
              lte(previewBuildJobsTable.inputArtifactGcMarkedAt, leaseCutoff),
            ),
          ),
        ),
      )
      .orderBy(asc(previewBuildJobsTable.inputArtifactGcMarkedAt))
      .limit(batchSize);

    const claimed = new Map<string, PreviewBuildInputGcReference>();
    for (const {
      jobId,
      archiveDigest,
      inputArtifactKey,
      inputArtifactRefId,
    } of candidates) {
      if (!inputArtifactRefId) continue;
      const claimKey = `${jobId}:${inputArtifactRefId}`;
      if (claimed.has(claimKey)) continue;
      const references = await db.transaction(async (tx) => {
        await lockPreviewArtifactDigest(tx, archiveDigest);
        const rows = await tx
          .select()
          .from(previewBuildJobsTable)
          .where(
            and(
              eq(previewBuildJobsTable.archiveDigest, archiveDigest),
              eq(previewBuildJobsTable.inputArtifactProvider, "local"),
            ),
          )
          .for("update");
        if (
          rows.length === 0 ||
          rows.some((row) => row.inputArtifactGcState === "active")
        ) {
          return [];
        }
        const targetRows = rows.filter(
          (row) =>
            row.jobId === jobId &&
            row.inputArtifactRefId === inputArtifactRefId &&
            row.inputArtifactKey === inputArtifactKey,
        );
        if (
          targetRows.length === 0 ||
          targetRows.some((row) =>
            !isRetentionEligible(row, new Date(now.getTime() - retentionMs)),
          ) ||
          targetRows.some(
            (row) =>
              row.inputArtifactGcState === "eligible_for_gc" &&
              (!row.inputArtifactGcMarkedAt ||
                row.inputArtifactGcMarkedAt.getTime() > graceCutoff.getTime()),
          ) ||
          targetRows.some(
            (row) =>
              row.inputArtifactGcState === "deleting" &&
              (!row.inputArtifactGcMarkedAt ||
                row.inputArtifactGcMarkedAt.getTime() > leaseCutoff.getTime()),
          ) ||
          targetRows.every(
            (row) => row.inputArtifactGcState === "deleted",
          )
        ) {
          return [];
        }
        await tx
          .update(previewBuildJobsTable)
          .set({
            inputArtifactGcState: "deleting",
            inputArtifactGcMarkedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(previewBuildJobsTable.jobId, jobId),
              eq(
                previewBuildJobsTable.inputArtifactRefId,
                inputArtifactRefId,
              ),
              eq(previewBuildJobsTable.archiveDigest, archiveDigest),
              eq(previewBuildJobsTable.inputArtifactProvider, "local"),
              eq(previewBuildJobsTable.inputArtifactKey, inputArtifactKey),
              inArray(previewBuildJobsTable.inputArtifactGcState, [
                "eligible_for_gc",
                "deleting",
              ]),
            ),
          );
        return [{ jobId, inputArtifactRefId, archiveDigest, inputArtifactKey }];
      });
      for (const reference of references) {
        claimed.set(
          `${reference.jobId}:${reference.inputArtifactRefId}`,
          reference,
        );
      }
    }
    return [...claimed.values()].slice(0, batchSize);
  },

  async markDeleted({ reference, now }) {
    return db.transaction(async (tx) => {
      await lockPreviewArtifactDigest(tx, reference.archiveDigest);
      const [updated] = await tx
        .update(previewBuildJobsTable)
        .set({
          inputArtifactGcState: "deleted",
          inputArtifactGcMarkedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(previewBuildJobsTable.jobId, reference.jobId),
            eq(
              previewBuildJobsTable.inputArtifactRefId,
              reference.inputArtifactRefId,
            ),
            eq(
              previewBuildJobsTable.inputArtifactKey,
              reference.inputArtifactKey,
            ),
            eq(previewBuildJobsTable.archiveDigest, reference.archiveDigest),
            eq(previewBuildJobsTable.inputArtifactProvider, "local"),
            eq(previewBuildJobsTable.inputArtifactGcState, "deleting"),
          ),
        )
        .returning({ jobId: previewBuildJobsTable.jobId });
      if (updated) return true;

      const [current] = await tx
        .select({ state: previewBuildJobsTable.inputArtifactGcState })
        .from(previewBuildJobsTable)
        .where(
          and(
            eq(previewBuildJobsTable.jobId, reference.jobId),
            eq(
              previewBuildJobsTable.inputArtifactRefId,
              reference.inputArtifactRefId,
            ),
            eq(
              previewBuildJobsTable.inputArtifactKey,
              reference.inputArtifactKey,
            ),
            eq(previewBuildJobsTable.archiveDigest, reference.archiveDigest),
            eq(previewBuildJobsTable.inputArtifactProvider, "local"),
          ),
        )
        .limit(1);
      return current?.state === "deleted";
    });
  },
};

/**
 * One resumable pass. A failed file removal intentionally leaves the durable
 * row in `deleting`; the next pass retries the same immutable object key.
 */
export async function collectLocalPreviewBuildInputsOnce(input: {
  store: Pick<LocalPreviewBuildInputObjectStore, "remove">;
  now?: Date;
  batchSize?: number;
  retentionMs?: number;
  graceMs?: number;
  repository?: PreviewBuildInputGcRepository;
}): Promise<PreviewBuildInputGcResult> {
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const retentionMs =
    input.retentionMs ?? LOCAL_PREVIEW_INPUT_RETENTION_MS;
  const graceMs =
    input.graceMs ?? LOCAL_PREVIEW_INPUT_DELETE_GRACE_MS;
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(retentionMs) ||
    retentionMs < 0 ||
    !Number.isSafeInteger(graceMs) ||
    graceMs < 0 ||
    !validBatchSize(batchSize)
  ) {
    throw new Error("Preview input GC configuration is invalid.");
  }

  const repository = input.repository ?? databaseRepository;
  const markedEligible = await repository.markEligible({
    now,
    retentionMs,
    batchSize,
  });
  const due = await repository.claimDue({
    now,
    graceMs,
    retentionMs,
    batchSize,
  });
  let deletedReferences = 0;
  let deferredReferences = 0;
  let failedReferences = 0;

  for (const reference of due) {
    try {
      await input.store.remove({
        objectKey: reference.inputArtifactKey,
        jobId: reference.jobId,
        artifactRefId: reference.inputArtifactRefId,
        expectedDigest: reference.archiveDigest,
      });
      if (await repository.markDeleted({ reference, now })) {
        deletedReferences += 1;
      } else {
        deferredReferences += 1;
      }
    } catch {
      failedReferences += 1;
    }
  }

  return {
    markedEligible,
    deletedReferences,
    deferredReferences,
    failedReferences,
  };
}
