import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { config } from "../config.js";
import type { AuthContext } from "../types/express.js";

/**
 * Requires a signed-in Clerk session, and authorizes *which* resources that
 * session may touch is a separate concern layered on top per-route (see
 * requireProjectAccess.ts) — this middleware only ever answers "is there a
 * valid session at all". There is no per-role (RBAC) layer yet within a
 * single authenticated user's access to their own resources.
 *
 * In the vitest test environment (NODE_ENV=test) there is no browser to
 * carry a Clerk session cookie, and route tests exercise the underlying
 * handlers directly via supertest. Bypass with a fixed synthetic user id so
 * those tests keep exercising real handler behavior instead of auth
 * plumbing. This path is unreachable in development/production because
 * config.ts validates NODE_ENV against a closed enum and dev/prod never set
 * it to "test". The bypass still builds a real `authContext` so tests
 * exercise the same shape production code sees.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.nodeEnv === "test") {
    attachAuthContext(req, {
      userId: "test-user",
      sessionId: null,
      orgId: null,
      isAuthenticated: true,
    });
    next();
    return;
  }

  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  attachAuthContext(req, {
    userId: auth.userId,
    sessionId: auth.sessionId ?? null,
    orgId: auth.orgId ?? null,
    isAuthenticated: true,
  });
  next();
}

/**
 * Like `requireAuth`, but never rejects the request. Attaches `authContext`
 * (and `userId`) when a valid session is present, and leaves both undefined
 * otherwise. For routes that behave differently for signed-in vs anonymous
 * callers rather than requiring a session outright — none exist yet, but
 * the surface is here so a future public/preview route doesn't have to
 * reimplement session extraction from scratch.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  if (config.nodeEnv === "test") {
    // No implicit synthetic user here: unlike requireAuth, optionalAuth
    // must let tests exercise the genuinely-anonymous path too. Tests that
    // want an authenticated optionalAuth path should set req.authContext
    // themselves or call requireAuth first.
    next();
    return;
  }

  const auth = getAuth(req);
  if (auth?.userId) {
    attachAuthContext(req, {
      userId: auth.userId,
      sessionId: auth.sessionId ?? null,
      orgId: auth.orgId ?? null,
      isAuthenticated: true,
    });
  }
  next();
}

function attachAuthContext(req: Request, context: AuthContext): void {
  req.authContext = context;
  req.userId = context.userId;
}
