import { Router } from "express";
import { db } from "@workspace/db";
import { eventsTable } from "@workspace/db";
import { ListEventsQueryParams } from "@workspace/api-zod";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

router.get("/events", async (req, res) => {
  const params = ListEventsQueryParams.parse(req.query);
  const limit = params.limit ?? 50;
  const conditions = [];
  if (params.projectId)
    conditions.push(eq(eventsTable.projectId, params.projectId));
  if (params.type) conditions.push(eq(eventsTable.type, params.type));

  const events =
    conditions.length > 0
      ? await db
          .select()
          .from(eventsTable)
          .where(and(...conditions))
          .orderBy(desc(eventsTable.timestamp))
          .limit(limit)
      : await db
          .select()
          .from(eventsTable)
          .orderBy(desc(eventsTable.timestamp))
          .limit(limit);

  return res.json(events);
});

export default router;
