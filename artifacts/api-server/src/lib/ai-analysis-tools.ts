import { db, graphEntitiesTable } from "@workspace/db";
import { and, eq, ilike } from "drizzle-orm";
import {
  getImpactedEntities,
  getNeighborhood,
  searchNodes,
  type GraphEntity,
} from "@workspace/knowledge-engine";
import type {
  AnalysisToolResult,
  AnalysisToolRunner,
} from "@workspace/ai-orchestrator";
import { performScan } from "./scan-runner.js";

const MAX_OUTPUT = 24_000;
const MAX_MS = 30_000;

function bounded(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[analysis output bounded]` : text;
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("analysis cancelled");
}

function entityView(entity: GraphEntity) {
  return { id: entity.id, type: entity.type, name: entity.name, path: entity.path, confidence: entity.confidence };
}

export function createProjectAnalysisToolRunner(projectId: string, rootPath: string): AnalysisToolRunner {
  return async (name, args, signal): Promise<AnalysisToolResult> => {
    check(signal);
    const work = (async (): Promise<AnalysisToolResult> => {
      if (name === "refresh_project_scan") {
        const result = await performScan(projectId, signal);
        check(signal);
        return {
          status: "complete",
          source: `analysis:scan:${result.scannedAt}`,
          output: bounded({ ...result, status: "complete", rootPath }),
        };
      }

      if (name === "discover_project_apis") {
        const query = (args.query ?? "").trim();
        const conditions = [eq(graphEntitiesTable.projectId, projectId), eq(graphEntitiesTable.type, "api" as never)];
        if (query) conditions.push(ilike(graphEntitiesTable.name, `%${query}%`));
        const rows = await db.select().from(graphEntitiesTable).where(and(...conditions)).limit(100);
        check(signal);
        return {
          status: "complete",
          source: "analysis:api-discovery",
          output: bounded({ status: "complete", count: rows.length, apis: rows.map(entityView) }),
        };
      }

      const operation = args.operation ?? "search";
      const depth = Math.max(1, Math.min(4, Number(args.depth) || 2));
      const entity = (args.entity ?? "").trim();
      if (operation === "search") {
        const matches = await searchNodes(db, projectId, entity ? [entity] : []);
        return {
          status: "complete",
          source: "analysis:graph-search",
          output: bounded({ status: "complete", count: matches.length, entities: matches.slice(0, 50).map(entityView) }),
        };
      }
      const matches = await searchNodes(db, projectId, entity ? [entity] : []);
      const target = matches[0];
      if (!target) {
        return { status: "complete", source: "analysis:graph", output: bounded({ status: "complete", count: 0, entities: [] }) };
      }
      const result = operation === "impact"
        ? await getImpactedEntities(db, target.id, depth)
        : await getNeighborhood(db, target.id, depth);
      check(signal);
      return {
        status: "complete",
        source: `analysis:graph-${operation}`,
        output: bounded({ status: "complete", operation, entity: entityView(target), result }),
      };
    })();
    return Promise.race([
      work,
      new Promise<AnalysisToolResult>((resolve) =>
        setTimeout(() => resolve({
          status: "unavailable",
          output: "Analysis exceeded the bounded 30-second budget and was not completed.",
        }), MAX_MS),
      ),
    ]);
  };
}