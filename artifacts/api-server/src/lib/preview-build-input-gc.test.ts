import { describe, expect, it, vi } from "vitest";
import {
  collectLocalPreviewBuildInputsOnce,
  LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS,
  type PreviewBuildInputGcReference,
  type PreviewBuildInputGcRepository,
} from "./preview-build-input-gc.js";

const retentionMs = 24 * 60 * 60 * 1_000;
const graceMs = 60 * 60 * 1_000;
const now = new Date("2026-11-12T12:00:00.000Z");
const completedAt = new Date(now.getTime() - retentionMs - 1);
const reference: PreviewBuildInputGcReference = {
  jobId: "00000000-0000-8000-8000-000000000001",
  inputArtifactRefId: "00000000-0000-8000-8000-000000000002",
  archiveDigest: "a".repeat(64),
  inputArtifactKey: `build-inputs/${"b".repeat(64)}/${"a".repeat(64)}.zip`,
};

function makeRepository() {
  let state: "active" | "eligible_for_gc" | "deleting" | "deleted" = "active";
  let markedAt: Date | null = null;
  const repository: PreviewBuildInputGcRepository = {
    async markEligible(input) {
      if (
        state !== "active" ||
        completedAt.getTime() > input.now.getTime() - input.retentionMs ||
        input.retentionMs !== retentionMs
      ) {
        return 0;
      }
      state = "eligible_for_gc";
      markedAt = input.now;
      return 1;
    },
    async claimDue(input) {
      if (
        state === "deleting" &&
        markedAt &&
        markedAt.getTime() <=
          input.now.getTime() - LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS
      ) {
        markedAt = input.now;
        return [reference];
      }
      if (
        state !== "eligible_for_gc" ||
        !markedAt ||
        markedAt.getTime() > input.now.getTime() - input.graceMs
      ) {
        return [];
      }
      state = "deleting";
      markedAt = input.now;
      return [reference];
    },
    async markDeleted() {
      if (state === "deleted") return true;
      if (state !== "deleting") return false;
      state = "deleted";
      return true;
    },
  };
  return {
    repository,
    state: () => state,
  };
}

describe("local Preview input garbage collection", () => {
  it("collects an expired upload reservation and resumes after worker failure", async () => {
    const memory = makeRepository();
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("simulated process interruption"));
    const store = { remove };

    const marked = await collectLocalPreviewBuildInputsOnce({
      store,
      now,
      retentionMs,
      graceMs,
      repository: memory.repository,
    });
    expect(marked).toMatchObject({
      markedEligible: 1,
      deletedReferences: 0,
      failedReferences: 0,
    });
    expect(memory.state()).toBe("eligible_for_gc");
    expect(remove).not.toHaveBeenCalled();

    const dueAt = new Date(now.getTime() + graceMs);
    const interrupted = await collectLocalPreviewBuildInputsOnce({
      store,
      now: dueAt,
      retentionMs,
      graceMs,
      repository: memory.repository,
    });
    expect(interrupted).toMatchObject({
      deletedReferences: 0,
      failedReferences: 1,
    });
    expect(memory.state()).toBe("deleting");

    const beforeLease = await collectLocalPreviewBuildInputsOnce({
      store,
      now: new Date(dueAt.getTime() + LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS - 1),
      retentionMs,
      graceMs,
      repository: memory.repository,
    });
    expect(beforeLease.deletedReferences).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);

    const resumed = await collectLocalPreviewBuildInputsOnce({
      store,
      now: new Date(dueAt.getTime() + LOCAL_PREVIEW_INPUT_DELETE_LEASE_MS),
      retentionMs,
      graceMs,
      repository: memory.repository,
    });
    expect(resumed).toMatchObject({
      deletedReferences: 1,
      failedReferences: 0,
    });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(1, {
      objectKey: reference.inputArtifactKey,
      jobId: reference.jobId,
      artifactRefId: reference.inputArtifactRefId,
      expectedDigest: reference.archiveDigest,
    });
    expect(memory.state()).toBe("deleted");
  });

  it("rejects invalid retention and batch settings before touching the repository", async () => {
    const memory = makeRepository();
    await expect(
      collectLocalPreviewBuildInputsOnce({
        store: { remove: vi.fn() },
        now,
        retentionMs: -1,
        repository: memory.repository,
      }),
    ).rejects.toThrow("Preview input GC configuration is invalid.");
    expect(memory.state()).toBe("active");
  });
});
