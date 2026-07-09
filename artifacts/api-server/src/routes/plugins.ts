import { Router } from "express";
import { db } from "@workspace/db";
import { pluginsTable } from "@workspace/db";
import { EnablePluginBody, DisablePluginBody } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router = Router();

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
  return res.json(plugins);
});

router.post("/plugins/:pluginId/enable", async (req, res) => {
  await ensureSeeded();
  const { pluginId } = req.params;
  EnablePluginBody.parse(req.body);

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

  return res.json(updated);
});

router.post("/plugins/:pluginId/disable", async (req, res) => {
  await ensureSeeded();
  const { pluginId } = req.params;
  DisablePluginBody.parse(req.body);

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

  return res.json(updated);
});

export default router;
