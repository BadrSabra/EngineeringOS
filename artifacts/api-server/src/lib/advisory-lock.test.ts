import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { LockNamespace, tryAdvisoryLock } from "./advisory-lock.js";

describe("archive admission advisory lock", () => {
  it("allows only one independent PostgreSQL session to own the same archive slot", async () => {
    const id = `archive-test-${randomUUID()}`;
    const first = await tryAdvisoryLock(LockNamespace.ARCHIVE_UPLOAD, id);
    expect(first.acquired).toBe(true);
    if (!first.acquired) return;

    let firstHeld = true;
    try {
      const competing = await tryAdvisoryLock(LockNamespace.ARCHIVE_UPLOAD, id);
      expect(competing.acquired).toBe(false);

      await first.release();
      firstHeld = false;
      const afterRelease = await tryAdvisoryLock(LockNamespace.ARCHIVE_UPLOAD, id);
      expect(afterRelease.acquired).toBe(true);
      if (afterRelease.acquired) await afterRelease.release();
    } finally {
      if (firstHeld) await first.release();
    }
  });
});
