import { Router } from "express";
import { db, eventsTable, projectsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

/**
 * GET /events
 *
 * Returns events scoped to a single project, or across all projects owned by
 * the authenticated user when projectId is omitted. Ownership is verified
 * before returning any rows — a user cannot read events from a project they
 * don't own.
 *
 * Optional filters: type, correlationId, limit (default 50, max 500).
 * Results are ordered newest-first.
 */
router.get("/events", async (req, res) => {
  const requestedLimit = Number.isFinite(Number(req.query.limit))
    ? Math.floor(Number(req.query.limit))
    : 50;
  if (requestedLimit < 1) {
    return res.status(400).json({ error: "limit must be at least 1" });
  }
  const limit = Math.min(requestedLimit, 500);

  // correlationId is not in the generated Zod schema yet — parse directly so
  // callers can already filter "show me everything from one operation".
  const correlationIdFilter =
    typeof req.query.correlationId === "string" ? req.query.correlationId : undefined;
  const typeFilter =
    typeof req.query.type === "string" ? req.query.type : undefined;

  const projectId =
    typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  let projectIds: string[];
  if (projectId) {
    // Explicit project requests retain the existing 404/403 ownership semantics.
    const project = await loadProjectByIdForUser(projectId, req.userId, res);
    if (!project) return; // response already sent
    projectIds = [project.id];
  } else {
    // Resolve ownership first, then constrain the event query to those IDs.
    // This avoids exposing events from projects owned by another user.
    const ownedProjects = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.ownerId, req.userId));
    projectIds = ownedProjects.map(({ id }) => id);
    if (projectIds.length === 0) return res.json([]);
  }

  const conditions: ReturnType<typeof eq>[] = [inArray(eventsTable.projectId, projectIds)];
  if (typeFilter) conditions.push(eq(eventsTable.type, typeFilter));
  if (correlationIdFilter)
    conditions.push(eq(eventsTable.correlationId, correlationIdFilter));

  const events = await db
    .select()
    .from(eventsTable)
    .where(and(...conditions))
    .orderBy(desc(eventsTable.timestamp))
    .limit(limit);

  return res.json(events);
});

export default router;
