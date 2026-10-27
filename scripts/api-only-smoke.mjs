const PHASES = [
  "PREFLIGHT",
  "BUILD_API",
  "DATABASE",
  "API_START",
  "READINESS",
  "LOCAL_SMOKE",
  "API_STOP",
  "AUDIT",
  "CLEANUP",
];

const ENTITY_COUNT_KEYS = [
  "ai_missions",
  "ai_goals",
  "ai_executions",
  "ai_execution_acceptances",
  "tasks",
  "ai_change_proposals",
];

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/giu, "[database-url-redacted]")
    .replace(/(?:OPENROUTER|CLERK|SESSION)_SECRET_KEY\s*[:=]\s*\S+/giu, "[secret-redacted]")
    .slice(0, 1_000);
}

function requireOwnedDatabase(database) {
  if (
    !database
    || database.owned !== true
    || database.rootVerified !== true
    || database.host !== "127.0.0.1"
    || database.databaseName !== "engineeringos_api_smoke"
    || !Number.isInteger(database.port)
    || database.port < 1
    || database.port > 65_535
    || [8_099, 23_183, 23_184].includes(database.port)
  ) {
    throw new Error("database_ownership_or_loopback_identity_not_verified");
  }
}

function requireOwnedApi(api, context) {
  if (
    !api
    || api.owned !== true
    || !Number.isInteger(api.pid)
    || api.pid < 2
    || api.port !== context.apiPort
    || [8_099, 23_183, 23_184].includes(api.port)
    || api.networkNamespace !== context.networkNamespace
    || api.cwd !== context.workspaceRoot
  ) {
    throw new Error("api_process_ownership_or_isolation_not_verified");
  }
}

function requireZeroCounts(counts, phase) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    throw new Error(`${phase}_entity_counts_unavailable`);
  }
  const nonzero = Object.entries(counts).filter(
    ([, value]) => !Number.isSafeInteger(value) || value !== 0,
  );
  if (nonzero.length) {
    throw new Error(`${phase}_database_not_empty:${nonzero.map(([name]) => name).join(",")}`);
  }
}

function requireCountsUnchanged(before, after) {
  const changed = ENTITY_COUNT_KEYS.filter(
    (name) => before?.[name] !== after?.[name],
  );
  if (changed.length) {
    throw new Error(`api_smoke_created_or_changed_entities:${changed.join(",")}`);
  }
  requireZeroCounts(after, "after_api_smoke");
}

function requireSuccessfulStop(result) {
  if (
    result?.stopped !== true
    || result?.portFree !== true
    || result?.remainingPids?.length !== 0
    || result?.childProcessesExited !== true
  ) {
    throw new Error("api_stop_or_descendant_cleanup_not_verified");
  }
}

function requireCleanAudit(events, api) {
  if (!Array.isArray(events)) throw new Error("api_egress_audit_unavailable");
  if (!events.some(
    (event) => event.kind === "guard-installed" && event.pid === api.pid,
  )) {
    throw new Error("api_runtime_egress_guard_install_not_recorded");
  }
  const blocked = events.filter((event) =>
    event.kind === "blocked-egress"
    || event.kind === "blocked-child-process",
  );
  if (blocked.length) {
    throw new Error(`api_startup_attempted_blocked_io:${blocked.length}`);
  }
}

/**
 * Orchestrates an API-only smoke run through injected operations. This keeps
 * the ordering and ownership rules testable without starting PostgreSQL or
 * the API in an unsupported environment.
 */
export async function runApiOnlySmoke(dependencies, options = {}) {
  if (!dependencies || typeof dependencies !== "object") {
    throw new TypeError("api_smoke_dependencies_required");
  }

  const report = {
    kind: "engineeringos-api-only-smoke",
    version: 1,
    lifecycleStatus: "BLOCKED_BEFORE_BROWSER",
    apiSmokeStatus: "running",
    runId: options.runId ?? "test-run",
    startedAt: options.startedAt ?? new Date().toISOString(),
    phases: [],
    resources: {},
  };
  const context = { runId: report.runId, report };
  let currentPhase = "";
  let database;
  let api;
  let apiStopped = false;
  let databaseOwned = false;
  let evidenceSavedBeforeCleanup = false;
  let cleanupIncomplete = false;
  let failure;

  const phase = async (name, operation) => {
    currentPhase = name;
    const record = { name, status: "running", startedAt: new Date().toISOString() };
    report.phases.push(record);
    try {
      const value = await operation();
      record.status = "passed";
      record.finishedAt = new Date().toISOString();
      return value;
    } catch (error) {
      record.status = "failed";
      record.finishedAt = new Date().toISOString();
      record.error = safeError(error);
      throw error;
    }
  };

  const stopOwnedApi = async () => {
    if (!api) return;
    if (api.owned !== true || !Number.isInteger(api.pid) || api.pid < 2) {
      cleanupIncomplete = true;
      throw new Error("refusing_to_stop_unowned_api_process");
    }
    const result = await dependencies.stopApi(api, context);
    requireSuccessfulStop(result);
    apiStopped = true;
    report.resources.apiStop = result;
  };

  try {
    context.preflight = await phase("PREFLIGHT", () =>
      dependencies.preflight(context),
    );
    context.networkNamespace = context.preflight.networkNamespace;
    context.apiPort = context.preflight.apiPort;
    context.workspaceRoot = context.preflight.workspaceRealPath;
    report.resources.preflight = context.preflight.report;

    context.build = await phase("BUILD_API", () =>
      dependencies.buildApi(context),
    );
    report.resources.apiBuild = context.build.report;

    await phase("DATABASE", async () => {
      database = await dependencies.createDatabase(context);
      database ??= context.database;
      requireOwnedDatabase(database);
      databaseOwned = true;
      report.resources.database = database.report;
      await dependencies.applySchema(database, context);
      const identity = await dependencies.readDatabaseIdentity(database, context);
      if (
        identity?.databaseName !== database.databaseName
        || identity?.host !== "127.0.0.1"
        || identity?.port !== database.port
        || identity?.networkNamespace !== context.networkNamespace
      ) {
        throw new Error("database_identity_does_not_match_owned_test_cluster");
      }
      const counts = await dependencies.readEntityCounts(database, context);
      requireZeroCounts(counts, "before_api_start");
      context.beforeEntityCounts = counts;
      report.resources.database.identity = identity;
      report.resources.database.entityCountsBefore = counts;
      report.resources.database.schemaApplied = true;
    });

    api = await phase("API_START", async () => {
      const started = await dependencies.startApi(database, context);
      api = started;
      requireOwnedApi(api, context);
      report.resources.api = {
        pid: api.pid,
        port: api.port,
        networkNamespace: api.networkNamespace,
        entrypointSha256: context.build.entrypointSha256,
      };
      return started;
    });

    await phase("READINESS", async () => {
      const readiness = await dependencies.waitForReadiness(api, context);
      if (
        readiness?.health?.status !== "ok"
        || readiness?.readiness?.status !== "ready"
        || readiness?.readiness?.checks?.api?.status !== "ready"
        || readiness?.readiness?.checks?.database?.status !== "ready"
        || readiness?.readiness?.checks?.schema?.status !== "ready"
      ) {
        throw new Error("health_or_readiness_contract_not_ready");
      }
      report.resources.readiness = readiness;
    });

    await phase("LOCAL_SMOKE", async () => {
      const smoke = await dependencies.localSmoke(api, context);
      if (
        smoke?.readOnly !== true
        || !Array.isArray(smoke.requests)
        || smoke.requests.some(
          (request) => request.method !== "GET"
            || request.local !== true
            || !["/api/healthz", "/api/readiness"].includes(request.path),
        )
      ) {
        throw new Error("local_smoke_was_not_limited_to_loopback_gets");
      }
      const afterCounts = await dependencies.readEntityCounts(database, context);
      requireCountsUnchanged(context.beforeEntityCounts, afterCounts);
      report.resources.localSmoke = smoke;
      report.resources.database.entityCountsAfter = afterCounts;
    });

    await phase("API_STOP", stopOwnedApi);
    await phase("AUDIT", async () => {
      const events = await dependencies.readAudit(context);
      requireCleanAudit(events, api);
      report.resources.audit = {
        eventCount: events.length,
        guardInstalled: true,
        blockedIoEvents: 0,
      };
    });
    report.apiSmokeStatus = "passed";
  } catch (error) {
    failure = error;
    report.apiSmokeStatus = currentPhase === "PREFLIGHT" ? "blocked" : "failed";
    report.failure = {
      phase: currentPhase || "PREFLIGHT",
      message: safeError(error),
    };
  } finally {
    api ??= context.api;
    database ??= context.database;
    if (database && !databaseOwned) {
      try {
        requireOwnedDatabase(database);
        databaseOwned = true;
      } catch {
        // An unverified or partially-created root is retained for inspection.
      }
    }
    if (api && !apiStopped) {
      const stopRecord = report.phases.some((entry) => entry.name === "API_STOP")
        ? null
        : {
            name: "API_STOP",
            status: "running",
            startedAt: new Date().toISOString(),
          };
      if (stopRecord) report.phases.push(stopRecord);
      try {
        await stopOwnedApi();
        if (stopRecord) {
          stopRecord.status = "passed";
          stopRecord.finishedAt = new Date().toISOString();
          stopRecord.reason = "stopped_during_failure_cleanup";
        }
      } catch (error) {
        cleanupIncomplete = true;
        report.resources.apiStopFailure = safeError(error);
        if (stopRecord) {
          stopRecord.status = "failed";
          stopRecord.error = safeError(error);
          stopRecord.finishedAt = new Date().toISOString();
        }
      }
    } else if (!api && !report.phases.some((entry) => entry.name === "API_STOP")) {
      report.phases.push({
        name: "API_STOP",
        status: "skipped",
        reason: "api_not_started",
      });
    }

    const recordedPhases = new Set(report.phases.map((entry) => entry.name));
    for (const name of PHASES.slice(0, -1)) {
      if (!recordedPhases.has(name)) {
        report.phases.push({
          name,
          status: "skipped",
          reason: failure
            ? `blocked_after_${currentPhase || "preflight"}`
            : "not_required",
        });
      }
    }
    const cleanupRecord = {
      name: "CLEANUP",
      status: "running",
      startedAt: new Date().toISOString(),
    };
    report.phases.push(cleanupRecord);
    report.phases.sort(
      (left, right) => PHASES.indexOf(left.name) - PHASES.indexOf(right.name),
    );
    if (typeof dependencies.cleanupReservations === "function") {
      try {
        report.resources.portReservations =
          await dependencies.cleanupReservations(context);
      } catch (error) {
        cleanupIncomplete = true;
        report.resources.portReservationCleanupFailure = safeError(error);
      }
    }
    try {
      if (api && !apiStopped) {
        throw new Error("database_preserved_because_api_stop_is_unverified");
      }

      report.apiSmokeStatus = failure
        ? report.apiSmokeStatus
        : "awaiting_cleanup";
      await dependencies.persistEvidence(report, context);
      evidenceSavedBeforeCleanup = true;

      if (database && databaseOwned) {
        const cleanup = await dependencies.cleanupDatabase(database, context);
        if (cleanup?.removed !== true || cleanup?.clusterStopped !== true) {
          throw new Error("owned_database_cleanup_not_verified");
        }
        report.resources.databaseCleanup = cleanup;
      } else if (database || context.database) {
        throw new Error("database_preserved_because_ownership_is_unverified");
      }

      cleanupRecord.status = "passed";
      cleanupRecord.finishedAt = new Date().toISOString();
    } catch (error) {
      cleanupIncomplete = true;
      cleanupRecord.status = "failed";
      cleanupRecord.error = safeError(error);
      cleanupRecord.finishedAt = new Date().toISOString();
    }

    if (cleanupIncomplete) {
      report.apiSmokeStatus = "cleanup_incomplete";
      report.cleanupIncomplete = true;
      if (cleanupRecord.status === "passed") {
        cleanupRecord.status = "failed";
        cleanupRecord.error = "one_or_more_owned_resources_remain_unverified";
      }
    } else if (!failure) {
      report.apiSmokeStatus = "passed";
    }
    if (!evidenceSavedBeforeCleanup) {
      report.evidenceSavedBeforeCleanup = false;
    } else {
      report.evidenceSavedBeforeCleanup = true;
    }
    try {
      await dependencies.persistEvidence(report, context);
    } catch (error) {
      report.apiSmokeStatus = "cleanup_incomplete";
      report.cleanupIncomplete = true;
      report.evidencePersistenceFailure = safeError(error);
    }
  }

  return report;
}

export const apiOnlySmokePhases = Object.freeze([...PHASES]);
