import { db, graphEntitiesTable, projectsTable } from "@workspace/db";
import { and, eq, ilike } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getImpactedEntities,
  getNeighborhood,
  planHierarchicalRetrieval,
  searchNodes,
  type GraphEntity,
} from "@workspace/knowledge-engine";
import { SCANNER_VERSION } from "@workspace/scanner";
import type {
  AnalysisCorrelation,
  AnalysisFailureCategory,
  AnalysisToolResult,
  AnalysisToolRunner,
} from "@workspace/ai-orchestrator";
import { performScan, ScanRootUnavailableError } from "./scan-runner.js";

const MAX_OUTPUT = 24_000;
const HARD_MAX_MS = 30_000;
const MAX_GIT_HISTORY_PATHS = 6;
const MAX_GIT_HISTORY_ENTRIES_PER_PATH = 8;
const MAX_GIT_HISTORY_BUFFER = 256 * 1024;
const execFileAsync = promisify(execFile);

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

function isRootUnavailableError(error: unknown): boolean {
  return error instanceof ScanRootUnavailableError
    || (
      error !== null
      && typeof error === "object"
      && (error as { outcome?: unknown }).outcome === "root_unavailable"
    );
}

type GitHistoryEntry = {
  path: string;
  commit: string;
  shortCommit: string;
  date: string;
  subject: string;
};

function safeGitPath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").trim();
  return Boolean(normalized)
    && !normalized.startsWith("/")
    && normalized !== "."
    && !normalized.split("/").some((part) => part === "..");
}

function safeGitSubject(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);
}

async function readBoundedGitHistory(
  rootPath: string,
  paths: string[],
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<{
  status: "complete" | "unavailable";
  gitRevision: string | null;
  entries: GitHistoryEntry[];
}> {
  const selectedPaths = [...new Set(paths.filter(safeGitPath))].slice(0, MAX_GIT_HISTORY_PATHS);
  if (selectedPaths.length === 0) {
    return { status: "unavailable", gitRevision: null, entries: [] };
  }

  try {
    const revisionResult = await execFileAsync(
      "git",
      ["-C", rootPath, "rev-parse", "HEAD"],
      { timeout: 8_000, maxBuffer: 16 * 1024 },
    );
    const gitRevision = revisionResult.stdout.trim().slice(0, 128);
    const entries: GitHistoryEntry[] = [];
    for (const projectPath of selectedPaths) {
      check(signal, deadlineAt);
      const result = await execFileAsync(
        "git",
        [
          "-C",
          rootPath,
          "log",
          "--follow",
          `-n`,
          String(MAX_GIT_HISTORY_ENTRIES_PER_PATH),
          "--format=%H%x1f%h%x1f%ad%x1f%s",
          "--date=short",
          "--",
          projectPath,
        ],
        { timeout: 8_000, maxBuffer: MAX_GIT_HISTORY_BUFFER },
      );
      for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
        const [commit, shortCommit, date, ...subjectParts] = line.split("\x1f");
        if (!commit || !shortCommit || !date) continue;
        entries.push({
          path: projectPath,
          commit: commit.slice(0, 128),
          shortCommit: shortCommit.slice(0, 16),
          date: date.slice(0, 32),
          subject: safeGitSubject(subjectParts.join("\x1f")),
        });
      }
    }
    return { status: "complete", gitRevision, entries };
  } catch {
    return { status: "unavailable", gitRevision: null, entries: [] };
  }
}

export function classifyAnalysisFailure(
  error: unknown,
  parentSignal?: AbortSignal,
  deadlineAt?: number,
): AnalysisFailureCategory {
  if (parentSignal?.aborted) return "cancellation";
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) return "timeout";
  if (isRootUnavailableError(error)) return "root_unavailable";
  if (/stale/i.test(error instanceof Error ? error.message : String(error))) {
    return "stale_revision";
  }
  return "execution_failure";
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
      if (operation === "retrieve") {
        const query = (args.query ?? entity).trim();
        const paths = (args.paths ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 20);
        const [indexState] = await db
          .select({ lastScanAt: projectsTable.lastScanAt })
          .from(projectsTable)
          .where(eq(projectsTable.id, projectId))
          .limit(1);
        const plan = await planHierarchicalRetrieval(db, projectId, {
          query,
          paths,
          depth: Math.min(depth, 2),
          operationId: correlationSnapshot.operationId,
          projectRevision: correlationSnapshot.projectRevision,
          indexRevision: indexState?.lastScanAt?.toISOString() ?? "unscanned",
          parserVersion: SCANNER_VERSION,
        });
        const gitHistory = await readBoundedGitHistory(
          rootPath,
          plan.sourcePaths,
          controller.signal,
          attemptDeadline,
        );
        check(controller.signal, attemptDeadline);
        await assertRevision();
        check(controller.signal, attemptDeadline);
        return {
          status: "complete",
          source: "analysis:hierarchical-retrieval",
          output: bounded({ ...plan, gitHistory }),
          correlation: {
            ...(authoritativeCorrelation ?? correlationSnapshot),
            evidenceProvenance: gitHistory.status === "complete"
              ? "persisted-hierarchical-retrieval+git-history"
              : "persisted-hierarchical-retrieval",
          },
          ...(advancedRevision ? { trustedRevisionAdvance: true } : {}),
        };
      }
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
        : await getNeighborhood(db, target.id, depth, projectId);
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
      const failureCategory = classifyAnalysisFailure(error, parentSignal, attemptDeadline);
      return unavailable(
        failureCategory === "cancellation"
          ? "Analysis was cancelled before completion."
          : failureCategory === "timeout"
            ? "Analysis exceeded its execution deadline and was not completed."
            : failureCategory === "stale_revision"
              ? "Analysis observed a workspace revision change and was rejected."
              : failureCategory === "root_unavailable"
                ? "The project analysis root is unavailable."
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