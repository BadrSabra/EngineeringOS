import { db, graphEntitiesTable, projectsTable } from "@workspace/db";
import { and, eq, ilike } from "drizzle-orm";
import {
  getImpactedEntities,
  getNeighborhood,
  searchNodes,
  type GraphEntity,
} from "@workspace/knowledge-engine";
import type {
  AnalysisCorrelation,
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

function hasUsableCorrelation(
  correlation: AnalysisCorrelation | undefined,
): correlation is AnalysisCorrelation {
  if (!correlation || typeof correlation !== "object") return false;
  const value = correlation as unknown as {
    operationId?: unknown;
    projectId?: unknown;
    projectRevision?: unknown;
    rootAvailable?: unknown;
  };
  return typeof value.operationId === "string"
    && value.operationId.length > 0
    && typeof value.projectId === "string"
    && value.projectId.length > 0
    && typeof value.projectRevision === "string"
    && value.projectRevision.length > 0
    && value.rootAvailable === true;
}

function entityView(entity: GraphEntity) {
  return { id: entity.id, type: entity.type, name: entity.name, path: entity.path, confidence: entity.confidence };
}

export function createProjectAnalysisToolRunner(
  projectId: string,
  rootPath: string,
): AnalysisToolRunner {
  return async (name, args, parentSignal, correlation): Promise<AnalysisToolResult> => {
    if (!hasUsableCorrelation(correlation)) {
      return { status: "unavailable", output: "Analysis correlation is unavailable." };
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener("abort", onAbort, { once: true });
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const unavailable = (message: string): AnalysisToolResult => ({
      status: "unavailable",
      output: message,
      correlation,
    });
    const assertRevision = async (): Promise<void> => {
      const [project] = await db
        .select({ updatedAt: projectsTable.updatedAt })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .limit(1);
      if (project?.updatedAt && project.updatedAt.toISOString() !== correlation.projectRevision) {
        throw new Error("analysis revision is stale");
      }
    };
    check(controller.signal);
    const work = (async (): Promise<AnalysisToolResult> => {
      check(controller.signal);
      await assertRevision();
      if (name === "refresh_project_scan") {
        const result = await performScan(projectId, controller.signal);
        check(controller.signal);
        const [project] = await db
          .select({ updatedAt: projectsTable.updatedAt })
          .from(projectsTable)
          .where(eq(projectsTable.id, projectId))
          .limit(1);
        if (project?.updatedAt) correlation.projectRevision = project.updatedAt.toISOString();
        correlation.evidenceProvenance = "project-scan";
        return {
          status: "complete",
          source: `analysis:scan:${result.scannedAt}`,
          output: bounded({ ...result, status: "complete", rootPath }),
          correlation: { ...correlation },
        };
      }

      if (name === "discover_project_apis") {
        const query = (args.query ?? "").trim();
        const conditions = [eq(graphEntitiesTable.projectId, projectId), eq(graphEntitiesTable.type, "api" as never)];
        if (query) conditions.push(ilike(graphEntitiesTable.name, `%${query}%`));
        const rows = await db.select().from(graphEntitiesTable).where(and(...conditions)).limit(100);
        check(controller.signal);
        return {
          status: "complete",
          source: "analysis:api-discovery",
          output: bounded({ status: "complete", count: rows.length, apis: rows.map(entityView) }),
          correlation: { ...correlation, evidenceProvenance: "persisted-api-discovery" },
        };
      }

      const operation = args.operation ?? "search";
      const depth = Math.max(1, Math.min(4, Number(args.depth) || 2));
      const entity = (args.entity ?? "").trim();
      if (operation === "search") {
        const matches = await searchNodes(db, projectId, entity ? [entity] : []);
        check(controller.signal);
        return {
          status: "complete",
          source: "analysis:graph-search",
          output: bounded({ status: "complete", count: matches.length, entities: matches.slice(0, 50).map(entityView) }),
          correlation: { ...correlation, evidenceProvenance: "persisted-graph-search" },
        };
      }
      const matches = await searchNodes(db, projectId, entity ? [entity] : []);
      const target = matches[0];
      if (!target) {
        return {
          status: "complete",
          source: "analysis:graph",
          output: bounded({ status: "complete", count: 0, entities: [] }),
          correlation: { ...correlation, evidenceProvenance: `persisted-graph-${operation}` },
        };
      }
      const result = operation === "impact"
        ? await getImpactedEntities(db, target.id, depth)
        : await getNeighborhood(db, target.id, depth);
      check(controller.signal);
      return {
        status: "complete",
        source: `analysis:graph-${operation}`,
        output: bounded({ status: "complete", operation, entity: entityView(target), result }),
        correlation: { ...correlation, evidenceProvenance: `persisted-graph-${operation}` },
      };
    })();
    const timeout = new Promise<AnalysisToolResult>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve(unavailable("Analysis exceeded the bounded 30-second budget and was not completed."));
      }, MAX_MS);
    });
    try {
      return await Promise.race([
        work,
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
      // Ensure a timeout cannot turn a late completion into usable evidence.
      if (timedOut) controller.abort();
    }
  };
}