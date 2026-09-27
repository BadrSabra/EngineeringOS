import { randomUUID } from "crypto";
import { Router } from "express";
import { UpdateProjectPluginBindingBody } from "@workspace/api-zod";
import {
  db,
  pluginsTable,
  projectPluginBindingsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "../lib/audit.js";
import { isScanHookImplemented } from "../lib/plugin-runtime.js";
import { requireOperator } from "../middlewares/requireAuth.js";
import {
  requireProjectAccess,
  requireProjectWriteAccess,
} from "../middlewares/requireProjectAccess.js";

const router = Router();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeProjectConfiguration(value: unknown): value is Record<string, unknown> {
  // No built-in plugin currently declares a project configuration schema.
  // Until it does, accept only the empty object rather than storing arbitrary
  // values (which could include credentials under unexpected field names).
  return isPlainRecord(value) && Object.keys(value).length === 0;
}

function serializePlugin(plugin: {
  id: string;
  name: string;
  description: string | null;
  version: string;
  enabled: boolean;
  capabilities: string[] | null;
  supportedLanguages: string[] | null;
}) {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    available: plugin.enabled,
    capabilities: plugin.capabilities ?? [],
    supportedLanguages: plugin.supportedLanguages ?? [],
  };
}

const DEFAULT_PLUGINS = [
  {
    id: "plugin-react",
    name: "React/TypeScript Analyzer",
    description:
      "Analyzes React and TypeScript projects for component anti-patterns, unused hooks, and prop drilling issues.",
    version: "1.2.0",
    enabled: true,
    capabilities: ["analyzer", "rules"],
    supportedLanguages: ["typescript", "javascript"],
  },
  {
    id: "plugin-node",
    name: "Node.js/Express Analyzer",
    description:
      "Scans Express APIs for missing auth middleware, raw SQL, and insecure route patterns.",
    version: "1.1.0",
    enabled: true,
    capabilities: ["analyzer", "rules", "verifier"],
    supportedLanguages: ["javascript", "typescript"],
  },
  {
    id: "plugin-security",
    name: "OWASP Security Scanner",
    description:
      "Applies OWASP Top 10 rules: injection, XSS, insecure deserialization, broken auth.",
    version: "2.0.1",
    enabled: true,
    capabilities: ["analyzer", "rules", "reporter"],
    supportedLanguages: ["typescript", "javascript", "python", "go"],
  },
  {
    id: "plugin-performance",
    name: "Performance Profiler",
    description:
      "Detects N+1 queries, missing indexes, large bundle imports, and memory leaks.",
    version: "1.0.3",
    enabled: false,
    capabilities: ["analyzer", "verifier"],
    supportedLanguages: ["typescript", "javascript"],
  },
  {
    id: "plugin-python",
    name: "Python/FastAPI Analyzer",
    description:
      "Analyzes Python projects for type hint coverage, missing tests, and FastAPI patterns.",
    version: "0.9.2",
    enabled: false,
    capabilities: ["analyzer", "rules"],
    supportedLanguages: ["python"],
  },
  {
    id: "plugin-docs",
    name: "Documentation Generator",
    description:
      "Generates JSDoc/docstring coverage reports and flags undocumented public APIs.",
    version: "1.0.0",
    enabled: true,
    capabilities: ["reporter"],
    supportedLanguages: ["typescript", "javascript", "python"],
  },
];

let seeded = false;
async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  const existing = await db.select({ id: pluginsTable.id }).from(pluginsTable).limit(1);
  if (existing.length === 0) {
    const now = new Date();
    await db.insert(pluginsTable).values(
      DEFAULT_PLUGINS.map((p) => ({ ...p, createdAt: now, updatedAt: now })),
    );
  }
  seeded = true;
}

router.get("/plugins", async (_req, res) => {
  await ensureSeeded();
  const plugins = await db.select().from(pluginsTable);
  return res.json(plugins.map(serializePlugin));
});

router.post("/plugins/:pluginId/enable", requireOperator, async (req, res) => {
  await ensureSeeded();
  const pluginId = String(req.params.pluginId);

  const plugin = await db
    .select()
    .from(pluginsTable)
    .where(eq(pluginsTable.id, pluginId))
    .limit(1);
  if (!plugin[0]) return res.status(404).json({ error: "Plugin not found" });

  const [updated] = await db
    .update(pluginsTable)
    .set({ enabled: true, updatedAt: new Date() })
    .where(eq(pluginsTable.id, pluginId))
    .returning();

  await recordAudit({
    entityType: "plugin",
    entityId: pluginId,
    action: "enabled",
    actor: req.userId,
    stateBefore: { available: plugin[0].enabled },
    stateAfter: { available: true },
  });

  return res.json(serializePlugin(updated));
});

router.post("/plugins/:pluginId/disable", requireOperator, async (req, res) => {
  await ensureSeeded();
  const pluginId = String(req.params.pluginId);

  const plugin = await db
    .select()
    .from(pluginsTable)
    .where(eq(pluginsTable.id, pluginId))
    .limit(1);
  if (!plugin[0]) return res.status(404).json({ error: "Plugin not found" });

  const [updated] = await db
    .update(pluginsTable)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(pluginsTable.id, pluginId))
    .returning();

  await recordAudit({
    entityType: "plugin",
    entityId: pluginId,
    action: "disabled",
    actor: req.userId,
    stateBefore: { available: plugin[0].enabled },
    stateAfter: { available: false },
  });

  return res.json(serializePlugin(updated));
});

router.get(
  "/projects/:projectId/plugins",
  requireProjectAccess,
  async (req, res) => {
    await ensureSeeded();
    const projectId = req.project?.id;
    if (!projectId) return res.status(404).json({ error: "Project not found" });
    const rows = await db
      .select({
        id: pluginsTable.id,
        name: pluginsTable.name,
        description: pluginsTable.description,
        version: pluginsTable.version,
        enabled: pluginsTable.enabled,
        capabilities: pluginsTable.capabilities,
        supportedLanguages: pluginsTable.supportedLanguages,
        projectEnabled: projectPluginBindingsTable.enabled,
        configuration: projectPluginBindingsTable.configuration,
      })
      .from(pluginsTable)
      .leftJoin(
        projectPluginBindingsTable,
        and(
          eq(projectPluginBindingsTable.pluginId, pluginsTable.id),
          eq(projectPluginBindingsTable.projectId, projectId),
        ),
      )
      .orderBy(pluginsTable.name);

    return res.json(
      rows.map((row) => ({
        ...serializePlugin(row),
        projectEnabled: row.projectEnabled ?? false,
        scanHookImplemented: isScanHookImplemented(row.id),
        effectiveForProjectScan:
          row.enabled &&
          (row.projectEnabled ?? false) &&
          isScanHookImplemented(row.id),
        configuration: row.configuration ?? {},
      })),
    );
  },
);

router.put(
  "/projects/:projectId/plugins/:pluginId",
  requireProjectWriteAccess,
  async (req, res) => {
    await ensureSeeded();
    const projectId = req.project?.id;
    if (!projectId) return res.status(404).json({ error: "Project not found" });
    const pluginId = String(req.params.pluginId);
    const parsed = UpdateProjectPluginBindingBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid project plugin update" });
    }

    if (
      parsed.data.configuration !== undefined &&
      !isSafeProjectConfiguration(parsed.data.configuration)
    ) {
      return res.status(400).json({
        error:
          "This plugin has no project-configuration schema yet. Do not store credentials in plugin configuration.",
        code: "PLUGIN_CONFIGURATION_SCHEMA_UNAVAILABLE",
      });
    }

    const plugin = await db
      .select()
      .from(pluginsTable)
      .where(eq(pluginsTable.id, pluginId))
      .limit(1);
    if (!plugin[0]) return res.status(404).json({ error: "Plugin not found" });
    if (parsed.data.enabled && !plugin[0].enabled) {
      return res.status(409).json({
        error: "This plugin is globally unavailable.",
        code: "PLUGIN_UNAVAILABLE",
      });
    }
    if (parsed.data.enabled && !isScanHookImplemented(pluginId)) {
      return res.status(409).json({
        error: "No scan hook is registered for this plugin.",
        code: "PLUGIN_SCAN_HOOK_UNAVAILABLE",
      });
    }

    const existing = await db
      .select()
      .from(projectPluginBindingsTable)
      .where(
        and(
          eq(projectPluginBindingsTable.projectId, projectId),
          eq(projectPluginBindingsTable.pluginId, pluginId),
        ),
      )
      .limit(1);
    const now = new Date();
    const bindingValues = {
      id: randomUUID(),
      projectId,
      pluginId,
      enabled: parsed.data.enabled,
      configuration: parsed.data.configuration ?? {},
      approvedBy: parsed.data.enabled ? req.userId : null,
      createdAt: now,
      updatedAt: now,
    };
    const conflictUpdate = {
      enabled: parsed.data.enabled,
      approvedBy: parsed.data.enabled ? req.userId : null,
      updatedAt: now,
      ...(parsed.data.configuration === undefined
        ? {}
        : { configuration: parsed.data.configuration }),
    };
    const [binding] = await db
      .insert(projectPluginBindingsTable)
      .values(bindingValues)
      .onConflictDoUpdate({
        target: [
          projectPluginBindingsTable.projectId,
          projectPluginBindingsTable.pluginId,
        ],
        set: conflictUpdate,
      })
      .returning();

    await recordAudit({
      entityType: "plugin",
      entityId: pluginId,
      projectId,
      actor: req.userId,
      action: parsed.data.enabled ? "enabled" : "disabled",
      stateBefore: {
        projectEnabled: existing[0]?.enabled ?? false,
        available: plugin[0].enabled,
      },
      stateAfter: {
        projectEnabled: binding.enabled,
        available: plugin[0].enabled,
      },
    });

    return res.json({
      ...serializePlugin(plugin[0]),
      projectEnabled: binding.enabled,
      scanHookImplemented: isScanHookImplemented(pluginId),
      effectiveForProjectScan:
        plugin[0].enabled &&
        binding.enabled &&
        isScanHookImplemented(pluginId),
      configuration: binding.configuration,
    });
  },
);

export default router;
