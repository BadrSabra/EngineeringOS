import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { attachDatabasePoolErrorHandler, type DatabasePoolErrorDetails } from "./pool-runtime.js";

const testDatabaseUrl = process.env.DATABASE_POOL_RECOVERY_TEST_URL;
const expectedDatabaseName = process.env.DATABASE_POOL_RECOVERY_TEST_DATABASE_NAME;
const disposableConfirmation = process.env.DATABASE_POOL_RECOVERY_TEST_DISPOSABLE === "1";

function sameDatabaseTarget(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    const target = (url: URL) =>
      `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || "5432"}${decodeURIComponent(url.pathname)}`;
    return target(leftUrl) === target(rightUrl);
  } catch {
    return false;
  }
}

const isApplicationDatabaseTarget = Boolean(
  testDatabaseUrl
  && process.env.DATABASE_URL
  && sameDatabaseTarget(testDatabaseUrl, process.env.DATABASE_URL),
);

test("detects when a recovery URL aliases the application database", () => {
  assert.equal(
    sameDatabaseTarget("postgres://user@db.example/app", "postgres://other@db.example/app?sslmode=require"),
    true,
  );
  assert.equal(
    sameDatabaseTarget("postgres://user@db.example/pool_recovery_test", "postgres://user@db.example/app"),
    false,
  );
  assert.equal(sameDatabaseTarget("not-a-url", "postgres://db.example/app"), false);
});

const skipReason = (() => {
  if (process.env.NODE_ENV === "production") return "disabled in production";
  if (!testDatabaseUrl) return "set DATABASE_POOL_RECOVERY_TEST_URL to a dedicated temporary database";
  if (isApplicationDatabaseTarget) return "the recovery test must not target the application's configured database";
  if (!expectedDatabaseName) return "set DATABASE_POOL_RECOVERY_TEST_DATABASE_NAME to confirm the target database";
  if (!disposableConfirmation) return "set DATABASE_POOL_RECOVERY_TEST_DISPOSABLE=1 only for a disposable database";
  return undefined;
})();

function waitForReport(
  reported: Promise<{ message: string; details: DatabasePoolErrorDetails }>,
  timeoutMs: number,
): Promise<{ message: string; details: DatabasePoolErrorDetails }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for the terminated idle client report")),
      timeoutMs,
    );
    reported.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

test("reconnects after its own idle PostgreSQL client is terminated", {
  skip: skipReason ?? false,
  timeout: 30_000,
}, async () => {
  if (!testDatabaseUrl || !expectedDatabaseName || !disposableConfirmation) {
    throw new Error("the dedicated disposable database guard was bypassed");
  }

  const { Pool } = pg;
  const applicationPool = new Pool({
    connectionString: testDatabaseUrl,
    max: 1,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 5_000,
  });
  const controlPool = new Pool({
    connectionString: testDatabaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  const reports: Array<{ message: string; details: DatabasePoolErrorDetails }> = [];
  let resolveReported!: (value: { message: string; details: DatabasePoolErrorDetails }) => void;
  const reported = new Promise<{ message: string; details: DatabasePoolErrorDetails }>((resolve) => {
    resolveReported = resolve;
  });
  attachDatabasePoolErrorHandler(applicationPool, (message, details) => {
    reports.push({ message, details });
    resolveReported({ message, details });
  });

  try {
    const identity = await controlPool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    assert.equal(
      identity.rows[0]?.database_name,
      expectedDatabaseName,
      "the connection target must match the explicitly named disposable database",
    );

    const client = await applicationPool.connect();
    let originalBackendPid: number;
    try {
      const result = await client.query<{ backend_pid: number }>(
        "SELECT pg_backend_pid()::int AS backend_pid",
      );
      originalBackendPid = result.rows[0]!.backend_pid;
    } finally {
      client.release();
    }

    assert.equal(applicationPool.totalCount, 1);
    assert.equal(applicationPool.idleCount, 1);
    assert.equal(applicationPool.waitingCount, 0);

    const terminated = await controlPool.query<{ terminated: boolean }>(
      "SELECT pg_terminate_backend($1::int) AS terminated",
      [originalBackendPid],
    );
    assert.equal(terminated.rows[0]?.terminated, true);

    const report = await waitForReport(reported, 8_000);
    assert.equal(report.message, "Database pool idle client error");
    assert.ok(
      Object.keys(report.details).every((key) => key === "errorName" || key === "errorCode"),
      "the pool error report must not contain connection or query details",
    );
    assert.equal(reports.length, 1);

    const replacement = await applicationPool.query<{ backend_pid: number }>(
      "SELECT pg_backend_pid()::int AS backend_pid",
    );
    assert.notEqual(replacement.rows[0]?.backend_pid, originalBackendPid);
  } finally {
    await Promise.all([applicationPool.end(), controlPool.end()]);
  }
});
