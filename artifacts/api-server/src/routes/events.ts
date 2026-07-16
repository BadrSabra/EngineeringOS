import { Router } from "express";
import { db } from "@workspace/db";
import { eventsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

/**
 * GET /events
 *
 * Returns events scoped to a single project. Ownership is verified before
 * returning any rows — a user cannot read events from a project they don't own.
 * projectId is required; without it we would either return nothing useful or
 * expose events across projects.
 *
 * Optional filters: type, correlationId, limit (default 50, max 500).
 * Results are ordered newest-first.
 */
router.get("/events", async (req, res) => {
  // Ownership check — 400 if missing, 404/403 if not found/not owner
  const project = await loadProjectByIdForUser(
    typeof req.query.projectId === "string" ? req.query.projectId : undefined,
    req.userId,
    res,
  );
  if (!project) return; // response already sent

  const limit = Math.min(
    Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 50,
    500,
  );

  // correlationId is not in the generated Zod schema yet — parse directly so
  // callers can already filter "show me everything from one operation".
  const correlationIdFilter =
    typeof req.query.correlationId === "string" ? req.query.correlationId : undefined;
  const typeFilter =
    typeof req.query.type === "string" ? req.query.type : undefined;

  const conditions: ReturnType<typeof eq>[] = [eq(eventsTable.projectId, project.id)];
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
