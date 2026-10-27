import test from "node:test";
import assert from "node:assert/strict";
import { runApiOnlySmoke } from "./api-only-smoke.mjs";
import {
  createApiSmokeEnvironment,
  requestJson,
} from "./run-api-only-smoke.mjs";

const emptyCounts = {
  ai_missions: 0,
  ai_goals: 0,
  ai_executions: 0,
  ai_execution_acceptances: 0,
  tasks: 0,
  ai_change_proposals: 0,
  ai_mission_lineages: 0,
  ai_chat_sessions: 0,
  ai_chat_messages: 0,
};

function createDependencies(overrides = {}) {
  const events = [];
  const database = {
    owned: true,
    rootVerified: true,
    host: "127.0.0.1",
    port: 36_401,
    databaseName: "engineeringos_api_smoke",
    report: { id: "owned-db" },
  };
  const api = {
    owned: true,
    pid: 36_402,
    port: 36_403,
    networkNamespace: "net:[isolated-namespace]",
    cwd: "/isolated/workspace",
  };
  let entityCountsRead = 0;
  const dependencies = {
    async preflight() {
      events.push("preflight");
      return {
        networkNamespace: "net:[isolated-namespace]",
        workspaceRealPath: "/isolated/workspace",
        apiPort: api.port,
        report: { isolationVerified: true },
      };
    },
    async buildApi() {
      events.push("build");
      return { entrypointSha256: "test-hash", report: { built: true } };
    },
    async createDatabase(context) {
      events.push("database-create");
      context.database = database;
      return database;
    },
    async applySchema() {
      events.push("schema-apply");
    },
    async readDatabaseIdentity() {
      events.push("database-identity");
      return {
        databaseName: database.databaseName,
        host: database.host,
        port: database.port,
        networkNamespace: "net:[isolated-namespace]",
      };
    },
    async readEntityCounts() {
      entityCountsRead += 1;
      events.push(`entity-counts-${entityCountsRead}`);
      return { ...emptyCounts };
    },
    async startApi() {
      events.push("api-start");
      return api;
    },
    async waitForReadiness() {
      events.push("readiness");
      return {
        health: { status: "ok" },
        readiness: {
          status: "ready",
          checks: {
            api: { status: "ready" },
            database: { status: "ready" },
            schema: { status: "ready" },
          },
        },
      };
    },
    async localSmoke() {
      events.push("local-smoke");
      return {
        readOnly: true,
        requests: [
          { method: "GET", path: "/api/healthz", local: true },
          { method: "GET", path: "/api/readiness", local: true },
        ],
      };
    },
    async stopApi() {
      events.push("api-stop");
      return {
        stopped: true,
        portFree: true,
        remainingPids: [],
        childProcessesExited: true,
      };
    },
    async readAudit() {
      events.push("audit");
      return [{ kind: "guard-installed", pid: api.pid }];
    },
    async persistEvidence(report) {
      events.push(`persist:${report.phases.some((phase) => phase.name === "CLEANUP")}`);
    },
    async cleanupDatabase() {
      events.push("database-cleanup");
      return { removed: true, clusterStopped: true };
    },
  };
  return { dependencies: { ...dependencies, ...overrides }, events, database, api };
}

test("preflight rejection blocks all build, database, and API work", async () => {
  const { dependencies, events } = createDependencies({
    async preflight() {
      events.push("preflight");
      throw new Error("isolated_network_namespace_required");
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "blocked-preflight" });

  assert.equal(report.apiSmokeStatus, "blocked");
  assert.equal(report.lifecycleStatus, "BLOCKED_BEFORE_BROWSER");
  assert.equal(report.failure.phase, "PREFLIGHT");
  assert.deepEqual(events, ["preflight", "persist:true", "persist:true"]);
  assert.equal(events.some((event) => event === "api-start"), false);
  assert.equal(events.some((event) => event === "database-create"), false);
});

test("schema apply failure prevents API startup and persists evidence before DB cleanup", async () => {
  const { dependencies, events } = createDependencies({
    async applySchema() {
      events.push("schema-apply");
      throw new Error("schema_apply_failed");
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "schema-failure" });

  assert.equal(report.apiSmokeStatus, "failed");
  assert.equal(report.failure.phase, "DATABASE");
  assert.equal(events.includes("api-start"), false);
  assert.ok(events.indexOf("persist:true") < events.indexOf("database-cleanup"));
  assert.ok(events.includes("database-cleanup"));
});

test("readiness timeout stops the owned API before cleaning the database", async () => {
  const { dependencies, events } = createDependencies({
    async waitForReadiness() {
      events.push("readiness-timeout");
      throw new Error("readiness_timeout");
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "readiness-timeout" });

  assert.equal(report.apiSmokeStatus, "failed");
  assert.equal(report.failure.phase, "READINESS");
  assert.ok(events.indexOf("api-stop") < events.indexOf("database-cleanup"));
  assert.ok(events.indexOf("persist:true") < events.indexOf("database-cleanup"));
});

test("an unowned database is never cleaned up", async () => {
  const { dependencies, events, database } = createDependencies({
    async createDatabase(context) {
      events.push("database-create");
      const unowned = { ...database, owned: false };
      context.database = unowned;
      return unowned;
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "unowned-database" });

  assert.equal(report.apiSmokeStatus, "cleanup_incomplete");
  assert.equal(events.includes("api-start"), false);
  assert.equal(events.includes("database-cleanup"), false);
  assert.equal(report.cleanupIncomplete, true);
});

test("a database root without verified realpath ownership is retained", async () => {
  const { dependencies, events, database } = createDependencies({
    async createDatabase(context) {
      events.push("database-create");
      const unverifiedRoot = { ...database, rootVerified: false };
      context.database = unverifiedRoot;
      return unverifiedRoot;
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "unverified-root" });

  assert.equal(report.apiSmokeStatus, "cleanup_incomplete");
  assert.equal(events.includes("api-start"), false);
  assert.equal(events.includes("database-cleanup"), false);
});

test("an unowned API process is neither stopped nor followed by database deletion", async () => {
  const { dependencies, events, api } = createDependencies({
    async startApi() {
      events.push("api-start");
      return { ...api, owned: false };
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "unowned-api" });

  assert.equal(report.apiSmokeStatus, "cleanup_incomplete");
  assert.equal(events.includes("api-stop"), false);
  assert.equal(events.includes("database-cleanup"), false);
  assert.equal(report.cleanupIncomplete, true);
});

test("nonzero pre-start entity counts prevent API startup", async () => {
  const { dependencies, events } = createDependencies({
    async readEntityCounts() {
      events.push("entity-counts-nonzero");
      return { ...emptyCounts, ai_missions: 1 };
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "nonzero-db" });

  assert.equal(report.failure.phase, "DATABASE");
  assert.equal(events.includes("api-start"), false);
  assert.ok(events.includes("database-cleanup"));
});

test("post-smoke entity changes fail the run and trigger owned cleanup", async () => {
  const { dependencies, events } = createDependencies({
    async readEntityCounts() {
      const count = events.filter((event) => event.startsWith("entity-counts-")).length;
      events.push(`entity-counts-${count + 1}`);
      return count === 0 ? { ...emptyCounts } : { ...emptyCounts, ai_goals: 1 };
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "entity-change" });

  assert.equal(report.failure.phase, "LOCAL_SMOKE");
  assert.equal(report.apiSmokeStatus, "failed");
  assert.ok(events.indexOf("api-stop") < events.indexOf("database-cleanup"));
});

test("write requests in the local smoke contract fail the run", async () => {
  const { dependencies, events } = createDependencies({
    async localSmoke() {
      events.push("local-smoke");
      return {
        readOnly: true,
        requests: [{ method: "POST", path: "/api/ai/missions", local: true }],
      };
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "write-request" });

  assert.equal(report.failure.phase, "LOCAL_SMOKE");
  assert.equal(events.includes("api-stop"), true);
  assert.ok(events.indexOf("api-stop") < events.indexOf("database-cleanup"));
});

test("blocked egress audit fails the smoke despite healthy endpoints", async () => {
  const { dependencies, events, api } = createDependencies({
    async readAudit() {
      events.push("audit");
      return [
        { kind: "guard-installed", pid: api.pid },
        { kind: "blocked-egress", host: "api.clerk.com" },
      ];
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "blocked-egress" });

  assert.equal(report.failure.phase, "AUDIT");
  assert.equal(report.apiSmokeStatus, "failed");
  assert.ok(events.indexOf("api-stop") < events.indexOf("database-cleanup"));
});

test("database cleanup failure is visible and the final report is persisted", async () => {
  const { dependencies, events } = createDependencies({
    async cleanupDatabase() {
      events.push("database-cleanup");
      throw new Error("postgres_stop_unverified");
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "cleanup-failure" });

  assert.equal(report.apiSmokeStatus, "cleanup_incomplete");
  assert.equal(report.cleanupIncomplete, true);
  assert.equal(events.filter((event) => event === "persist:true").length, 2);
  assert.ok(events.indexOf("persist:true") < events.indexOf("database-cleanup"));
});

test("port reservation cleanup uncertainty is reported even when the database is removed", async () => {
  const { dependencies, events } = createDependencies({
    async cleanupReservations() {
      events.push("port-reservation-cleanup");
      throw new Error("reserved-loopback-socket-still-open");
    },
  });

  const report = await runApiOnlySmoke(dependencies, { runId: "port-cleanup-failure" });

  assert.equal(report.apiSmokeStatus, "cleanup_incomplete");
  assert.equal(report.phases.find((phase) => phase.name === "CLEANUP").status, "failed");
  assert.ok(events.includes("database-cleanup"));
  assert.ok(events.indexOf("persist:true") < events.indexOf("database-cleanup"));
});

test("successful orchestration remains explicitly distinct from lifecycle acceptance", async () => {
  const { dependencies, events } = createDependencies();

  const report = await runApiOnlySmoke(dependencies, { runId: "api-only-pass" });

  assert.equal(report.apiSmokeStatus, "passed");
  assert.equal(report.lifecycleStatus, "BLOCKED_BEFORE_BROWSER");
  assert.deepEqual(
    report.phases.map((phase) => phase.name),
    [
      "PREFLIGHT",
      "BUILD_API",
      "DATABASE",
      "API_START",
      "READINESS",
      "LOCAL_SMOKE",
      "API_STOP",
      "AUDIT",
      "CLEANUP",
    ],
  );
  assert.ok(events.indexOf("persist:true") < events.indexOf("database-cleanup"));
  assert.equal(report.evidenceSavedBeforeCleanup, true);
});

test("API environment is allowlisted, local-only, provider-disabled, and fixture-scoped", () => {
  const env = createApiSmokeEnvironment({
    databaseUrl:
      "postgresql://engineeringos_api_smoke@127.0.0.1:36401/engineeringos_api_smoke?sslmode=disable",
    databasePort: 36_401,
    port: 36_403,
    auditPath: "/isolated/results/api-egress-audit.jsonl",
    workerScopeProjectId: "5f7c8f4d-6c3a-4f74-8a36-735daf519d9a",
    home: "/isolated/temp",
    tempDir: "/isolated/temp",
  });

  assert.equal(env.NODE_ENV, "test");
  assert.equal(env.ENGINEERINGOS_LOCAL_E2E_AUTH_FIXTURE, "1");
  assert.equal(env.DASHBOARD_E2E_TEST_MODE, "fixture");
  assert.equal(env.AI_PROVIDER_EGRESS_DISABLED, "1");
  assert.equal(env.ENGINEERINGOS_RUNTIME_EGRESS_GUARD_CHILD_MODE, "blocked");
  assert.equal(env.NODE_OPTIONS, "");
  for (const forbidden of [
    "CLERK_SECRET_KEY",
    "CLERK_PUBLISHABLE_KEY",
    "OPENROUTER_API_KEY",
    "SESSION_SECRET",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
  ]) {
    assert.equal(Object.hasOwn(env, forbidden), false, `${forbidden} must not be inherited`);
  }
  assert.throws(
    () => createApiSmokeEnvironment({
      databaseUrl: "postgresql://user@development-db.example/heliumdb",
      databasePort: 5_432,
      port: 36_403,
      auditPath: "/tmp/audit.jsonl",
      workerScopeProjectId: "5f7c8f4d-6c3a-4f74-8a36-735daf519d9a",
    }),
    /api_smoke_environment_scope_invalid/u,
  );
});

test("HTTP probe rejects external identity and provider destinations before opening a socket", async () => {
  await assert.rejects(
    requestJson("https://api.clerk.com/v1/users"),
    /smoke_http_target_must_be_loopback_http/u,
  );
  await assert.rejects(
    requestJson("http://openrouter.ai/api/v1/models"),
    /smoke_http_target_must_be_loopback_http/u,
  );
});
