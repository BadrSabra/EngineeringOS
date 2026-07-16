import type { projectsTable } from "@workspace/db";

/**
 * Unified authentication context. Every middleware/route that needs to know
 * "who is making this request" should read this shape instead of pulling
 * individual fields off `req` or reaching into `@clerk/express`'s `getAuth`
 * directly — that keeps the auth provider an implementation detail confined
 * to `requireAuth`/`optionalAuth` (see middlewares/requireAuth.ts).
 *
 * `sessionId` and `orgId` are carried through now even though nothing reads
 * them yet, so that session-scoped invalidation or org/team-scoped access
 * (see the `role`/`organization` extension note below) can be added later
 * without another pass over every call site that consumes auth context.
 */
export interface AuthContext {
  userId: string;
  sessionId: string | null;
  orgId: string | null;
  isAuthenticated: true;
}

/**
 * Authentication/authorization context primitives attached to `Request` by
 * middleware, typed globally so route handlers never need local casts.
 *
 * - `userId` and `authContext` are set by `requireAuth`/`optionalAuth` (see
 *   middlewares/requireAuth.ts) — purely *authentication* primitives: "who
 *   is making this request". `userId` is kept alongside `authContext` (a
 *   duplicate of `authContext.userId`) because existing routes already read
 *   `req.userId` directly; new code should prefer `req.authContext`.
 * - `project` is set by `requireProjectAccess`/`requireProjectWriteAccess`
 *   (see middlewares/requireProjectAccess.ts) — an *authorization*
 *   primitive for routes keyed on `:projectId`, attached only after
 *   ownership is verified.
 *
 * Extension points for later, scoped-access work (not implemented yet):
 * a `role`/`permissions` claim, or `organization`/`team` claims, would be
 * added to `AuthContext` once the platform grows beyond single-owner
 * project access.
 */
declare global {
  namespace Express {
    interface Request {
      userId: string;
      authContext?: AuthContext;
      project?: typeof projectsTable.$inferSelect;
    }
  }
}

export {};
