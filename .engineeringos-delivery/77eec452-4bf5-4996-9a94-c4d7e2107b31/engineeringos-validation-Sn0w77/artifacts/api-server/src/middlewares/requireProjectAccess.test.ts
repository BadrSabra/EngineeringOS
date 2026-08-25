/**
 * Unit tests for requireProjectAccess / requireProjectWriteAccess.
 *
 * Both middlewares depend on a DB lookup, so we mock @workspace/db per-case
 * using vi.resetModules() + vi.doMock() + dynamic import() — the same
 * pattern used in requireAuth.test.ts.
 *
 * Coverage:
 *  requireProjectAccess:
 *    - missing / invalid projectId → 400
 *    - project not found → 404
 *    - project owned by a different user → 403
 *    - project found and owned → attaches req.project and calls next()
 *    - archived project → still allowed (read-only access is fine)
 *
 *  requireProjectWriteAccess:
 *    - project found and owned, non-archived → calls next()
 *    - project found and owned, archived → 403 (cannot mutate archived)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const OWNER = "user_owner";
const OTHER = "user_other";

function fakeReq(overrides: Partial<Request> = {}): Request {
  return { params: {}, userId: OWNER, ...overrides } as unknown as Request;
}

function fakeRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockDb(row: Record<string, unknown> | undefined) {
  vi.doMock("@workspace/db", () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(row ? [row] : []),
          }),
        }),
      }),
    },
    projectsTable: { id: "id" },
  }));
}

function makeProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "proj_1",
    ownerId: OWNER,
    name: "test-project",
    status: "active",
    ...overrides,
  };
}

// ─── requireProjectAccess ─────────────────────────────────────────────────────

describe("requireProjectAccess", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.clearAllMocks());

  it("returns 400 when projectId is missing", async () => {
    mockDb(undefined);
    const { requireProjectAccess } = await import("./requireProjectAccess.js");
    const req = fakeReq({ params: {} } as Partial<Request>);
    const res = fakeRes();
    const next = vi.fn();

    await requireProjectAccess(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 404 when no project row is found", async () => {
    mockDb(undefined);
    const { requireProjectAccess } = await import("./requireProjectAccess.js");
    const req = fakeReq({ params: { projectId: "proj_ghost" } } as Partial<Request>);
    const res = fakeRes();
    const next = vi.fn();

    await requireProjectAccess(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when project exists but belongs to a different user", async () => {
    mockDb(makeProject({ ownerId: OTHER }));
    const { requireProjectAccess } = await import("./requireProjectAccess.js");
    const req = fakeReq({ params: { projectId: "proj_1" } } as Partial<Request>);
    const res = fakeRes();
    const next = vi.fn();

    await requireProjectAccess(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.project and calls next() when ownership matches", async () => {
    const project = makeProject();
    mockDb(project);
    const { requireProjectAccess } = await import("./requireProjectAccess.js");
    const req = fakeReq({ params: { projectId: "proj_1" } } as Partial<Request>);
    const res = fakeRes();
    const next = vi.fn();

    await requireProjectAccess(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect((req as unknown as Record<string, unknown>).project).toEqual(project);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows read access on an archived project", async () => {
    mockDb(makeProject({ status: "archived" }));
    const { requireProjectAccess } = await import("./requireProjectAccess.js");
    const req = fakeReq({ params: { projectId: "proj_1" } } as Partial<Request>);
    const res = fakeRes();
    const next = vi.fn();

    await requireProjectAccess(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── requireProjectWriteAccess ────────────────────────────────────────────────

describe("requireProjectWriteAccess", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.clearAllMocks());

  it("attaches req.project and calls next() for an active project", async () => {
    const project = makeProject({ status: "active" });
    mockDb(project);
    const { requireProjectWriteAccess } = await import("./requireProjectAccess.js");
    const req = fakeReq({ params: { projectId: "proj_1" } } as Partial<Request>);
    const res = fakeRes();
    const next = vi.fn();

    await requireProjectWriteAccess(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect((req as unknown as Record<string, unknown>).project).toEqual(project);
  });

  it("attaches req.project and calls next() for a scanning project", async () => {
    mockDb(makeProject({ status: "scanning" }));
    const { requireProjectWriteAccess } = await import("./requireProjectAccess.js");
    const req = fakeReq({ params: { projectId: "proj_1" } } as Partial<Request>);
    const res = fakeRes();
    const next = vi.fn();

    await requireProjectWriteAccess(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 and does NOT call next() for an archived project", async () => {
    mockDb(makeProject({ status: "archived" }));
    const { requireProjectWriteAccess } = await import("./requireProjectAccess.js");
    const req = fakeReq({ params: { projectId: "proj_1" } } as Partial<Request>);
    const res = fakeRes();
    const next = vi.fn();

    await requireProjectWriteAccess(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("archived") }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("still returns 403 for wrong owner even if project is not archived", async () => {
    mockDb(makeProject({ ownerId: OTHER, status: "active" }));
    const { requireProjectWriteAccess } = await import("./requireProjectAccess.js");
    const req = fakeReq({ params: { projectId: "proj_1" } } as Partial<Request>);
    const res = fakeRes();
    const next = vi.fn();

    await requireProjectWriteAccess(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
