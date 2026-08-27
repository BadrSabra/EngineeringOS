import { Router, type IRouter } from "express";
import { GetHealthResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { heavyJobQueue } from "../lib/job-queue.js";
import { getOperationalCounters } from "../lib/operational-counters.js";
import { getAiDiagnosticsRetentionHealth } from "../lib/startup-migrations.js";
import { getTaskExecutionRetentionHealth } from "../lib/task-execution-retention.js";
import { getDurableJobHealth } from "../lib/job-reconciliation.js";

const router: IRouter = Router();

const REQUIRED_SCHEMA_COLUMNS = [
  ["projects", "id"],
  ["ai_executions", "operation_id"],
] as const;

/**
 * Readiness is deliberately separate from liveness. A process can be
 * listening while the database schema is from an older build; release
 * validation must receive a bounded, actionable blocked result instead of
 * treating that listener as ready for authenticated work.
 */
router.get("/readiness", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = $1 AND column_name = $2)
           OR (table_name = $3 AND column_name = $4))`,
      [
        REQUIRED_SCHEMA_COLUMNS[0][0],
        REQUIRED_SCHEMA_COLUMNS[0][1],
        REQUIRED_SCHEMA_COLUMNS[1][0],
        REQUIRED_SCHEMA_COLUMNS[1][1],
      ],
    );
    const found = new Set(
      result.rows.map(
        (row: { table_name?: string; column_name?: string }) =>
          `${row.table_name}.${row.column_name}`,
      ),
    );
    const missing = REQUIRED_SCHEMA_COLUMNS.map(
      ([table, column]) => `${table}.${column}`,
    ).filter((column) => !found.has(column));
    if (missing.length > 0) {
      return res.status(503).json({
        status: "blocked",
        checks: {
          api: { status: "ready" },
          database: { status: "ready" },
          schema: { status: "blocked", reason: "schema_incomplete", missing },
        },
      });
    }
    return res.json({
      status: "ready",
      checks: {
        api: { status: "ready" },
        database: { status: "ready" },
        schema: { status: "ready" },
      },
    });
  } catch {
    return res.status(503).json({
      status: "blocked",
      checks: {
        api: { status: "ready" },
        database: { status: "blocked", reason: "database_unavailable" },
        schema: { status: "blocked", reason: "schema_unavailable" },
      },
    });
  }
});

router.get("/healthz", async (_req, res) => {
  const data = GetHealthResponse.parse({
    status: "ok",
    jobQueue: heavyJobQueue.getStats(),
    // Surface operational counters so operators can see degraded subsystems
    // and whether failed audit writes are still awaiting recovery.
    operationalCounters: getOperationalCounters(),
    aiDiagnosticsRetention: getAiDiagnosticsRetentionHealth(),
    taskExecutionRetention: getTaskExecutionRetentionHealth(),
    jobRecovery: await getDurableJobHealth(),
  });
  res.json(data);
});

export default router;
