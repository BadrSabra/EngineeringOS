/**
 * Unit tests for requireAuth/optionalAuth.
 *
 * requireAuth's own "NODE_ENV=test bypasses Clerk" behavior (see the
 * clerk-auth-testing memory note) means going through the real Express app
 * with supertest can never exercise the actual getAuth()-based branches —
 * config.nodeEnv is fixed to "test" for the whole vitest run. So these
 * tests reset the module registry and mock both "../config.js" and
 * "@clerk/express" per-case to exercise the production code paths
 * (unauthenticated 401, authenticated authContext shape) directly, and
 * separately confirm the documented test-mode bypass shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

function fakeReq(): Request {
  return {} as Request;
}

function fakeRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireAuth / optionalAuth — production code paths", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("../config.js");
    vi.doUnmock("@clerk/express");
  });

  it("requireAuth returns 401 and calls next() zero times when there is no session", async () => {
    vi.doMock("../config.js", () => ({ config: { nodeEnv: "production", isProduction: true } }));
    vi.doMock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));

    const { requireAuth } = await import("./requireAuth.js");
    const req = fakeReq();
    const res = fakeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
    expect(req.authContext).toBeUndefined();
  });

  it("requireAuth attaches a consistent authContext and req.userId when a session exists", async () => {
    vi.doMock("../config.js", () => ({ config: { nodeEnv: "production", isProduction: true } }));
    vi.doMock("@clerk/express", () => ({
      getAuth: () => ({ userId: "user_123", sessionId: "sess_abc", orgId: "org_xyz" }),
    }));

    const { requireAuth } = await import("./requireAuth.js");
    const req = fakeReq();
    const res = fakeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.userId).toBe("user_123");
    expect(req.authContext).toEqual({
      userId: "user_123",
      sessionId: "sess_abc",
      orgId: "org_xyz",
      isAuthenticated: true,
    });
  });

  it("requireAuth normalizes missing sessionId/orgId to null rather than undefined", async () => {
    vi.doMock("../config.js", () => ({ config: { nodeEnv: "production", isProduction: true } }));
    vi.doMock("@clerk/express", () => ({ getAuth: () => ({ userId: "user_123" }) }));

    const { requireAuth } = await import("./requireAuth.js");
    const req = fakeReq();
    const next = vi.fn();

    requireAuth(req, fakeRes(), next);

    expect(req.authContext).toEqual({
      userId: "user_123",
      sessionId: null,
      orgId: null,
      isAuthenticated: true,
    });
  });

  it("optionalAuth calls next() without rejecting when there is no session", async () => {
    vi.doMock("../config.js", () => ({ config: { nodeEnv: "production", isProduction: true } }));
    vi.doMock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));

    const { optionalAuth } = await import("./requireAuth.js");
    const req = fakeReq();
    const res = fakeRes();
    const next = vi.fn();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.authContext).toBeUndefined();
    expect(req.userId).toBeUndefined();
  });

  it("optionalAuth attaches the same authContext shape as requireAuth when a session exists", async () => {
    vi.doMock("../config.js", () => ({ config: { nodeEnv: "production", isProduction: true } }));
    vi.doMock("@clerk/express", () => ({
      getAuth: () => ({ userId: "user_123", sessionId: "sess_abc", orgId: null }),
    }));

    const { optionalAuth } = await import("./requireAuth.js");
    const req = fakeReq();
    const next = vi.fn();

    optionalAuth(req, fakeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe("user_123");
    expect(req.authContext).toEqual({
      userId: "user_123",
      sessionId: "sess_abc",
      orgId: null,
      isAuthenticated: true,
    });
  });
});

describe("requireAuth — NODE_ENV=test bypass (documented synthetic-user path)", () => {
  it("attaches the same authContext shape the real branch would, with a fixed synthetic user", async () => {
    // No mocking here: this exercises the actual test-env config, i.e. the
    // exact bypass every other route test in this package relies on. Reset
    // the module registry first — the previous describe block leaves a
    // cached module instance built against mocked "../config.js"/
    // "@clerk/express", and resetModules() is the only way to force a
    // fresh import that resolves the real, unmocked modules.
    vi.resetModules();
    const { requireAuth } = await import("./requireAuth.js");
    const req = fakeReq();
    const next = vi.fn();

    requireAuth(req, fakeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe("test-user");
    expect(req.authContext).toEqual({
      userId: "test-user",
      sessionId: null,
      orgId: null,
      isAuthenticated: true,
    });
  });
});
