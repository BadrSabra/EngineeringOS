import { Router } from "express";
import { stat } from "node:fs/promises";
import { db } from "@workspace/db";
import {
  discoverySessionsTable,
  projectsTable,
  rulesTable,
  eventsTable,
  metricsTable,
  graphEntitiesTable,
  graphRelationshipsTable,
  tasksTable,
  type DiscoveryResultData,
  type DiscoveryStep,
} from "@workspace/db";
import {
  StartDiscoveryBody,
  ImportProjectBody,
  GetDiscoverySessionParams,
  GetDiscoverySummaryParams,
} from "@workspace/api-zod";
import { eq, and, or, isNull, lt } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  walkProject,
  matchRules,
  extractGraph,
  computeMetrics,
  type RuleInput,
} from "@workspace/scanner";
import type { ScannedFile } from "@workspace/scanner";
import { logger } from "../lib/logger.js";
import { recordAudit } from "../lib/audit.js";

const router = Router();

// ─── Metadata detection helpers ────────────────────────────────────────────────

interface ParsedPackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  workspaces?: string[] | { packages?: string[] };
  packageManager?: string;
}

function parsePkgJson(files: ScannedFile[]): ParsedPackageJson | null {
  const root = files.find((f) => f.path === "package.json" || f.path.endsWith("/package.json") && !f.path.includes("node_modules"));
  // prefer root-level
  const rootLevel = files.filter(
    (f) =>
      f.path === "package.json" ||
      (!f.path.includes("/") && f.path === "package.json"),
  );
  const target = rootLevel[0] ?? root;
  if (!target?.content) return null;
  try {
    return JSON.parse(target.content) as ParsedPackageJson;
  } catch {
    return null;
  }
}

function detectProjectName(files: ScannedFile[], rootPath: string): string {
  // Try package.json
  const pkg = parsePkgJson(files);
  if (pkg?.name && !pkg.name.startsWith("@workspace/")) return pkg.name;

  // Try pyproject.toml
  const pyproject = files.find((f) => f.path === "pyproject.toml");
  if (pyproject?.content) {
    const m = pyproject.content.match(/^name\s*=\s*["'](.+?)["']/m);
    if (m) return m[1];
  }

  // Try Cargo.toml
  const cargo = files.find((f) => f.path === "Cargo.toml");
  if (cargo?.content) {
    const m = cargo.content.match(/^name\s*=\s*"(.+?)"/m);
    if (m) return m[1];
  }

  // Try go.mod
  const gomod = files.find((f) => f.path === "go.mod");
  if (gomod?.content) {
    const m = gomod.content.match(/^module\s+(.+)/m);
    if (m) return m[1].split("/").pop() ?? "unknown";
  }

  // Fallback: last segment of rootPath
  const parts = rootPath.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] ?? "unknown";
}

function detectLanguages(files: ScannedFile[]): { primary: string; all: string[] } {
  const counts: Record<string, number> = {};
  for (const f of files) {
    if (f.language && f.language !== "json" && f.language !== "yaml" && f.language !== "toml" && f.language !== "markdown") {
      counts[f.language] = (counts[f.language] ?? 0) + f.lines;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return {
    primary: sorted[0]?.[0] ?? "unknown",
    all: sorted.map(([lang]) => lang),
  };
}

function detectFramework(files: ScannedFile[], allDeps: Record<string, string>): string | null {
  // JS/TS frameworks — check package.json deps first (most reliable)
  if (allDeps["express"]) return `Express ${allDeps["express"].replace(/[\^~>=<\s]/g, "").slice(0, 6)}`;
  if (allDeps["fastify"]) return `Fastify ${allDeps["fastify"].replace(/[\^~>=<\s]/g, "").slice(0, 6)}`;
  if (allDeps["next"]) return `Next.js ${allDeps["next"].replace(/[\^~>=<\s]/g, "").slice(0, 6)}`;
  if (allDeps["nuxt"]) return `Nuxt ${allDeps["nuxt"].replace(/[\^~>=<\s]/g, "").slice(0, 6)}`;
  if (allDeps["@nestjs/core"]) return `NestJS ${allDeps["@nestjs/core"].replace(/[\^~>=<\s]/g, "").slice(0, 6)}`;
  if (allDeps["hono"]) return `Hono ${allDeps["hono"].replace(/[\^~>=<\s]/g, "").slice(0, 6)}`;
  if (allDeps["koa"]) return `Koa ${allDeps["koa"].replace(/[\^~>=<\s]/g, "").slice(0, 6)}`;

  // Python frameworks — scope content checks to Python files only to avoid false positives
  const pyFiles = files.filter((f) => f.language === "python");
  if (allDeps["fastapi"] || pyFiles.some((f) => f.content?.includes("from fastapi"))) return "FastAPI";
  if (allDeps["django"] || pyFiles.some((f) => f.content?.includes("from django"))) return "Django";
  if (allDeps["flask"] || pyFiles.some((f) => f.content?.includes("from flask"))) return "Flask";

  // JVM
  if (files.some((f) => f.path === "pom.xml" && f.content?.includes("spring"))) return "Spring Boot";
  return null;
}

function detectRuntime(files: ScannedFile[], pkg: ParsedPackageJson | null): string | null {
  const nvmrc = files.find((f) => f.path === ".nvmrc" || f.path === ".node-version");
  if (nvmrc?.content) return `Node.js ${nvmrc.content.trim()}`;
  if (pkg?.engines?.node) return `Node.js ${pkg.engines.node}`;
  const toolVersions = files.find((f) => f.path === ".tool-versions");
  if (toolVersions?.content) {
    const m = toolVersions.content.match(/nodejs\s+([\d.]+)/);
    if (m) return `Node.js ${m[1]}`;
    const py = toolVersions.content.match(/python\s+([\d.]+)/);
    if (py) return `Python ${py[1]}`;
  }
  // Infer from language
  if (files.some((f) => f.language === "typescript" || f.language === "javascript")) return "Node.js";
  if (files.some((f) => f.language === "python")) return "Python";
  if (files.some((f) => f.language === "rust")) return "Rust";
  if (files.some((f) => f.language === "go")) return "Go";
  return null;
}

function detectPackageManager(files: ScannedFile[]): string | null {
  if (files.some((f) => f.path === "pnpm-lock.yaml")) return "pnpm";
  if (files.some((f) => f.path === "yarn.lock")) return "yarn";
  if (files.some((f) => f.path === "package-lock.json")) return "npm";
  if (files.some((f) => f.path === "bun.lockb" || f.path === "bun.lock")) return "bun";
  if (files.some((f) => f.path === "Pipfile.lock")) return "pipenv";
  if (files.some((f) => f.path === "poetry.lock")) return "poetry";
  if (files.some((f) => f.path === "Cargo.lock")) return "cargo";
  if (files.some((f) => f.path === "go.sum")) return "go modules";
  return null;
}

function detectDb(allDeps: Record<string, string>, files: ScannedFile[]): { db: string | null; orm: string | null } {
  let detectedDb: string | null = null;
  let orm: string | null = null;
  if (allDeps["pg"] || allDeps["postgres"]) detectedDb = "PostgreSQL";
  else if (allDeps["mysql2"] || allDeps["mysql"]) detectedDb = "MySQL";
  else if (allDeps["mongodb"] || allDeps["mongoose"]) detectedDb = "MongoDB";
  else if (allDeps["better-sqlite3"] || allDeps["sqlite3"]) detectedDb = "SQLite";
  else if (allDeps["@prisma/client"]) { detectedDb = detectedDb ?? "Prisma-detected"; }
  if (allDeps["drizzle-orm"]) orm = "Drizzle ORM";
  else if (allDeps["@prisma/client"]) orm = "Prisma";
  else if (allDeps["typeorm"]) orm = "TypeORM";
  else if (allDeps["sequelize"]) orm = "Sequelize";
  else if (allDeps["mongoose"]) orm = "Mongoose";
  // Python ORMs
  if (files.some((f) => f.content?.includes("from sqlalchemy"))) orm = "SQLAlchemy";
  return { db: detectedDb, orm };
}

function detectTestFramework(allDeps: Record<string, string>): string | null {
  if (allDeps["vitest"]) return "Vitest";
  if (allDeps["jest"] || allDeps["@jest/core"]) return "Jest";
  if (allDeps["mocha"]) return "Mocha";
  if (allDeps["pytest"] || allDeps["pytest-asyncio"]) return "pytest";
  if (allDeps["rspec"]) return "RSpec";
  return null;
}

function detectBuildTool(allDeps: Record<string, string>, files: ScannedFile[]): string | null {
  if (allDeps["vite"]) return "Vite";
  if (allDeps["esbuild"]) return "esbuild";
  if (allDeps["webpack"]) return "webpack";
  if (allDeps["rollup"]) return "Rollup";
  if (allDeps["turbo"] || files.some((f) => f.path === "turbo.json")) return "Turborepo";
  if (files.some((f) => f.path === "nx.json")) return "Nx";
  return null;
}

function detectCi(files: ScannedFile[]): string | null {
  if (files.some((f) => f.path.startsWith(".github/workflows"))) return "GitHub Actions";
  if (files.some((f) => f.path === ".gitlab-ci.yml")) return "GitLab CI";
  if (files.some((f) => f.path === "Jenkinsfile")) return "Jenkins";
  if (files.some((f) => f.path === ".circleci/config.yml")) return "CircleCI";
  if (files.some((f) => f.path === ".travis.yml")) return "Travis CI";
  return null;
}

function detectArchitecture(files: ScannedFile[], pkg: ParsedPackageJson | null): string | null {
  if (pkg?.workspaces || files.some((f) => f.path === "pnpm-workspace.yaml" || f.path === "lerna.json")) return "Monorepo";
  if (files.some((f) => f.path.includes("docker-compose"))) return "Microservices";
  return "Monolith";
}

function detectRisks(allDeps: Record<string, string>, files: ScannedFile[], testFramework: string | null, ci: string | null): string[] {
  const risks: string[] = [];
  if (!testFramework) risks.push("No test framework detected");
  if (!ci) risks.push("No CI/CD pipeline detected");
  if (files.some((f) => f.content?.includes("process.env.") && !f.content?.includes("dotenv"))) {
    risks.push("Potential hardcoded environment variables");
  }
  if (Object.keys(allDeps).length > 100) risks.push("High dependency count (>100 packages)");
  return risks;
}

function computeConfidence(result: Partial<DiscoveryResultData>, fileCount: number): number {
  let score = 0;
  let total = 0;
  const check = (v: unknown) => { total++; if (v) score++; };
  check(result.detectedName);
  check(result.detectedLanguage);
  check(result.detectedFramework);
  check(result.detectedRuntime);
  check(result.detectedPackageManager);
  check(result.detectedArchitecture);
  check(fileCount > 0);
  return Math.round((score / Math.max(total, 1)) * 100);
}

// ─── Step names ────────────────────────────────────────────────────────────────

const STEPS: DiscoveryStep["name"][] = [
  "Finding repository",
  "Reading configuration files",
  "Detecting languages",
  "Detecting frameworks & runtime",
  "Scanning source tree",
  "Building dependency graph",
  "Calculating metrics",
  "Extracting architecture",
  "Preparing summary",
];

async function updateSession(
  id: string,
  patch: Partial<{
    status: string;
    progress: number;
    currentStep: string | null;
    steps: DiscoveryStep[];
    result: DiscoveryResultData;
    error: string;
    completedAt: Date;
  }>,
): Promise<void> {
  await db
    .update(discoverySessionsTable)
    .set(patch as Record<string, unknown>)
    .where(eq(discoverySessionsTable.id, id));
}

// ─── Background discovery pipeline ────────────────────────────────────────────

async function runDiscovery(sessionId: string, rootPath: string): Promise<void> {
  const steps: DiscoveryStep[] = STEPS.map((name) => ({ name, status: "pending" as const }));

  const setStep = async (idx: number, status: DiscoveryStep["status"], durationMs?: number) => {
    steps[idx] = { ...steps[idx], status, durationMs };
    const progress = Math.round(((idx + (status === "done" ? 1 : 0.5)) / STEPS.length) * 100);
    await updateSession(sessionId, {
      progress,
      currentStep: steps[idx].name,
      steps: [...steps],
    });
  };

  try {
    // Step 0 — Finding repository (hard-fail if path does not exist)
    const t0 = Date.now();
    await setStep(0, "running");
    try {
      const s = await stat(rootPath);
      if (!s.isDirectory()) throw new Error(`Path exists but is not a directory: ${rootPath}`);
    } catch (statErr) {
      const msg = statErr instanceof Error ? statErr.message : String(statErr);
      throw new Error(`Repository path not found or inaccessible: ${msg}`);
    }
    await setStep(0, "done", Date.now() - t0);

    // Step 1 — Reading config files
    const t1 = Date.now();
    await setStep(1, "running");
    const walkResult = await walkProject(rootPath);
    const { files } = walkResult;
    const pkg = parsePkgJson(files);
    const allDeps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    await setStep(1, "done", Date.now() - t1);

    // Step 2 — Detecting languages
    const t2 = Date.now();
    await setStep(2, "running");
    const { primary: detectedLanguage, all: detectedLanguages } = detectLanguages(files);
    await setStep(2, "done", Date.now() - t2);

    // Step 3 — Frameworks & runtime
    const t3 = Date.now();
    await setStep(3, "running");
    const detectedFramework = detectFramework(files, allDeps);
    const detectedRuntime = detectRuntime(files, pkg);
    const detectedPackageManager = detectPackageManager(files);
    const detectedDb = detectDb(allDeps, files);
    const detectedTestFramework = detectTestFramework(allDeps);
    const detectedBuildTool = detectBuildTool(allDeps, files);
    const detectedCi = detectCi(files);
    await setStep(3, "done", Date.now() - t3);

    // Step 4 — Scanning source tree
    const t4 = Date.now();
    await setStep(4, "running");
    // Already walked — derive module count from source files
    const moduleCount = files.filter(
      (f) =>
        f.language !== "markdown" &&
        f.language !== "json" &&
        f.language !== "yaml" &&
        f.language !== "toml",
    ).length;
    const repoSizeBytes = files.reduce((s, f) => s + f.size, 0);
    const packageCount = files.filter((f) => f.path.endsWith("package.json") && !f.path.includes("node_modules")).length;
    await setStep(4, "done", Date.now() - t4);

    // Step 5 — Dependency graph
    const t5 = Date.now();
    await setStep(5, "running");
    const graphResult = extractGraph(files);
    await setStep(5, "done", Date.now() - t5);

    // Step 6 — Metrics
    const t6 = Date.now();
    await setStep(6, "running");
    // Use global rules (no project-scoped rules yet)
    const globalRules = await db
      .select()
      .from(rulesTable)
      .where(and(eq(rulesTable.enabled, true), isNull(rulesTable.projectId)));
    const ruleInputs: RuleInput[] = globalRules.map((r) => ({
      id: r.id,
      code: r.code,
      pattern: r.pattern,
      severity: r.severity,
      enabled: r.enabled,
    }));
    const ruleResults = matchRules(ruleInputs, files);
    const metrics = computeMetrics(files, ruleResults);
    await setStep(6, "done", Date.now() - t6);

    // Step 7 — Architecture
    const t7 = Date.now();
    await setStep(7, "running");
    const detectedArchitecture = detectArchitecture(files, pkg);
    const hasDocker = files.some((f) => f.path === "Dockerfile" || f.path.startsWith("docker-compose"));
    const hasOpenApi = files.some((f) => f.path.includes("openapi") || f.path.includes("swagger"));
    const isMonorepo = detectedArchitecture === "Monorepo";
    // Detect API routes from graph
    const detectedApis = graphResult.entities
      .filter((e) => e.type === "api")
      .map((e) => e.name)
      .slice(0, 30);
    await setStep(7, "done", Date.now() - t7);

    // Step 8 — Summary
    const t8 = Date.now();
    await setStep(8, "running");
    const detectedName = detectProjectName(files, walkResult.rootPath);
    const detectedRisks = detectRisks(allDeps, files, detectedTestFramework, detectedCi);
    const ruleViolations = ruleResults
      .filter((r) => r.matched)
      .map((r) => ({
        code: r.ruleCode,
        title: globalRules.find((g) => g.id === r.ruleId)?.title ?? r.ruleCode,
        severity: r.severity,
        count: r.matchCount,
      }));

    const partial: DiscoveryResultData = {
      detectedName,
      detectedLanguage,
      detectedLanguages,
      detectedFramework,
      detectedRuntime,
      detectedPackageManager,
      detectedArchitecture,
      detectedDb: detectedDb.db,
      detectedOrm: detectedDb.orm,
      detectedTestFramework,
      detectedBuildTool,
      detectedCi,
      isMonorepo,
      hasDocker,
      hasOpenApi,
      packageCount,
      moduleCount,
      repoSizeBytes,
      detectedApis,
      detectedRisks,
      qualityScore: metrics.overallScore,
      confidenceScore: computeConfidence({ detectedName, detectedLanguage, detectedFramework, detectedRuntime, detectedPackageManager, detectedArchitecture }, files.length),
      graphSummary: {
        entityCount: graphResult.entities.length,
        relationshipCount: graphResult.relationships.length,
      },
      ruleViolations,
    };
    await setStep(8, "done", Date.now() - t8);

    await updateSession(sessionId, {
      status: "ready",
      progress: 100,
      currentStep: null,
      steps,
      result: partial,
      completedAt: new Date(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, sessionId }, "Discovery pipeline error");
    await updateSession(sessionId, {
      status: "error",
      error: message,
      completedAt: new Date(),
    }).catch(() => undefined);
  }
}

// ─── Cleanup old sessions (>24h) ──────────────────────────────────────────────

async function cleanupOldSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .delete(discoverySessionsTable)
    .where(lt(discoverySessionsTable.startedAt, cutoff));
}

// ─── Routes ────────────────────────────────────────────────────────────────────

// POST /projects/discover
router.post("/projects/discover", async (req, res) => {
  const body = StartDiscoveryBody.parse(req.body);

  // Cleanup stale sessions opportunistically
  cleanupOldSessions().catch(() => undefined);

  const id = randomUUID();
  const initialSteps: DiscoveryStep[] = STEPS.map((name) => ({
    name,
    status: "pending",
  }));

  await db.insert(discoverySessionsTable).values({
    id,
    status: "discovering",
    rootPath: body.rootPath,
    source: body.source,
    progress: 0,
    currentStep: STEPS[0],
    steps: initialSteps,
    startedAt: new Date(),
  });

  // Kick off background pipeline — do not await
  runDiscovery(id, body.rootPath).catch((err) =>
    logger.error({ err, sessionId: id }, "Unhandled discovery error"),
  );

  const session = await db
    .select()
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.id, id))
    .limit(1);

  return res.status(202).json(toSessionResponse(session[0]));
});

// GET /projects/discover/:discoveryId
router.get("/projects/discover/:discoveryId", async (req, res) => {
  const { discoveryId } = GetDiscoverySessionParams.parse(req.params);
  const session = await db
    .select()
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.id, discoveryId))
    .limit(1);
  if (!session[0]) return res.status(404).json({ error: "Discovery session not found" });
  return res.json(toSessionResponse(session[0]));
});

// GET /projects/discover/:discoveryId/summary
router.get("/projects/discover/:discoveryId/summary", async (req, res) => {
  const { discoveryId } = GetDiscoverySummaryParams.parse(req.params);
  const session = await db
    .select()
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.id, discoveryId))
    .limit(1);
  if (!session[0]) return res.status(404).json({ error: "Discovery session not found" });
  if (session[0].status !== "ready" && session[0].status !== "imported") {
    return res.status(409).json({ error: "Discovery not yet complete", status: session[0].status });
  }
  const result = session[0].result;
  if (!result) return res.status(500).json({ error: "Discovery result missing" });
  return res.json({ id: discoveryId, ...result });
});

// POST /projects/import
router.post("/projects/import", async (req, res) => {
  const body = ImportProjectBody.parse(req.body);

  // Load session — must exist and be in 'ready' state
  const session = await db
    .select()
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.id, body.discoveryId))
    .limit(1);

  if (!session[0]) return res.status(404).json({ error: "Discovery session not found" });
  if (session[0].status !== "ready") {
    return res.status(409).json({ error: "Discovery not complete or already imported", status: session[0].status });
  }

  const result = session[0].result;
  if (!result) return res.status(500).json({ error: "Discovery result missing" });

  const overrides = body.overrides ?? {};
  const now = new Date();
  const projectId = randomUUID();

  const projectName = overrides.name ?? result.detectedName;
  const projectLanguage = overrides.language ?? result.detectedLanguage;
  const projectFramework = overrides.framework ?? result.detectedFramework ?? undefined;
  const projectDescription = overrides.description ?? undefined;

  // Atomic claim: transition ready → importing using conditional WHERE.
  // If another request already claimed it, this returns 0 rows.
  const claimed = await db
    .update(discoverySessionsTable)
    .set({ status: "imported", importedProjectId: projectId })
    .where(
      and(
        eq(discoverySessionsTable.id, body.discoveryId),
        eq(discoverySessionsTable.status, "ready"),
      ),
    )
    .returning({ id: discoverySessionsTable.id });

  if (claimed.length === 0) {
    return res.status(409).json({ error: "Session already imported by another request" });
  }

  // All remaining writes inside a single transaction — rollback on any failure.
  let project: typeof projectsTable.$inferSelect;
  try {
    project = await db.transaction(async (tx) => {
      // 1. Project record
      const [inserted] = await tx
        .insert(projectsTable)
        .values({
          id: projectId,
          name: projectName,
          description: projectDescription,
          rootPath: session[0].rootPath,
          language: projectLanguage,
          framework: projectFramework,
          status: "active",
          qualityScore: result.qualityScore,
          lastScanAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // 2. Initial metrics
      await tx.insert(metricsTable).values({
        id: randomUUID(),
        projectId,
        timestamp: now,
        overallScore: result.qualityScore,
        securityScore:
          result.ruleViolations.filter(
            (r) => r.severity === "critical" || r.severity === "high",
          ).length === 0
            ? 100
            : 60,
        maintainabilityScore: result.qualityScore,
        reliabilityScore: result.qualityScore,
        performanceScore: result.qualityScore,
        lintIssues: result.ruleViolations.reduce((s, r) => s + r.count, 0),
        buildStatus: "unknown",
      });

      // 3. Graph entity stubs from detected API routes
      for (const apiRoute of result.detectedApis.slice(0, 50)) {
        await tx.insert(graphEntitiesTable).values({
          id: randomUUID(),
          projectId,
          type: "api",
          name: apiRoute,
          createdAt: now,
        });
      }

      // 4. Tasks from rule violations (top 20)
      for (const violation of result.ruleViolations.slice(0, 20)) {
        await tx.insert(tasksTable).values({
          id: randomUUID(),
          projectId,
          title: `Fix: ${violation.title}`,
          description: `Rule violation detected during discovery. ${violation.count} occurrence(s) found.`,
          status: "pending",
          priority:
            violation.severity === "critical"
              ? "p0"
              : violation.severity === "high"
              ? "p1"
              : "p2",
          createdAt: now,
          updatedAt: now,
        });
      }

      // 5. ProjectImported event
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "ProjectImported",
        projectId,
        severity: "success",
        message: `Project "${projectName}" imported via autonomous discovery (confidence: ${result.confidenceScore}%)`,
        timestamp: now,
      });

      return inserted;
    });
  } catch (txErr) {
    // Transaction rolled back — revert the session status so it can be retried
    await db
      .update(discoverySessionsTable)
      .set({ status: "ready", importedProjectId: null })
      .where(eq(discoverySessionsTable.id, body.discoveryId))
      .catch(() => undefined);
    const message = txErr instanceof Error ? txErr.message : "Import transaction failed";
    logger.error({ txErr, discoveryId: body.discoveryId }, message);
    return res.status(500).json({ error: message });
  }

  await recordAudit({
    entityType: "discovery_session",
    entityId: body.discoveryId,
    action: "imported",
    projectId,
    stateBefore: { status: "ready" },
    stateAfter: { status: "imported", importedProjectId: projectId },
    changedFields: { projectId, confidenceScore: result.confidenceScore },
  });

  return res.status(201).json(project);
});

// ─── Response helpers ──────────────────────────────────────────────────────────

function toSessionResponse(session: {
  id: string;
  status: string;
  progress: number;
  currentStep: string | null;
  steps: DiscoveryStep[] | null;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
  importedProjectId: string | null;
}) {
  return {
    id: session.id,
    status: session.status,
    progress: session.progress,
    currentStep: session.currentStep ?? null,
    steps: session.steps ?? [],
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    error: session.error ?? null,
    importedProjectId: session.importedProjectId ?? null,
  };
}

export default router;
