/**
 * Plugin runtime — in-process plugin hook contract and dispatcher.
 *
 * Plugins are not separate processes or dynamic modules — they are
 * TypeScript objects registered below in PLUGIN_HOOKS. The database only
 * stores which plugins are enabled; the logic lives here. This makes the
 * runtime self-contained, type-safe, and testable without subprocess
 * management or dynamic require().
 *
 * Currently supported hook: `onScanComplete`
 * Future hooks: onEntityExtracted, onRuleViolation, onTaskCreated.
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  eventsTable,
  pluginsTable,
  pluginDispatchBatchesTable,
  pluginRunsTable,
  projectPluginBindingsTable,
} from "@workspace/db";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { logger } from "./logger.js";
import { heavyJobQueue } from "./job-queue.js";
import {
  databaseLeaseUntil,
  databaseNow,
  type ScanJobTransaction,
} from "./job-lease.js";

// ─── Hook context ─────────────────────────────────────────────────────────────

export interface ExtractedEntity {
  type: string;
  name: string;
  path?: string | null;
  /** True when the entity has a JSDoc/docstring doc comment — set by the scanner's AST extractor. */
  isDocumented?: boolean;
}

export interface RuleViolationSummary {
  ruleId: string;
  code: string;
  severity: string;
  matchCount: number;
}

export interface ScanCompleteContext {
  projectId: string;
  scanCorrelationId: string;
  scanCompleteness: "COMPLETE" | "PARTIAL";
  ruleEvaluationComplete: boolean;
  language: string;
  framework?: string | null;
  filesFound: number;
  sourceFiles: number;
  issuesDetected: number;
  tasksCreated: number;
  entitiesExtracted: number;
  relationshipsExtracted: number;
  ruleViolations: RuleViolationSummary[];
  entities: ExtractedEntity[];
}

// ─── Hook result ──────────────────────────────────────────────────────────────

type EventSeverity = "info" | "success" | "warning" | "error";

export interface PluginEvent {
  type: string;
  message: string;
  severity: EventSeverity;
  payload?: Record<string, unknown>;
}

export interface ScanCompleteResult {
  events?: PluginEvent[];
}

// ─── Hook interface ───────────────────────────────────────────────────────────

export interface PluginHook {
  onScanComplete(ctx: ScanCompleteContext): Promise<ScanCompleteResult>;
}

const PLUGIN_RUN_LEASE_MS = 5 * 60 * 1000;
const PLUGIN_RUN_MAX_ATTEMPTS = 3;
const PLUGIN_RUN_RETRY_BASE_MS = 5_000;
const PLUGIN_RUN_RETRY_MAX_MS = 5 * 60 * 1000;
const PLUGIN_RUN_DISPATCH_PAGE_SIZE = 100;

export function isPluginLanguageCompatible(
  supportedLanguages: string[] | null | undefined,
  language: string,
): boolean {
  if (!supportedLanguages || supportedLanguages.length === 0) return true;
  const normalizedLanguage = language.trim().toLowerCase();
  return supportedLanguages.some(
    (supported) => supported.trim().toLowerCase() === normalizedLanguage,
  );
}

// ─── Built-in plugin implementations ─────────────────────────────────────────

/**
 * Each key maps to a plugin ID stored in the database.
 * Plugins that aren't in this map are ignored even if DB-enabled — they
 * may be third-party plugins not yet shipped with this runtime version.
 *
 * Exported for unit testing; not intended as a public API surface.
 * @internal
 */
export const PLUGIN_HOOKS: Record<string, PluginHook> = {
  "plugin-react": {
    async onScanComplete(ctx) {
      if (!["typescript", "javascript"].includes(ctx.language)) return {};

      const hooks = ctx.entities.filter(
        (e) =>
          e.type === "function" &&
          e.name.startsWith("use") &&
          e.name.length > 3 &&
          e.name[3] === e.name[3]?.toUpperCase(),
      );
      const components = ctx.entities.filter(
        (e) =>
          (e.type === "function" || e.type === "class") &&
          e.name[0] === e.name[0]?.toUpperCase() &&
          e.name[0] !== e.name[0]?.toLowerCase() &&
          !e.name.startsWith("use"),
      );
      const events: PluginEvent[] = [];

      if (hooks.length > 0 || components.length > 0) {
        events.push({
          type: "ReactPluginAnalysis",
          message: `React/TS analyzer: ${components.length} component(s), ${hooks.length} custom hook(s) detected`,
          severity: "info",
          payload: { componentCount: components.length, hookCount: hooks.length },
        });
      }

      // Flag components with no corresponding hooks or utilities — may be
      // excessively large monolithic components.
      if (components.length > 0 && ctx.relationshipsExtracted === 0) {
        events.push({
          type: "ReactPluginAdvisory",
          message: `React analyzer: ${components.length} component(s) found but no relationships extracted — consider breaking them into smaller units`,
          severity: "warning",
          payload: { componentCount: components.length },
        });
      }

      return { events };
    },
  },

  "plugin-node": {
    async onScanComplete(ctx) {
      if (!["typescript", "javascript"].includes(ctx.language)) return {};

      const apiEntities = ctx.entities.filter((e) => e.type === "api");
      const events: PluginEvent[] = [];

      if (apiEntities.length > 0) {
        // Flag API endpoints that contain security-sensitive keywords without
        // auth-looking neighbors — a heuristic advisory, not a hard rule.
        const unprotectedLooking = apiEntities.filter((e) => {
          const name = e.name.toLowerCase();
          return (
            name.includes("admin") ||
            name.includes("delete") ||
            name.includes("export") ||
            name.includes("internal")
          );
        });

        events.push({
          type: "NodePluginAnalysis",
          message: `Node.js analyzer: ${apiEntities.length} API route(s) detected`,
          severity: "info",
          payload: { apiCount: apiEntities.length },
        });

        if (unprotectedLooking.length > 0) {
          events.push({
            type: "NodePluginAdvisory",
            message: `Node.js analyzer: ${unprotectedLooking.length} route(s) have security-sensitive names — verify auth middleware coverage`,
            severity: "warning",
            payload: {
              routes: unprotectedLooking.slice(0, 5).map((e) => e.name),
            },
          });
        }
      }

      return { events };
    },
  },

  "plugin-security": {
    async onScanComplete(ctx) {
      const criticalViolations = ctx.ruleViolations.filter(
        (v) => v.severity === "critical" || v.severity === "high",
      );
      const events: PluginEvent[] = [];

      if (criticalViolations.length > 0) {
        const totalMatches = criticalViolations.reduce(
          (sum, v) => sum + v.matchCount,
          0,
        );
        events.push({
          type: "SecurityPluginAlert",
          message: `OWASP scanner: ${criticalViolations.length} critical/high rule(s) triggered with ${totalMatches} match(es) — immediate review required`,
          severity: "error",
          payload: {
            violatedRules: criticalViolations.map((v) => v.code),
            totalMatches,
          },
        });
      } else if (
        ctx.issuesDetected === 0 &&
        ctx.sourceFiles > 0 &&
        ctx.scanCompleteness === "COMPLETE" &&
        ctx.ruleEvaluationComplete
      ) {
        events.push({
          type: "SecurityPluginClear",
          message: `Security rules reported no violations across ${ctx.sourceFiles} source file(s) in a complete scan`,
          severity: "success",
          payload: {
            scanCompleteness: ctx.scanCompleteness,
            ruleEvaluationComplete: ctx.ruleEvaluationComplete,
          },
        });
      }

      return { events };
    },
  },

  "plugin-performance": {
    async onScanComplete(ctx) {
      if (ctx.entitiesExtracted === 0) return {};

      const events: PluginEvent[] = [];
      const avgDegree =
        ctx.entitiesExtracted > 0
          ? (ctx.relationshipsExtracted * 2) / ctx.entitiesExtracted
          : 0;

      if (avgDegree > 8) {
        events.push({
          type: "PerfPluginAdvisory",
          message: `Performance profiler: high coupling detected (avg degree ${avgDegree.toFixed(1)}) — consider reducing inter-module dependencies`,
          severity: "warning",
          payload: { avgDegree, entityCount: ctx.entitiesExtracted, relCount: ctx.relationshipsExtracted },
        });
      } else {
        events.push({
          type: "PerfPluginAnalysis",
          message: `Performance profiler: avg dependency degree ${avgDegree.toFixed(1)} across ${ctx.entitiesExtracted} entities`,
          severity: "info",
          payload: { avgDegree, entityCount: ctx.entitiesExtracted },
        });
      }

      return { events };
    },
  },

  "plugin-python": {
    async onScanComplete(ctx) {
      if (ctx.language !== "python") return {};

      const pythonEntities = ctx.entities.filter(
        (e) => e.path?.endsWith(".py") || !e.path,
      );
      const classes = pythonEntities.filter((e) => e.type === "class");
      const functions = pythonEntities.filter((e) => e.type === "function");
      const events: PluginEvent[] = [];

      events.push({
        type: "PythonPluginAnalysis",
        message: `Python/FastAPI analyzer: ${classes.length} class(es), ${functions.length} function(s) extracted`,
        severity: "info",
        payload: { classCount: classes.length, functionCount: functions.length },
      });

      // Flag classes without init methods as potentially incomplete dataclasses.
      const noInit = classes.filter(
        (c) =>
          !pythonEntities.some(
            (e) => e.type === "function" && e.name === `${c.name}.__init__`,
          ),
      );
      if (noInit.length > 0) {
        events.push({
          type: "PythonPluginAdvisory",
          message: `Python analyzer: ${noInit.length} class(es) may lack __init__ — consider using dataclasses or explicit constructors`,
          severity: "info",
          payload: { classes: noInit.slice(0, 5).map((c) => c.name) },
        });
      }

      return { events };
    },
  },

  "plugin-docs": {
    async onScanComplete(ctx) {
      const documentableTypes = ["function", "class", "api"];
      const documentable = ctx.entities.filter((e) =>
        documentableTypes.includes(e.type),
      );
      const events: PluginEvent[] = [];

      if (documentable.length > 0) {
        // Use real JSDoc/docstring coverage extracted by the scanner's AST
        // pipeline. `isDocumented` is set on entities that have a leading
        // JSDoc block (`/** ... */`) for TS/JS or a docstring for Python.
        // Fall back to the old entity-density heuristic only when the scanner
        // hasn't populated `isDocumented` on any entity (legacy scan data).
        const hasDocData = documentable.some((e) => e.isDocumented !== undefined);
        let coverageRatio: number;
        let isHeuristic: boolean;

        if (hasDocData) {
          const documentedCount = documentable.filter((e) => e.isDocumented).length;
          coverageRatio = documentedCount / documentable.length;
          isHeuristic = false;
        } else {
          // Legacy fallback: entity density relative to source files.
          coverageRatio = ctx.sourceFiles > 0 ? documentable.length / ctx.sourceFiles : 0;
          isHeuristic = true;
        }

        const severity: EventSeverity = coverageRatio < 0.5 ? "warning" : "info";
        const documentedCount = hasDocData
          ? documentable.filter((e) => e.isDocumented).length
          : null;

        events.push({
          type: "DocsPluginAnalysis",
          message: isHeuristic
            ? `Documentation heuristic (advisory): ${documentable.length} documentable entity/entities across ${ctx.sourceFiles} source file(s) — entity density only, not real doc coverage`
            : `Documentation coverage: ${documentedCount}/${documentable.length} documentable entities have JSDoc/docstrings (${Math.round(coverageRatio * 100)}%)`,
          severity,
          payload: {
            documentableCount: documentable.length,
            documentedCount,
            sourceFiles: ctx.sourceFiles,
            coverageRatio: Math.round(coverageRatio * 100) / 100,
            isHeuristic,
          },
        });
      }

      return { events };
    },
  },
};

export function isScanHookImplemented(pluginId: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLUGIN_HOOKS, pluginId);
}

// ─── Durable dispatcher ──────────────────────────────────────────────────────

/**
 * Record the immutable scan snapshot and one idempotent run per compatible,
 * enabled built-in plugin in the scan's transaction.
 */
export async function persistPluginDispatch(
  tx: ScanJobTransaction,
  ctx: ScanCompleteContext,
  scanJobId?: string,
): Promise<string | null> {
  const availablePlugins = await tx
    .select({
      id: pluginsTable.id,
      version: pluginsTable.version,
      supportedLanguages: pluginsTable.supportedLanguages,
    })
    .from(projectPluginBindingsTable)
    .innerJoin(
      pluginsTable,
      eq(projectPluginBindingsTable.pluginId, pluginsTable.id),
    )
    .where(and(
      eq(projectPluginBindingsTable.projectId, ctx.projectId),
      eq(projectPluginBindingsTable.enabled, true),
      eq(pluginsTable.enabled, true),
    ));
  const eligiblePlugins = availablePlugins.filter(
    (plugin) =>
      isScanHookImplemented(plugin.id) &&
      isPluginLanguageCompatible(plugin.supportedLanguages, ctx.language),
  );
  if (eligiblePlugins.length === 0) return null;

  const [batch] = await tx
    .insert(pluginDispatchBatchesTable)
    .values({
      id: ctx.scanCorrelationId,
      projectId: ctx.projectId,
      scanJobId: scanJobId ?? null,
      context: ctx as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: pluginDispatchBatchesTable.id })
    .returning({ id: pluginDispatchBatchesTable.id });

  if (!batch) {
    const existingRuns = await tx
      .select({ id: pluginRunsTable.id })
      .from(pluginRunsTable)
      .where(eq(pluginRunsTable.dispatchId, ctx.scanCorrelationId));
    if (existingRuns.length > 0) return ctx.scanCorrelationId;
    throw new Error("plugin dispatch batch exists without any run records");
  }

  await tx
    .insert(pluginRunsTable)
    .values(eligiblePlugins.map((plugin) => ({
      id: randomUUID(),
      dispatchId: ctx.scanCorrelationId,
      pluginId: plugin.id,
      pluginVersion: plugin.version,
      status: "pending",
      attemptCount: 0,
      maxAttempts: PLUGIN_RUN_MAX_ATTEMPTS,
      nextAttemptAt: new Date(),
    })))
    .onConflictDoNothing({
      target: [pluginRunsTable.dispatchId, pluginRunsTable.pluginId],
    });
  return ctx.scanCorrelationId;
}

type PluginRunDispatchOptions = {
  dispatchId?: string;
};

/**
 * Enqueue pending and lease-expired plugin runs. PostgreSQL remains the source
 * of truth; the in-process queue is only a bounded dispatch handle.
 */
export async function dispatchPendingPluginRuns(
  options: PluginRunDispatchOptions = {},
): Promise<number> {
  const pendingCapacity = heavyJobQueue.availablePendingCapacity;
  if (pendingCapacity <= 0) return 0;

  const staleLease = or(
    isNull(pluginRunsTable.leaseUntil),
    lt(pluginRunsTable.leaseUntil, databaseNow()),
  )!;
  await db
    .update(pluginRunsTable)
    .set({
      status: "failed",
      lastErrorCode: "PLUGIN_RUN_ATTEMPTS_EXHAUSTED",
      workerId: null,
      leaseUntil: null,
      finishedAt: databaseNow(),
      updatedAt: databaseNow(),
    })
    .where(and(
      eq(pluginRunsTable.status, "running"),
      staleLease,
      gte(pluginRunsTable.attemptCount, pluginRunsTable.maxAttempts),
    ));

  const conditions = [
    or(
      and(
        eq(pluginRunsTable.status, "pending"),
        lte(pluginRunsTable.nextAttemptAt, databaseNow()),
        lt(pluginRunsTable.attemptCount, pluginRunsTable.maxAttempts),
      ),
      and(
        eq(pluginRunsTable.status, "running"),
        staleLease,
        lt(pluginRunsTable.attemptCount, pluginRunsTable.maxAttempts),
      ),
    )!,
  ];
  if (options.dispatchId) {
    conditions.push(eq(pluginRunsTable.dispatchId, options.dispatchId));
  }
  const rows = await db
    .select({ id: pluginRunsTable.id })
    .from(pluginRunsTable)
    .where(and(...conditions))
    .orderBy(asc(pluginRunsTable.createdAt), asc(pluginRunsTable.id))
    .limit(Math.min(pendingCapacity, PLUGIN_RUN_DISPATCH_PAGE_SIZE));

  let enqueued = 0;
  for (const row of rows) {
    const result = heavyJobQueue.enqueueWithIdDetailed(
      row.id,
      () => runPluginRun(row.id),
    );
    if (result === "full") break;
    if (result === "enqueued") enqueued++;
  }
  return enqueued;
}

/**
 * Compatibility entry point for callers outside the scan transaction. Normal
 * scans persist the dispatch snapshot atomically with their own completion.
 */
export async function dispatchOnScanComplete(
  ctx: ScanCompleteContext,
  scanJobId?: string,
): Promise<void> {
  try {
    const dispatchId = await db.transaction((tx) =>
      persistPluginDispatch(tx, ctx, scanJobId),
    );
    if (dispatchId) await dispatchPendingPluginRuns({ dispatchId });
  } catch (err) {
    logger.error(
      { err, projectId: ctx.projectId, scanCorrelationId: ctx.scanCorrelationId },
      "plugin-runtime: failed to persist or dispatch scan hooks",
    );
  }
}

async function runPluginRun(runId: string): Promise<void> {
  const workerId = randomUUID();
  const staleLease = or(
    isNull(pluginRunsTable.leaseUntil),
    lt(pluginRunsTable.leaseUntil, databaseNow()),
  )!;
  const [claimed] = await db
    .update(pluginRunsTable)
    .set({
      status: "running",
      attemptCount: sql`${pluginRunsTable.attemptCount} + 1`,
      workerId,
      leaseUntil: databaseLeaseUntil(PLUGIN_RUN_LEASE_MS),
      startedAt: databaseNow(),
      finishedAt: null,
      updatedAt: databaseNow(),
    })
    .where(and(
      eq(pluginRunsTable.id, runId),
      or(
        and(
          eq(pluginRunsTable.status, "pending"),
          lte(pluginRunsTable.nextAttemptAt, databaseNow()),
          lt(pluginRunsTable.attemptCount, pluginRunsTable.maxAttempts),
        ),
        and(
          eq(pluginRunsTable.status, "running"),
          staleLease,
          lt(pluginRunsTable.attemptCount, pluginRunsTable.maxAttempts),
        ),
      ),
    ))
    .returning({
      dispatchId: pluginRunsTable.dispatchId,
      pluginId: pluginRunsTable.pluginId,
      attemptCount: pluginRunsTable.attemptCount,
      maxAttempts: pluginRunsTable.maxAttempts,
    });
  if (!claimed) return;

  try {
    const [dispatch] = await db
      .select({ context: pluginDispatchBatchesTable.context })
      .from(pluginDispatchBatchesTable)
      .where(eq(pluginDispatchBatchesTable.id, claimed.dispatchId))
      .limit(1);
    if (!dispatch) throw Object.assign(new Error("dispatch context missing"), { code: "PLUGIN_CONTEXT_MISSING" });
    const hook = PLUGIN_HOOKS[claimed.pluginId];
    if (!hook) throw Object.assign(new Error("plugin hook unavailable"), { code: "PLUGIN_HOOK_UNAVAILABLE" });

    const context = dispatch.context as unknown as ScanCompleteContext;
    const result = await hook.onScanComplete(context);
    const events = result.events ?? [];
    const completed = await db.transaction(async (tx) => {
      const [owned] = await tx
        .update(pluginRunsTable)
        .set({
          status: "completed",
          resultEvents: events.map((event) => ({
            type: event.type,
            message: event.message,
            severity: event.severity,
            payload: event.payload ?? null,
          })),
          workerId: null,
          leaseUntil: null,
          lastErrorCode: null,
          finishedAt: databaseNow(),
          updatedAt: databaseNow(),
        })
        .where(and(
          eq(pluginRunsTable.id, runId),
          eq(pluginRunsTable.status, "running"),
          eq(pluginRunsTable.workerId, workerId),
          gt(pluginRunsTable.leaseUntil, databaseNow()),
        ))
        .returning({ id: pluginRunsTable.id });
      if (!owned) return false;
      if (events.length > 0) {
        await tx.insert(eventsTable).values(events.map((event) => ({
          id: randomUUID(),
          type: event.type,
          projectId: context.projectId,
          severity: event.severity,
          message: event.message,
          payload: (event.payload ?? null) as Record<string, unknown> | null,
          timestamp: new Date(),
          correlationId: context.scanCorrelationId,
        })));
      }
      return true;
    });
    if (completed) {
      logger.debug(
        { pluginId: claimed.pluginId, runId, eventCount: events.length },
        "plugin hook run completed",
      );
    }
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err &&
      typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code.slice(0, 80)
      : "PLUGIN_HOOK_FAILED";
    const retryDelay = Math.min(
      PLUGIN_RUN_RETRY_BASE_MS * 2 ** Math.max(0, claimed.attemptCount - 1),
      PLUGIN_RUN_RETRY_MAX_MS,
    );
    const terminal = claimed.attemptCount >= claimed.maxAttempts;
    try {
      await db
        .update(pluginRunsTable)
        .set({
          status: terminal ? "failed" : "pending",
          nextAttemptAt: terminal
            ? databaseNow()
            : sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') + (${retryDelay} * interval '1 millisecond')`,
          workerId: null,
          leaseUntil: null,
          lastErrorCode: code,
          finishedAt: terminal ? databaseNow() : null,
          updatedAt: databaseNow(),
        })
        .where(and(
          eq(pluginRunsTable.id, runId),
          eq(pluginRunsTable.status, "running"),
          eq(pluginRunsTable.workerId, workerId),
        ));
    } catch (persistError) {
      logger.error(
        { err: persistError, runId, pluginId: claimed.pluginId },
        "plugin-runtime: failed to persist hook retry state; lease recovery will retry",
      );
    }
    logger.error(
      {
        err,
        runId,
        pluginId: claimed.pluginId,
        attemptCount: claimed.attemptCount,
        willRetry: !terminal,
      },
      "plugin-runtime: hook attempt failed",
    );
  }
}

/**
 * Resolve the scan-hook set as the intersection of global availability and
 * the project's explicit activation bindings. A missing binding is disabled.
 */
export async function resolveEffectivePluginIds(
  projectId: string,
  language?: string,
): Promise<string[]> {
  const rows = await db
    .select({
      id: pluginsTable.id,
      supportedLanguages: pluginsTable.supportedLanguages,
    })
    .from(projectPluginBindingsTable)
    .innerJoin(
      pluginsTable,
      eq(projectPluginBindingsTable.pluginId, pluginsTable.id),
    )
    .where(
      and(
        eq(projectPluginBindingsTable.projectId, projectId),
        eq(projectPluginBindingsTable.enabled, true),
        eq(pluginsTable.enabled, true),
      ),
    );

  return rows
    .filter(({ id, supportedLanguages }) =>
      isScanHookImplemented(id) &&
      (language === undefined || isPluginLanguageCompatible(supportedLanguages, language)),
    )
    .map(({ id }) => id)
    .sort();
}
