import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, operatorAlertsTable } from "@workspace/db";
import {
  recordGroqModelCatalogDrift,
  recordGroqModelCatalogUnavailable,
  resolveGroqModelCatalogAlerts,
  syncRuntimeStartUnresolvedAlerts,
} from "./operator-alerts.js";

const modelId = "openai/operator-alert-test-retired";
const fingerprint = `groq_model_catalog_drift:groq:fast:${modelId}`;
const unavailableFingerprint = "groq_model_catalog_unavailable:groq:catalog";
const runtimeProjectId = `runtime-alert-project-${Date.now()}`;
const runtimeSessionId = `runtime-alert-session-${Date.now()}`;
const runtimeFingerprint = `runtime_start_unresolved:${createHash("sha256")
  .update(JSON.stringify([runtimeProjectId, runtimeSessionId]))
  .digest("hex")}`;

afterEach(async () => {
  await db.delete(operatorAlertsTable).where(
    eq(operatorAlertsTable.fingerprint, fingerprint),
  );
  await db.delete(operatorAlertsTable).where(
    eq(operatorAlertsTable.fingerprint, unavailableFingerprint),
  );
  await db.delete(operatorAlertsTable).where(
    eq(operatorAlertsTable.fingerprint, runtimeFingerprint),
  );
});

describe("Groq operator alert persistence", () => {
  it("deduplicates repeated observations by role and model", async () => {
    await recordGroqModelCatalogDrift("fast", modelId);
    await recordGroqModelCatalogDrift("fast", modelId);

    const rows = await db
      .select()
      .from(operatorAlertsTable)
      .where(eq(operatorAlertsTable.fingerprint, fingerprint));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "open",
      provider: "groq",
      modelRole: "fast",
      modelId,
      occurrenceCount: 2,
    });
  });

  it("resolves existing drift without creating a healthy-path alert", async () => {
    await resolveGroqModelCatalogAlerts();
    expect(await db.select().from(operatorAlertsTable).where(eq(operatorAlertsTable.fingerprint, fingerprint))).toHaveLength(0);

    await recordGroqModelCatalogDrift("fast", modelId);
    await resolveGroqModelCatalogAlerts();

    const rows = await db
      .select()
      .from(operatorAlertsTable)
      .where(eq(operatorAlertsTable.fingerprint, fingerprint));
    expect(rows[0]).toMatchObject({ status: "resolved" });
    expect(rows[0]?.resolvedAt).toBeInstanceOf(Date);
  });

  it("deduplicates temporary catalog outages without storing provider diagnostics", async () => {
    await recordGroqModelCatalogUnavailable();
    await recordGroqModelCatalogUnavailable();

    const rows = await db
      .select()
      .from(operatorAlertsTable)
      .where(eq(operatorAlertsTable.fingerprint, unavailableFingerprint));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "open",
      kind: "groq_model_catalog_unavailable",
      provider: "groq",
      modelRole: "catalog",
      modelId: "catalog",
      occurrenceCount: 2,
    });
    expect(JSON.stringify(rows[0])).not.toContain("apiKey");
  });

  it("resolves temporary catalog outages on a healthy check", async () => {
    await recordGroqModelCatalogUnavailable();
    await resolveGroqModelCatalogAlerts();

    const rows = await db
      .select()
      .from(operatorAlertsTable)
      .where(eq(operatorAlertsTable.fingerprint, unavailableFingerprint));
    expect(rows[0]).toMatchObject({ status: "resolved" });
    expect(rows[0]?.resolvedAt).toBeInstanceOf(Date);
  });

  it("records one alert per Runtime session and closes that session's alert on resolution", async () => {
    const now = new Date();
    const oldStart = new Date(now.getTime() - 10_000);
    const startingSession = {
      projectId: runtimeProjectId,
      sessionId: runtimeSessionId,
      startedAt: oldStart,
    };
    await syncRuntimeStartUnresolvedAlerts([startingSession], 1_000, now);
    await syncRuntimeStartUnresolvedAlerts([startingSession], 1_000, now);

    const rows = await db.select().from(operatorAlertsTable)
      .where(eq(operatorAlertsTable.fingerprint, runtimeFingerprint));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "runtime_start_unresolved",
      status: "open",
      provider: "runtime",
      modelRole: "startup",
      modelId: runtimeSessionId,
      projectId: runtimeProjectId,
      occurrenceCount: 1,
    });

    await syncRuntimeStartUnresolvedAlerts([], 1_000, now);
    const resolved = await db.select().from(operatorAlertsTable)
      .where(eq(operatorAlertsTable.fingerprint, runtimeFingerprint));
    expect(resolved[0]).toMatchObject({ status: "resolved" });
    expect(resolved[0]?.resolvedAt).toBeInstanceOf(Date);
  });
});