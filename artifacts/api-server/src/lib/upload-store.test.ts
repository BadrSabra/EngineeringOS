import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectResults: unknown[][] = [];
const updateResults: unknown[][] = [];
const mockInsert = vi.fn();
const mockDelete = vi.fn();
const mockPut = vi.fn();
const mockDownload = vi.fn();
const mockObjectDelete = vi.fn();

const selectBuilder = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockImplementation(() => Promise.resolve(selectResults.shift() ?? [])),
  then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
};
const updateBuilder = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn().mockImplementation(() => Promise.resolve(updateResults.shift() ?? [])),
  then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(updateResults.shift() ?? []).then(resolve, reject),
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
    update: vi.fn(() => updateBuilder),
    delete: vi.fn(() => deleteBuilder),
  },
  uploadsTable: {
    id: "id",
    ownerId: "owner_id",
    extractedDir: "extracted_dir",
    storageKey: "storage_key",
    archiveFormat: "archive_format",
    state: "state",
    originalName: "original_name",
    createdAt: "created_at",
    expiresAt: "expires_at",
  },
}));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  registerUpload,
  lookupUpload,
  claimUpload,
  materializeClaimedUpload,
  removeUpload,
  sweepExpiredUploads,
  UPLOAD_TTL_MS,
} from "./upload-store.js";
import {
  createArchiveObjectKey,
  setArchiveObjectStorageForTests,
} from "./archive-object-storage.js";
import { archiveProcessingLimiter } from "./archive-safety.js";

function sqlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(sqlText).join("");
  if (!value || typeof value !== "object") return "";
  const record = value as { queryChunks?: unknown[]; value?: unknown[] };
  if (Array.isArray(record.queryChunks)) return record.queryChunks.map(sqlText).join("");
  if (Array.isArray(record.value)) return record.value.map(sqlText).join("");
  return "";
}

const now = () => new Date();
function makeRow(overrides: Record<string, unknown> = {}) {
  const createdAt = now();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ownerId: "owner-1",
    extractedDir: null,
    storageKey: createArchiveObjectKey(
      "owner-1",
      "11111111-1111-4111-8111-111111111111",
      "zip",
    ),
    archiveFormat: "zip",
    state: "active",
    originalName: "repo.zip",
    createdAt,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

let restoreStorage: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
  updateResults.length = 0;
  vi.stubEnv("PRIVATE_OBJECT_DIR", "/test-bucket/private");
  mockInsert.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  mockPut.mockResolvedValue(undefined);
  mockDownload.mockResolvedValue(undefined);
  mockObjectDelete.mockResolvedValue(undefined);
  restoreStorage = setArchiveObjectStorageForTests({
    put: mockPut,
    download: mockDownload,
    delete: mockObjectDelete,
  });
  selectBuilder.from.mockReturnThis();
  selectBuilder.where.mockReturnThis();
  selectBuilder.limit.mockImplementation(() => Promise.resolve(selectResults.shift() ?? []));
  updateBuilder.set.mockReturnThis();
  updateBuilder.where.mockReturnThis();
  updateBuilder.returning.mockImplementation(() => Promise.resolve(updateResults.shift() ?? []));
});

afterEach(() => {
  restoreStorage?.();
  restoreStorage = undefined;
  vi.unstubAllEnvs();
});

describe("registerUpload", () => {
  it("stores archive bytes under an owner-scoped private object key before activation", async () => {
    updateResults.push([{ id: "11111111-1111-4111-8111-111111111111" }]);
    await registerUpload(
      "11111111-1111-4111-8111-111111111111",
      "/tmp/archive.zip",
      "repo.zip",
      "owner-1",
      "zip",
    );

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertValues = insertBuilder.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertValues.createdAt).toBeUndefined();
    expect(sqlText(insertValues.expiresAt)).toContain("CURRENT_TIMESTAMP");
    expect(mockPut).toHaveBeenCalledOnce();
    const [objectKey] = mockPut.mock.calls[0];
    expect(objectKey).toContain("/engineeringos/archive-uploads/");
    expect(objectKey).toContain("/11111111-1111-4111-8111-111111111111/archive.zip");
    expect(updateBuilder.set).toHaveBeenCalledWith({ state: "active" });
    expect(UPLOAD_TTL_MS).toBeGreaterThan(0);
  });

  it("keeps a cleanup receipt when a partial object still cannot be removed", async () => {
    mockPut.mockRejectedValueOnce(new Error("upload interrupted"));
    updateResults.push([], []);
    selectResults.push([makeRow({ state: "retired" })]);
    mockObjectDelete.mockRejectedValue(new Error("object service unavailable"));

    await expect(registerUpload(
      "11111111-1111-4111-8111-111111111111",
      "/tmp/archive.zip",
      "repo.zip",
      "owner-1",
      "zip",
    )).rejects.toThrow("upload interrupted");

    expect(updateBuilder.set).toHaveBeenCalledWith({ state: "retired" });
    expect(mockObjectDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("upload ownership and claims", () => {
  it("does not reveal another user's archive or attempt object access", async () => {
    selectResults.push([]);
    await expect(lookupUpload("private-id", "different-user")).resolves.toBeUndefined();
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockObjectDelete).not.toHaveBeenCalled();
  });

  it("claims one active upload for discovery", async () => {
    updateResults.push([makeRow({ state: "claimed" })]);
    const entry = await claimUpload(
      "11111111-1111-4111-8111-111111111111",
      "owner-1",
    );
    expect(entry?.state).toBe("claimed");
    const claimUpdate = updateBuilder.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(claimUpdate.state).toBe("claimed");
    expect(sqlText(claimUpdate.expiresAt)).toContain("CURRENT_TIMESTAMP");
    expect(sqlText(updateBuilder.where.mock.calls[0]?.[0])).toContain("CURRENT_TIMESTAMP");
  });

  it("rejects another local archive extraction before claiming an upload", async () => {
    const release = archiveProcessingLimiter.tryAcquire();
    expect(release).toEqual(expect.any(Function));
    try {
      await expect(
        materializeClaimedUpload(
          "11111111-1111-4111-8111-111111111111",
          "owner-1",
        ),
      ).rejects.toMatchObject({
        status: 429,
      });
      expect(updateBuilder.set).not.toHaveBeenCalled();
    } finally {
      release?.();
    }
  });

  it("does not retire or delete an upload when a different owner requests removal", async () => {
    updateResults.push([]);
    selectResults.push([]);
    await removeUpload("private-id", "different-user");
    expect(mockObjectDelete).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("expiry and retryable cleanup", () => {
  it("retires an expired upload using the database expiry predicate", async () => {
    const row = makeRow({ expiresAt: new Date(Date.now() - 1), state: "active" });
    // An expired row is excluded by the SELECT predicate and retired with a
    // conditional UPDATE against PostgreSQL's current time.
    selectResults.push([]);
    updateResults.push([{ ...row, state: "retired" }]);

    await expect(lookupUpload(row.id, row.ownerId)).resolves.toBeUndefined();
    expect(sqlText(selectBuilder.where.mock.calls[0]?.[0])).toContain("CURRENT_TIMESTAMP");
    expect(sqlText(updateBuilder.where.mock.calls[0]?.[0])).toContain("CURRENT_TIMESTAMP");
    expect(updateBuilder.set).toHaveBeenCalledWith({ state: "retired" });
    expect(mockObjectDelete).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledOnce();
  });

  it("does not retire a claim renewed after the expiry sweep selected it", async () => {
    const selectedExpiredClaim = makeRow({
      state: "claimed",
      expiresAt: new Date(Date.now() - 1),
    });
    const renewedClaim = makeRow({
      state: "claimed",
      expiresAt: new Date(Date.now() + 60_000),
    });
    selectResults.push([selectedExpiredClaim], [renewedClaim]);
    // The conditional UPDATE affects zero rows because the claim was renewed
    // after the expiry query selected its stale snapshot.
    updateResults.push([]);

    await expect(sweepExpiredUploads()).resolves.toBe(0);

    expect(sqlText(selectBuilder.where.mock.calls[0]?.[0])).toContain("CURRENT_TIMESTAMP");
    expect(sqlText(updateBuilder.where.mock.calls[0]?.[0])).toContain("CURRENT_TIMESTAMP");
    expect(mockObjectDelete).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("retries retired object cleanup during the expiry sweep", async () => {
    const row = makeRow({ state: "retired" });
    selectResults.push([row], [row]);
    mockObjectDelete.mockRejectedValueOnce(new Error("temporary failure"));
    await expect(sweepExpiredUploads()).resolves.toBe(0);
    expect(mockObjectDelete).toHaveBeenCalledOnce();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
