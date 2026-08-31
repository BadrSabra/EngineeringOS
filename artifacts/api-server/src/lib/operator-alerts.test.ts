import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, operatorAlertsTable } from "@workspace/db";
import {
  recordGroqModelCatalogDrift,
  recordGroqModelCatalogUnavailable,
  resolveGroqModelCatalogAlerts,
} from "./operator-alerts.js";

const modelId = "openai/operator-alert-test-retired";
const fingerprint = `groq_model_catalog_drift:groq:fast:${modelId}`;
const unavailableFingerprint = "groq_model_catalog_unavailable:groq:catalog";

afterEach(async () => {
  await db.delete(operatorAlertsTable).where(
    eq(operatorAlertsTable.fingerprint, fingerprint),
  );
  await db.delete(operatorAlertsTable).where(
    eq(operatorAlertsTable.fingerprint, unavailableFingerprint),
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
});