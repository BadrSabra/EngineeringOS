/**
 * سكريبت مؤقت: تشغيل مسح حقيقي للمشروع بدون HTTP layer.
 * شغّله بـ: pnpm tsx --conditions workspace scripts/trigger-scan.mts
 */
import { db } from "@workspace/db";
import {
  projectsTable, scanJobsTable, metricsTable,
  graphEntitiesTable, graphRelationshipsTable, eventsTable,
} from "@workspace/db";
import { walkProject, matchRules, computeMetrics, extractGraph } from "@workspace/scanner";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { existsSync } from "fs";

(async () => {
  console.log("=== EngineeringOS Scan Trigger ===\n");

  const [project] = await db.select().from(projectsTable)
    .orderBy(desc(projectsTable.createdAt)).limit(1);
  if (!project) { console.error("❌ No project found"); process.exit(1); }

  console.log(`Project: ${project.name}\nRoot:    ${project.rootPath}\nQuality (before): ${project.qualityScore ?? "N/A"}\n`);
  if (!existsSync(project.rootPath)) { console.error(`❌ rootPath does not exist: ${project.rootPath}`); process.exit(1); }
  console.log("✓ rootPath accessible\n");

  const jobId = randomUUID();
  const correlationId = randomUUID();
  await db.insert(scanJobsTable).values({
    id: jobId, projectId: project.id, status: "running",
    createdAt: new Date(), startedAt: new Date(),
  });
  console.log(`Created scan job: ${jobId}`);

  try {
    console.log("Walking project files...");
    const walkResult = await walkProject(project.rootPath);
    console.log(`  ${walkResult.files.length} files | ${walkResult.sourceFiles} source files`);

    const ruleResults = matchRules([], walkResult.files);

    console.log("Computing metrics...");
    const metrics = computeMetrics(walkResult.files, ruleResults);
    console.log(`  Overall: ${metrics.overallScore.toFixed(1)}/100`);
    console.log(`  Arch: ${metrics.architectureScore?.toFixed(1) ?? "N/A"} | Sec: ${metrics.securityScore?.toFixed(1) ?? "N/A"} | Perf: ${metrics.performanceScore?.toFixed(1) ?? "N/A"}`);
    console.log(`  Reliability: ${metrics.reliabilityScore?.toFixed(1) ?? "N/A"} | Maintainability: ${metrics.maintainabilityScore?.toFixed(1) ?? "N/A"} | Lint: ${metrics.lintIssues ?? 0}`);

    console.log("\nExtracting knowledge graph...");
    const graphResult = await extractGraph(walkResult.files, project.rootPath);
    console.log(`  Entities: ${graphResult.entities.length} | Relationships: ${graphResult.relationships.length}`);

    const now = new Date();

    // حذف البيانات القديمة ثم إدراج الجديدة
    await db.delete(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, project.id));
    await db.delete(graphRelationshipsTable).where(eq(graphRelationshipsTable.projectId, project.id));

    if (graphResult.entities.length > 0) {
      for (let i = 0; i < graphResult.entities.length; i += 200) {
        const chunk = graphResult.entities.slice(i, i + 200);
        await db.insert(graphEntitiesTable).values(chunk.map((e) => ({
          id: randomUUID(), projectId: project.id,
          name: e.name, type: e.type, kind: e.kind ?? null,
          path: e.path ?? null, confidence: e.confidence ?? 0.8,
          description: e.description ?? null, domain: e.domain ?? null,
          createdAt: now, updatedAt: now, provenance: null,
        })));
      }
      console.log(`  ✓ ${graphResult.entities.length} entities saved`);
    }

    if (graphResult.relationships.length > 0) {
      for (let i = 0; i < graphResult.relationships.length; i += 200) {
        const chunk = graphResult.relationships.slice(i, i + 200);
        await db.insert(graphRelationshipsTable).values(chunk.map((r) => ({
          id: randomUUID(), projectId: project.id,
          sourceId: r.sourceId, targetId: r.targetId,
          type: r.type, strength: r.strength ?? 0.5,
          createdAt: now, provenance: null,
        })));
      }
      console.log(`  ✓ ${graphResult.relationships.length} relationships saved`);
    }

    await db.insert(metricsTable).values({
      id: randomUUID(), projectId: project.id, timestamp: now,
      overallScore: metrics.overallScore,
      architectureScore: metrics.architectureScore ?? null,
      securityScore: metrics.securityScore ?? null,
      performanceScore: metrics.performanceScore ?? null,
      reliabilityScore: metrics.reliabilityScore ?? null,
      maintainabilityScore: metrics.maintainabilityScore ?? null,
      technicalDebt: metrics.technicalDebt ?? null,
      buildStatus: "unknown", lintIssues: metrics.lintIssues ?? 0,
      correlationId,
    });

    await db.update(projectsTable).set({
      qualityScore: metrics.overallScore, lastScanAt: now,
      status: "active", updatedAt: now,
    }).where(eq(projectsTable.id, project.id));

    await db.update(scanJobsTable).set({
      status: "completed", finishedAt: now,
      result: {
        filesFound: walkResult.files.length, sourceFiles: walkResult.sourceFiles,
        entitiesExtracted: graphResult.entities.length,
        relationshipsExtracted: graphResult.relationships.length,
        overallScore: metrics.overallScore,
      } as Record<string, unknown>,
    }).where(eq(scanJobsTable.id, jobId));

    await db.insert(eventsTable).values({
      id: randomUUID(), type: "ProjectScanCompleted", projectId: project.id,
      severity: "success",
      message: `Scan completed: ${walkResult.files.length} files, score ${metrics.overallScore.toFixed(1)}/100`,
      timestamp: now, correlationId,
    });

    console.log(`\n✅ Scan complete! Quality: ${metrics.overallScore.toFixed(1)}/100 | Entities: ${graphResult.entities.length}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Scan failed: ${msg}`);
    if (err instanceof Error) console.error(err.stack);
    await db.update(scanJobsTable).set({ status: "failed", error: msg, finishedAt: new Date() })
      .where(eq(scanJobsTable.id, jobId));
    process.exit(1);
  }
  process.exit(0);
})();
