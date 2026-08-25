/**
 * SCAN-01 + SCAN-02 + SCAN-03: Manual scan trigger that delegates to the
 * production `runScanJob` path instead of re-implementing scan logic.
 *
 * Benefits:
 *   • Same rule-loading path as the production runner (SCAN-02: no more
 *     empty `matchRules([], ...)` — rules come from rulesTable).
 *   • Same graph extraction and metrics computation (SCAN-01).
 *   • No `buildStatus: "unknown"` placeholder stored by this script (SCAN-03);
 *     the production runner does not write a fake buildStatus either.
 *   • A log line makes the unified path explicit.
 *
 * Usage:
 *   pnpm tsx --conditions workspace scripts/trigger-scan.mts
 */
import { db } from "@workspace/db";
import { projectsTable, scanJobsTable } from "@workspace/db";
import { runScanJob } from "../artifacts/api-server/src/lib/scan-runner.js";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { existsSync } from "fs";

(async () => {
  console.log("=== EngineeringOS Scan Trigger ===");
  console.log("ℹ️  Using production runScanJob path — same rules, graph, and metrics as the API.\n");

  // ── 1. Resolve project ──────────────────────────────────────────────────
  const [project] = await db
    .select()
    .from(projectsTable)
    .orderBy(desc(projectsTable.createdAt))
    .limit(1);

  if (!project) {
    console.error("❌ No project found in database");
    process.exit(1);
  }

  console.log(`Project: ${project.name}`);
  console.log(`Root:    ${project.rootPath}`);
  console.log(`Quality (before): ${project.qualityScore ?? "N/A"}\n`);

  if (!existsSync(project.rootPath)) {
    console.error(`❌ rootPath does not exist: ${project.rootPath}`);
    process.exit(1);
  }
  console.log("✓ rootPath accessible\n");

  // ── 2. Create a scan job row (same pre-condition as the production queue) ─
  const jobId = randomUUID();
  await db.insert(scanJobsTable).values({
    id: jobId,
    projectId: project.id,
    status: "running",
    createdAt: new Date(),
    startedAt: new Date(),
  });
  console.log(`Created scan job: ${jobId}`);
  console.log("Delegating to production runScanJob (rules loaded from DB, same extractGraph, same metrics)...\n");

  // ── 3. Delegate to production path ─────────────────────────────────────
  // runScanJob never throws — it writes success/failure into the job row.
  await runScanJob(jobId, project.id);

  // ── 4. Report outcome ──────────────────────────────────────────────────
  const [job] = await db
    .select()
    .from(scanJobsTable)
    .where(eq(scanJobsTable.id, jobId))
    .limit(1);

  if (!job) {
    console.error("❌ Could not read job result from database");
    process.exit(1);
  }

  if (job.status === "completed") {
    const r = job.result as Record<string, unknown> | null;
    console.log(`✅ Scan complete!`);
    if (r) {
      console.log(`   Files:         ${r["filesFound"] ?? "?"}`);
      console.log(`   Source files:  ${r["sourceFiles"] ?? "?"}`);
      console.log(`   Entities:      ${r["entitiesExtracted"] ?? "?"}`);
      console.log(`   Relationships: ${r["relationshipsExtracted"] ?? "?"}`);
      if (typeof r["overallScore"] === "number") {
        console.log(`   Quality score: ${r["overallScore"].toFixed(1)}/100`);
      }
    }
  } else {
    console.error(`❌ Scan failed: ${job.error ?? "unknown error"}`);
    process.exit(1);
  }

  process.exit(0);
})();
