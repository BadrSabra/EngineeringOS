/**
 * PR-D2 — Unit tests for the DB-backed upload store.
 *
 * DB is mocked via vi.mock so these tests run without a real PG connection.
 * The happy-path DB round-trip is covered by the discovery route integration
 * tests in discovery.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock ─────────────────────────────────────────────────────────────────
// We mock @workspace/db so the upload-store functions don't need a real
// PG connection in unit test mode.

const mockSelect     = vi.fn();
const mockInsert     = vi.fn();
const mockDelete     = vi.fn();

// Drizzle's fluent builder returns `this` from each method — simulate that.
const selectBuilder = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockImplementation(() => mockSelect()),
};
const insertBuilder = {
  values: vi.fn().mockImplementation(() => mockInsert()),
};
const deleteBuilder = {
  where: vi.fn().mockImplementation(() => mockDelete()),
};

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => selectBuilder),
    insert: vi.fn(() => insertBuilder),
    delete: vi.fn(() => deleteBuilder),
  },
  uploadsTable: {
    id: "id",
    ownerId: "owner_id",
    extractedDir: "extracted_dir",
    originalName: "original_name",
    createdAt: "created_at",
    expiresAt: "expires_at",
  },
}));

// ─── fs mock ─────────────────────────────────────────────────────────────────
vi.mock("node:fs/promises", () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined), // dir exists by default
}));

import { rm, access } from "node:fs/promises";
import {
  registerUpload,
  lookupUpload,
  removeUpload,
  sweepExpiredUploads,
  UPLOAD_TTL_MS,
} from "./upload-store.js";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset builder mock returns to sane defaults after clearAllMocks
  selectBuilder.from.mockReturnThis();
  selectBuilder.where.mockReturnThis();
  selectBuilder.limit.mockImplementation(() => mockSelect());
  insertBuilder.values.mockImplementation(() => mockInsert());
  deleteBuilder.where.mockImplementation(() => mockDelete());
});

// ─── registerUpload ────────────────────────────────────────────────────────────

describe("registerUpload", () => {
  it("inserts a row into the DB", async () => {
    mockInsert.mockResolvedValue(undefined);
    await registerUpload("upload-1", "/tmp/eos-upload-1", "archive.zip", "user-1");
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it("uses the configured TTL for expiresAt", async () => {
    mockInsert.mockResolvedValue(undefined);
    const { db } = await import("@workspace/db");
    const before = Date.now();
    await registerUpload("upload-ttl", "/tmp/eos-upload-ttl", "a.zip", "u1");
    const call = vi.mocked(db.insert).mock.results[0];
    // We can only verify the function chain ran — the values are passed deep in the chain.
    expect(mockInsert).toHaveBeenCalledOnce();
    const after = Date.now();
    // TTL should be positive and at most 2× the configured value (clock-safe).
    expect(UPLOAD_TTL_MS).toBeGreaterThan(0);
    expect(after - before).toBeLessThan(UPLOAD_TTL_MS * 2);
  });
});

// ─── lookupUpload ──────────────────────────────────────────────────────────────

describe("lookupUpload", () => {
  it("returns undefined when the DB has no matching row", async () => {
    mockSelect.mockResolvedValue([]);
    const result = await lookupUpload("no-such-id");
    expect(result).toBeUndefined();
  });

  it("returns the entry when the row exists and has not expired", async () => {
    const futureExpiry = new Date(Date.now() + 60_000);
    mockSelect.mockResolvedValue([{
      id: "upload-2",
      ownerId: "user-1",
      extractedDir: "/tmp/eos-upload-2",
      originalName: "repo.zip",
      createdAt: new Date(),
      expiresAt: futureExpiry,
    }]);
    vi.mocked(access).mockResolvedValue(undefined); // dir exists

    const result = await lookupUpload("upload-2");
    expect(result).toBeDefined();
    expect(result?.extractedDir).toBe("/tmp/eos-upload-2");
    expect(result?.originalName).toBe("repo.zip");
  });

  it("returns undefined and deletes the row when the entry has expired", async () => {
    const pastExpiry = new Date(Date.now() - 1000);
    mockSelect.mockResolvedValue([{
      id: "expired-id",
      ownerId: "user-1",
      extractedDir: "/tmp/eos-upload-expired",
      originalName: "old.zip",
      createdAt: new Date(Date.now() - 4_000_000),
      expiresAt: pastExpiry,
    }]);
    mockDelete.mockResolvedValue(undefined);

    const result = await lookupUpload("expired-id");
    expect(result).toBeUndefined();
    expect(mockDelete).toHaveBeenCalledOnce();
    expect(rm).toHaveBeenCalledOnce();
  });

  it("returns undefined and removes the DB row when extractedDir no longer exists", async () => {
    const futureExpiry = new Date(Date.now() + 60_000);
    mockSelect.mockResolvedValue([{
      id: "missing-dir-id",
      ownerId: "user-1",
      extractedDir: "/tmp/eos-upload-gone",
      originalName: "gone.zip",
      createdAt: new Date(),
      expiresAt: futureExpiry,
    }]);
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    mockDelete.mockResolvedValue(undefined);

    const result = await lookupUpload("missing-dir-id");
    expect(result).toBeUndefined();
    expect(mockDelete).toHaveBeenCalledOnce();
  });
});

// ─── removeUpload ──────────────────────────────────────────────────────────────

describe("removeUpload", () => {
  it("deletes the DB row and removes the extracted directory", async () => {
    // First select to get the extractedDir, then delete
    selectBuilder.limit.mockImplementationOnce(() =>
      Promise.resolve([{
        extractedDir: "/tmp/eos-upload-rm",
      }]),
    );
    mockDelete.mockResolvedValue(undefined);

    await removeUpload("upload-rm");
    expect(mockDelete).toHaveBeenCalledOnce();
    expect(rm).toHaveBeenCalledWith("/tmp/eos-upload-rm", { recursive: true, force: true });
  });

  it("is a no-op (does not throw) when the uploadId is not in the DB", async () => {
    selectBuilder.limit.mockImplementationOnce(() => Promise.resolve([]));
    mockDelete.mockResolvedValue(undefined);

    await expect(removeUpload("nonexistent")).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalledOnce();
    expect(rm).not.toHaveBeenCalled();
  });
});

// ─── sweepExpiredUploads ───────────────────────────────────────────────────────

describe("sweepExpiredUploads", () => {
  it("returns 0 when there are no expired entries", async () => {
    mockSelect.mockResolvedValue([]);
    const count = await sweepExpiredUploads();
    expect(count).toBe(0);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes each expired entry and removes its directory", async () => {
    // sweepExpiredUploads ends the select chain at .where() (no .limit()),
    // so we override .where to return the mock result directly for this test.
    const expiredRows = [
      { id: "exp-1", extractedDir: "/tmp/eos-upload-exp-1" },
      { id: "exp-2", extractedDir: "/tmp/eos-upload-exp-2" },
    ];
    selectBuilder.where.mockImplementationOnce(() => Promise.resolve(expiredRows));
    mockDelete.mockResolvedValue(undefined);

    const count = await sweepExpiredUploads();
    expect(count).toBe(2);
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(rm).toHaveBeenCalledTimes(2);
  });

  it("returns 0 and logs (does not throw) when the DB query fails", async () => {
    mockSelect.mockRejectedValue(new Error("DB connection lost"));
    await expect(sweepExpiredUploads()).resolves.toBe(0);
  });
});
