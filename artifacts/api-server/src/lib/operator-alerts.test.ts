import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, operatorAlertsTable } from "@workspace/db";
import {
  recordGroqModelCatalogDrift,
  resolveGroqModelCatalogAlerts,
} from "./operator-alerts.js";

const modelId = "openai/operator-alert-test-retired";
const fingerprint = `groq_model_catalog_drift:groq:fast:${modelId}`;

afterEach(async () => {
  await db.delete(operatorAlertsTable).where(eq(operatorAlertsTable.fingerprint, fingerprint));
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
});