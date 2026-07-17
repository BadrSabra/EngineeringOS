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
import { pluginsTable, eventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Hook context ─────────────────────────────────────────────────────────────

export interface ExtractedEntity {
  type: string;
  name: string;
  path?: string | null;
}

export interface RuleViolationSummary {
  ruleId: string;
  code: string;
  severity: string;
  matchCount: number;
}

export interface ScanCompleteContext {
  projectId: string;
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
      } else if (ctx.issuesDetected === 0 && ctx.sourceFiles > 0) {
        events.push({
          type: "SecurityPluginClear",
          message: `OWASP scanner: no security violations detected across ${ctx.sourceFiles} source file(s)`,
          severity: "success",
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
        // The scanner does not yet extract JSDoc/docstrings from entity
        // metadata, so true documentation coverage cannot be computed.
        // This score is a *heuristic advisory* — entity density relative to
        // source files — not actual coverage. It is labelled and exposed as
        // such so consumers never mistake it for a real doc-coverage metric.
        // TODO: replace with JSDoc/docstring extraction from scanner once
        // that feature lands, then promote to a real coverage score.
        const heuristicRatio =
          ctx.sourceFiles > 0
            ? documentable.length / ctx.sourceFiles
            : 0;
        const severity: EventSeverity =
          heuristicRatio < 0.5 ? "warning" : "info";

        events.push({
          type: "DocsPluginAnalysis",
          message: `Documentation heuristic (advisory): ${documentable.length} documentable entity/entities across ${ctx.sourceFiles} source file(s) — ratio is entity density, not real doc coverage`,
          severity,
          payload: {
            documentableCount: documentable.length,
            sourceFiles: ctx.sourceFiles,
            heuristicRatio: Math.round(heuristicRatio * 100) / 100,
            advisory: true,
          },
        });
      }

      return { events };
    },
  },
};

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Called after a successful scan transaction has committed.
 * Loads all enabled plugins from the database, invokes their `onScanComplete`
 * hook, and persists any events they return.
 *
 * Like recordAudit, plugin dispatch is best-effort telemetry: a plugin
 * failure must not fail or roll back the scan itself. Errors are logged
 * loudly so they are visible but do not surface to the caller.
 */
export async function dispatchOnScanComplete(
  ctx: ScanCompleteContext,
): Promise<void> {
  let enabledPlugins: { id: string }[] = [];
  try {
    enabledPlugins = await db
      .select({ id: pluginsTable.id })
      .from(pluginsTable)
      .where(eq(pluginsTable.enabled, true));
  } catch (err) {
    logger.error({ err }, "plugin-runtime: failed to load enabled plugins");
    return;
  }

  const dispatches = enabledPlugins
    .filter(({ id }) => id in PLUGIN_HOOKS)
    .map(async ({ id }) => {
      const hook = PLUGIN_HOOKS[id]!;
      try {
        const result = await hook.onScanComplete(ctx);
        if (!result.events || result.events.length === 0) return;

        const now = new Date();
        await db.insert(eventsTable).values(
          result.events.map((e) => ({
            id: randomUUID(),
            type: e.type,
            projectId: ctx.projectId,
            severity: e.severity,
            message: e.message,
            payload: (e.payload ?? null) as Record<string, unknown> | null,
            timestamp: now,
          })),
        );
        logger.debug({ pluginId: id, eventCount: result.events.length }, "plugin hook dispatched");
      } catch (err) {
        logger.error(
          { err, pluginId: id },
          "plugin-runtime: plugin hook onScanComplete threw — skipping",
        );
      }
    });

  await Promise.allSettled(dispatches);
}
