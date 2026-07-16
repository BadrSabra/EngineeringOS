/**
 * Ownership-scoped access control for any route keyed on `:projectId`.
 *
 * `requireAuth` only establishes *who* is making the request (see
 * requireAuth.ts). It says nothing about *which* projects that user may
 * read or mutate — before this middleware existed, any authenticated user
 * could read/update/delete/scan any project by guessing or enumerating an
 * id. This middleware closes that gap: it loads the project referenced by
 * `req.params.projectId`, and either
 *   - 404s if no such project exists at all (never reveals whether a
 *     project id exists to a user who doesn't own it — same response
 *     shape as "genuinely doesn't exist"), unless the caller already
 *     wants ownership to be visible via 403 (see below), or
 *   - 403s if the project exists but is owned by a different user, or
 *   - attaches the loaded row to `req.project` and calls `next()`.
 *
 * Design choice: 404 for "no such row", 403 for "row exists, not yours".
 * This is deliberately *not* uniform 404-for-everything — the platform is
 * a single-tenant-per-user internal tool, not a public multi-tenant SaaS
 * where existence itself is sensitive, so a clear 403 makes ownership
 * bugs in the client much easier to diagnose than an ambiguous 404 would.
 *
 * Attaching `req.project` also lets downstream handlers skip a second
 * `SELECT` for the common case where they only needed the row to check
 * existence/ownership before doing their own work.
 */
import type { NextFunction, Request, Response } from "express";
import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function requireProjectAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const project = await loadOwnedProject(req, res);
  if (!project) return;
  req.project = project;
  next();
}

/**
 * Same ownership check as `requireProjectAccess`, exposed as a distinct
 * export for routes that mutate a project (create/update/delete a child
 * resource, run a scan, advance a workflow, etc.) rather than merely read
 * it.
 *
 * Today the single-owner model means read and write access are the same
 * check — there is no notion of a read-only collaborator yet — so this is
 * intentionally a thin alias rather than duplicated logic. The point of
 * having two names now, before they diverge, is so the *call site* already
 * says what it needs: swapping in real read/write-scoped access later
 * (e.g. shared projects with a viewer role) only requires changing what
 * each function checks, not auditing every route to reclassify it first.
 */
export async function requireProjectWriteAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const project = await loadOwnedProject(req, res);
  if (!project) return;
  req.project = project;
  next();
}

/**
 * Shared lookup for both access-check middlewares. Returns the project row
 * on success, or `undefined` after already writing the appropriate error
 * response (400/404/403) on failure — callers just check for `undefined`
 * and return without writing a second response.
 */
async function loadOwnedProject(
  req: Request,
  res: Response,
): Promise<typeof projectsTable.$inferSelect | undefined> {
  const projectId = req.params.projectId;
  if (!projectId || typeof projectId !== "string") {
    res.status(400).json({ error: "projectId is required" });
    return undefined;
  }

  const rows = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  const project = rows[0];
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return undefined;
  }

  if (project.ownerId !== req.userId) {
    res.status(403).json({ error: "You do not have access to this project" });
    return undefined;
  }

  return project;
}

/**
 * Loads and ownership-verifies a project from an explicit projectId + userId.
 * Use this in routes where the projectId comes from a query param or request
 * body rather than `:projectId` in the URL path (tasks, rules, events,
 * metrics, graph, ai, workflows listed without a path param, …).
 *
 * Same 400/404/403 semantics and comments as `requireProjectAccess`.
 */
export async function loadProjectByIdForUser(
  projectId: string | null | undefined,
  userId: string,
  res: Response,
): Promise<typeof projectsTable.$inferSelect | undefined> {
  if (!projectId || typeof projectId !== "string") {
    res.status(400).json({ error: "projectId is required" });
    return undefined;
  }
  const rows = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  const project = rows[0];
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return undefined;
  }
  if (project.ownerId !== userId) {
    res.status(403).json({ error: "You do not have access to this project" });
    return undefined;
  }
  return project;
}
