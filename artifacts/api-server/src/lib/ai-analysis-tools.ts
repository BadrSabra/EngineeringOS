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
  AnalysisFailureCategory,
  AnalysisToolResult,
  AnalysisToolRunner,
} from "@workspace/ai-orchestrator";
import { performScan } from "./scan-runner.js";

const MAX_OUTPUT = 24_000;
const HARD_MAX_MS = 30_000;

function bounded(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[analysis output bounded]` : text;
}

function check(signal?: AbortSignal, deadlineAt?: number): void {
  if (signal?.aborted) throw new Error("analysis cancelled");
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw new Error("analysis timed out");
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
  parentDeadlineAtFactory?: () => number | undefined,
): AnalysisToolRunner {
  let authoritativeCorrelation: AnalysisCorrelation | undefined;
  return async (name, args, parentSignal, correlation, parentDeadlineAt): Promise<AnalysisToolResult> => {
    if (!hasUsableCorrelation(correlation)) {
      const rootUnavailable = Boolean(
        correlation
        && (correlation as AnalysisCorrelation).rootAvailable === false,
      );
      return {
        status: "unavailable",
        output: rootUnavailable
          ? "The project analysis root is unavailable."
          : "Analysis correlation is unavailable.",
        correlation: correlation
          ? { ...(correlation as AnalysisCorrelation) }
          : undefined,
        failureCategory: rootUnavailable
          ? "root_unavailable"
          : "unavailable_dependency",
      };
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener("abort", onAbort, { once: true });
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    // The caller owns this snapshot. Never mutate it while a scan is running:
    // late completions must not be able to rewrite the operation's provenance.
    const requestCorrelation: AnalysisCorrelation = { ...correlation };
    const correlationSnapshot: AnalysisCorrelation =
      authoritativeCorrelation
      && authoritativeCorrelation.operationId === requestCorrelation.operationId
      && authoritativeCorrelation.projectId === requestCorrelation.projectId
        ? { ...authoritativeCorrelation }
        : requestCorrelation;
    let advancedRevision = correlationSnapshot.projectRevision !== requestCorrelation.projectRevision;
    const deadlineAt = () => {
      const parent = parentDeadlineAt ?? parentDeadlineAtFactory?.();
      return parent === undefined ? undefined : Math.min(parent, Date.now() + HARD_MAX_MS);
    };
    const unavailable = (message: string, failureCategory: AnalysisFailureCategory = "unavailable_dependency"): AnalysisToolResult => ({
      status: "unavailable",
      output: message,
      correlation: correlationSnapshot,
      failureCategory,
    });
    const assertRevision = async (): Promise<void> => {
      const [project] = await db
        .select({ updatedAt: projectsTable.updatedAt })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .limit(1);
      if (project?.updatedAt && project.updatedAt.toISOString() !== correlationSnapshot.projectRevision) {
        throw new Error("analysis revision is stale");
      }
    };
    const attemptDeadline = deadlineAt();
    check(controller.signal);
    const work = (async (): Promise<AnalysisToolResult> => {
      check(controller.signal);
      check(controller.signal, attemptDeadline);
      await assertRevision();
      if (name === "refresh_project_scan") {
        const result = await performScan(projectId, controller.signal);
        check(controller.signal, attemptDeadline);
        const [projectAfterScan] = await db
          .select({ updatedAt: projectsTable.updatedAt })
          .from(projectsTable)
          .where(eq(projectsTable.id, projectId))
          .limit(1);
        check(controller.signal, attemptDeadline);
        const afterScanRevision = projectAfterScan?.updatedAt?.toISOString();
        if (
          afterScanRevision
          && afterScanRevision !== correlationSnapshot.projectRevision
          && afterScanRevision !== result.scannedAt
        ) {
          return unavailable("Analysis observed a workspace revision change and was rejected.", "stale_revision");
        }
        if (afterScanRevision && afterScanRevision !== correlationSnapshot.projectRevision) {
          authoritativeCorrelation = {
            ...correlationSnapshot,
            projectRevision: afterScanRevision,
            evidenceProvenance: "project-scan",
          };
          advancedRevision = true;
        }
        return {
          status: "complete",
          source: `analysis:scan:${result.scannedAt}`,
          output: bounded({ ...result, status: "complete", rootPath }),
          correlation: {
            ...(authoritativeCorrelation ?? correlationSnapshot),
            evidenceProvenance: "project-scan",
          },
          ...(advancedRevision ? { trustedRevisionAdvance: true } : {}),
        };
      }

      if (name === "discover_project_apis") {
        const query = (args.query ?? "").trim();
        const conditions = [eq(graphEntitiesTable.projectId, projectId), eq(graphEntitiesTable.type, "api" as never)];
        if (query) conditions.push(ilike(graphEntitiesTable.name, `%${query}%`));
        const rows = await db.select().from(graphEntitiesTable).where(and(...conditions)).limit(100);
        check(controller.signal, attemptDeadline);
        await assertRevision();
        check(controller.signal, attemptDeadline);
        return {
          status: "complete",
          source: "analysis:api-discovery",
          output: bounded({ status: "complete", count: rows.length, apis: rows.map(entityView) }),
          correlation: { ...(authoritativeCorrelation ?? correlationSnapshot), evidenceProvenance: "persisted-api-discovery" },
          ...(advancedRevision ? { trustedRevisionAdvance: true } : {}),
        };
      }

      const operation = args.operation ?? "search";
      const depth = Math.max(1, Math.min(4, Number(args.depth) || 2));
      const entity = (args.entity ?? "").trim();
      if (operation === "search") {
        const matches = await searchNodes(db, projectId, entity ? [entity] : []);
        check(controller.signal, attemptDeadline);
        await assertRevision();
        check(controller.signal, attemptDeadline);
        return {
          status: "complete",
          source: "analysis:graph-search",
          output: bounded({ status: "complete", count: matches.length, entities: matches.slice(0, 50).map(entityView) }),
          correlation: { ...(authoritativeCorrelation ?? correlationSnapshot), evidenceProvenance: "persisted-graph-search" },
          ...(advancedRevision ? { trustedRevisionAdvance: true } : {}),
        };
      }
      const matches = await searchNodes(db, projectId, entity ? [entity] : []);
      check(controller.signal, attemptDeadline);
      await assertRevision();
      check(controller.signal, attemptDeadline);
      const target = matches[0];
      if (!target) {
        return {
          status: "complete",
          source: "analysis:graph",
          output: bounded({ status: "complete", count: 0, entities: [] }),
          correlation: { ...(authoritativeCorrelation ?? correlationSnapshot), evidenceProvenance: `persisted-graph-${operation}` },
          ...(advancedRevision ? { trustedRevisionAdvance: true } : {}),
        };
      }
      const result = operation === "impact"
        ? await getImpactedEntities(db, target.id, depth)
        : await getNeighborhood(db, target.id, depth);
      check(controller.signal, attemptDeadline);
      await assertRevision();
      check(controller.signal, attemptDeadline);
      return {
        status: "complete",
        source: `analysis:graph-${operation}`,
        output: bounded({ status: "complete", operation, entity: entityView(target), result }),
        correlation: { ...(authoritativeCorrelation ?? correlationSnapshot), evidenceProvenance: `persisted-graph-${operation}` },
        ...(advancedRevision ? { trustedRevisionAdvance: true } : {}),
      };
    })();
    const timeout = new Promise<AnalysisToolResult>((resolve) => {
      const remaining = Math.max(1, (deadlineAt() ?? (Date.now() + HARD_MAX_MS)) - Date.now());
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve(unavailable("Analysis exceeded its execution deadline and was not completed.", "timeout"));
      }, remaining);
    });
    try {
      const result = await Promise.race([
        work,
        timeout,
      ]);
      if (timedOut || parentSignal?.aborted) return unavailable(
        parentSignal?.aborted ? "Analysis was cancelled before completion." : "Analysis exceeded its execution deadline and was not completed.",
        parentSignal?.aborted ? "cancellation" : "timeout",
      );
      return result;
    } catch (error) {
      const timedOutByDeadline = attemptDeadline !== undefined && Date.now() >= attemptDeadline;
      const failureCategory: AnalysisFailureCategory = parentSignal?.aborted
        ? "cancellation"
        : timedOutByDeadline
          ? "timeout"
          : /stale/i.test(error instanceof Error ? error.message : String(error))
            ? "stale_revision"
            : "execution_failure";
      return unavailable(
        failureCategory === "cancellation"
          ? "Analysis was cancelled before completion."
          : failureCategory === "timeout"
            ? "Analysis exceeded its execution deadline and was not completed."
            : failureCategory === "stale_revision"
              ? "Analysis observed a workspace revision change and was rejected."
              : "The project analysis dependency failed before completion.",
        failureCategory,
      );
    } finally {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
      // Ensure a timeout cannot turn a late completion into usable evidence.
      if (timedOut) controller.abort();
    }
  };
}