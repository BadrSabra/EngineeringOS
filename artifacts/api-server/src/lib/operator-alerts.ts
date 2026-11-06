import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, operatorAlertsTable } from "@workspace/db";
import type { GroqDefaultModelRole } from "@workspace/ai-orchestrator";

export const GROQ_MODEL_CATALOG_DRIFT_KIND = "groq_model_catalog_drift" as const;
export const GROQ_MODEL_CATALOG_UNAVAILABLE_KIND = "groq_model_catalog_unavailable" as const;
export const RUNTIME_START_UNRESOLVED_KIND = "runtime_start_unresolved" as const;

const MAX_MODEL_ID_LENGTH = 200;
const GROQ_CATALOG_STATUS_ROLE = "catalog" as const;
const GROQ_CATALOG_STATUS_MODEL_ID = "catalog";

function runtimeStartFingerprint(projectId: string, sessionId: string): string {
  const identity = createHash("sha256")
    .update(JSON.stringify([projectId, sessionId]))
    .digest("hex");
  return `${RUNTIME_START_UNRESOLVED_KIND}:${identity}`;
}

/**
 * Persist one operator-visible alert per unresolved Runtime session. The
 * fingerprint binds project and session identity, so retries and API workers
 * update the same alert without increasing its occurrence count.
 */
export async function recordRuntimeStartUnresolvedAlert(input: {
  projectId: string;
  sessionId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const fingerprint = runtimeStartFingerprint(input.projectId, input.sessionId);
  await db.insert(operatorAlertsTable).values({
    id: randomUUID(),
    fingerprint,
    kind: RUNTIME_START_UNRESOLVED_KIND,
    status: "open",
    provider: "runtime",
    modelRole: "startup",
    modelId: input.sessionId,
    title: "Runtime startup is unresolved",
    message: "Runtime startup has remained unresolved beyond the expected start window.",
    remediation: "Review the runtime session and retry startup only after its state has been reconciled.",
    occurrenceCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    resolvedAt: null,
    projectId: input.projectId,
    severity: "warning",
  }).onConflictDoUpdate({
    target: operatorAlertsTable.fingerprint,
    set: {
      status: "open",
      lastSeenAt: now,
      resolvedAt: null,
    },
  });
}

export async function resolveRuntimeStartUnresolvedAlert(input: {
  projectId: string;
  sessionId: string;
  now?: Date;
}): Promise<void> {
  await db.update(operatorAlertsTable)
    .set({ status: "resolved", resolvedAt: input.now ?? new Date() })
    .where(and(
      eq(operatorAlertsTable.fingerprint, runtimeStartFingerprint(input.projectId, input.sessionId)),
      eq(operatorAlertsTable.kind, RUNTIME_START_UNRESOLVED_KIND),
      inArray(operatorAlertsTable.status, ["open", "acknowledged"]),
    ));
}

/**
 * Retry alert delivery from durable runtime rows and resolve stale notifications
 * after the same session is reconciled, stopped, or otherwise leaves startup.
 */
export async function syncRuntimeStartUnresolvedAlerts(
  sessions: readonly { projectId: string; sessionId: string; startedAt: Date | null }[],
  thresholdMs: number,
  now = new Date(),
): Promise<void> {
  const pending = sessions.filter((session) =>
    session.startedAt !== null
    && now.getTime() - session.startedAt.getTime() >= thresholdMs);
  for (const session of pending) {
    await recordRuntimeStartUnresolvedAlert({
      projectId: session.projectId,
      sessionId: session.sessionId,
      now,
    });
  }

  const activeAlerts = await db.select()
    .from(operatorAlertsTable)
    .where(and(
      eq(operatorAlertsTable.kind, RUNTIME_START_UNRESOLVED_KIND),
      inArray(operatorAlertsTable.status, ["open", "acknowledged"]),
    ));
  const stillStarting = new Set(sessions.map((session) => `${session.projectId}\u0000${session.sessionId}`));
  for (const alert of activeAlerts) {
    if (alert.projectId && stillStarting.has(`${alert.projectId}\u0000${alert.modelId}`)) continue;
    await db.update(operatorAlertsTable)
      .set({ status: "resolved", resolvedAt: now })
      .where(and(
        eq(operatorAlertsTable.id, alert.id),
        inArray(operatorAlertsTable.status, ["open", "acknowledged"]),
      ));
  }
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().slice(0, MAX_MODEL_ID_LENGTH);
}

function buildGroqDriftAlert(modelRole: GroqDefaultModelRole, modelId: string) {
  const roleLabel = modelRole === "fast" ? "Fast" : "Powerful";
  const fingerprint = `${GROQ_MODEL_CATALOG_DRIFT_KIND}:groq:${modelRole}:${modelId}`;
  return {
    fingerprint,
    kind: GROQ_MODEL_CATALOG_DRIFT_KIND as typeof operatorAlertsTable.$inferInsert.kind,
    status: "open" as const,
    provider: "groq",
    modelRole,
    modelId,
    title: `Groq ${roleLabel} model is unavailable`,
    message: `The configured Groq ${roleLabel} model (${modelId}) is missing from Groq's live model catalog.`,
    remediation: "Update the affected Groq model ID to a current catalog model, then restart the API.",
  };
}

function buildGroqCatalogUnavailableAlert() {
  return {
    fingerprint: `${GROQ_MODEL_CATALOG_UNAVAILABLE_KIND}:groq:catalog`,
    kind: GROQ_MODEL_CATALOG_UNAVAILABLE_KIND as typeof operatorAlertsTable.$inferInsert.kind,
    status: "open" as const,
    provider: "groq",
    modelRole: GROQ_CATALOG_STATUS_ROLE,
    modelId: GROQ_CATALOG_STATUS_MODEL_ID,
    title: "Groq model catalog temporarily unavailable",
    message:
      "Groq's live model catalog could not be checked. Configured defaults have not been marked as retired.",
    remediation:
      "Retry the catalog check after Groq recovers. Do not change model IDs based on this temporary status.",
  };
}

/**
 * Record one deployment-wide catalog drift alert. The unique fingerprint
 * makes repeated startup checks an update to the same row, not new history.
 */
export async function recordGroqModelCatalogDrift(
  modelRole: GroqDefaultModelRole,
  rawModelId: string,
): Promise<void> {
  const modelId = normalizeModelId(rawModelId);
  if (!modelId) return;
  const now = new Date();
  const alert = buildGroqDriftAlert(modelRole, modelId);

  // If a default was changed while still missing, close the previous role's
  // open alert before opening the new fingerprint.
  await db
    .update(operatorAlertsTable)
    .set({ status: "resolved", resolvedAt: now })
    .where(and(
      eq(operatorAlertsTable.kind, GROQ_MODEL_CATALOG_DRIFT_KIND),
      eq(operatorAlertsTable.provider, "groq"),
      eq(operatorAlertsTable.modelRole, modelRole),
      isNull(operatorAlertsTable.resolvedAt),
    ));

  await db
    .insert(operatorAlertsTable)
    .values({
      id: randomUUID(),
      ...alert,
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      resolvedAt: null,
    })
    .onConflictDoUpdate({
      target: operatorAlertsTable.fingerprint,
      set: {
        status: "open",
        lastSeenAt: now,
        resolvedAt: null,
        occurrenceCount: sql`${operatorAlertsTable.occurrenceCount} + 1`,
        message: alert.message,
        remediation: alert.remediation,
      },
    });
}

/**
 * Record one bounded deployment-wide status for a transient catalog failure.
 * The fixed fingerprint keeps repeated outages as one observable alert and
 * deliberately omits the provider error text and configured model IDs.
 */
export async function recordGroqModelCatalogUnavailable(): Promise<void> {
  const now = new Date();
  const alert = buildGroqCatalogUnavailableAlert();

  await db
    .insert(operatorAlertsTable)
    .values({
      id: randomUUID(),
      ...alert,
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      resolvedAt: null,
    })
    .onConflictDoUpdate({
      target: operatorAlertsTable.fingerprint,
      set: {
        status: "open",
        lastSeenAt: now,
        resolvedAt: null,
        occurrenceCount: sql`${operatorAlertsTable.occurrenceCount} + 1`,
        title: alert.title,
        message: alert.message,
        remediation: alert.remediation,
      },
    });
}

export async function resolveGroqModelCatalogAlerts(): Promise<void> {
  await db
    .update(operatorAlertsTable)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(and(
      inArray(operatorAlertsTable.kind, [
        GROQ_MODEL_CATALOG_DRIFT_KIND,
        GROQ_MODEL_CATALOG_UNAVAILABLE_KIND,
      ]),
      eq(operatorAlertsTable.provider, "groq"),
      isNull(operatorAlertsTable.resolvedAt),
    ));
}