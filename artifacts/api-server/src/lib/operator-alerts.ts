import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, operatorAlertsTable } from "@workspace/db";
import type { GroqDefaultModelRole } from "@workspace/ai-orchestrator";

export const GROQ_MODEL_CATALOG_DRIFT_KIND = "groq_model_catalog_drift" as const;
export const GROQ_MODEL_CATALOG_UNAVAILABLE_KIND = "groq_model_catalog_unavailable" as const;

const MAX_MODEL_ID_LENGTH = 200;
const GROQ_CATALOG_STATUS_ROLE = "catalog" as const;
const GROQ_CATALOG_STATUS_MODEL_ID = "catalog";

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