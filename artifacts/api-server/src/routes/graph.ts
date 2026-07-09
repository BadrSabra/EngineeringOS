import { Router } from "express";
import { db } from "@workspace/db";
import { graphEntitiesTable, graphRelationshipsTable } from "@workspace/db";
import {
  ListGraphEntitiesQueryParams,
  ListGraphRelationshipsQueryParams,
} from "@workspace/api-zod";
import { eq, and } from "drizzle-orm";

const router = Router();

// List graph entities
router.get("/graph/entities", async (req, res) => {
  const params = ListGraphEntitiesQueryParams.parse(req.query);
  const conditions = [];
  if (params.projectId)
    conditions.push(eq(graphEntitiesTable.projectId, params.projectId));
  if (params.type) conditions.push(eq(graphEntitiesTable.type, params.type));

  const entities =
    conditions.length > 0
      ? await db
          .select()
          .from(graphEntitiesTable)
          .where(and(...conditions))
      : await db.select().from(graphEntitiesTable);

  return res.json(entities);
});

// List graph relationships
router.get("/graph/relationships", async (req, res) => {
  const params = ListGraphRelationshipsQueryParams.parse(req.query);
  const conditions = [];
  if (params.projectId) {
    const entities = await db
      .select({ id: graphEntitiesTable.id })
      .from(graphEntitiesTable)
      .where(eq(graphEntitiesTable.projectId, params.projectId));
    const entityIds = entities.map((e) => e.id);
    if (entityIds.length === 0) return res.json([]);

    const rels = await db
      .select()
      .from(graphRelationshipsTable)
      .where(
        params.sourceId
          ? eq(graphRelationshipsTable.sourceId, params.sourceId)
          : and(),
      );
    return res.json(
      rels.filter(
        (r) =>
          entityIds.includes(r.sourceId) || entityIds.includes(r.targetId),
      ),
    );
  }

  if (params.sourceId) {
    const rels = await db
      .select()
      .from(graphRelationshipsTable)
      .where(eq(graphRelationshipsTable.sourceId, params.sourceId));
    return res.json(rels);
  }

  const rels = await db.select().from(graphRelationshipsTable);
  return res.json(rels);
});

export default router;
