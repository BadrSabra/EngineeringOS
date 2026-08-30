import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../../app.js";
import {
  db,
  operatorAlertsTable,
} from "@workspace/db";

const fingerprints: string[] = [];

afterEach(async () => {
  for (const fingerprint of fingerprints.splice(0)) {
    await db
      .delete(operatorAlertsTable)
      .where(eq(operatorAlertsTable.fingerprint, fingerprint))
      .catch(() => undefined);
  }
});

function alertValues(fingerprint: string, status: "open" | "resolved" = "open") {
  const now = new Date();
  return {
    id: `operator-alert-test-${fingerprint}`,
    fingerprint,
    kind: "groq_model_catalog_drift" as const,
    status,
    provider: "groq",
    modelRole: "fast" as const,
    modelId: "openai/retired-fast",
    title: "Groq Fast model is unavailable",
    message: "The configured Groq Fast model is missing from Groq's live model catalog.",
    remediation: "Update the affected Groq model ID to a current catalog model, then restart the API.",
    occurrenceCount: 2,
    firstSeenAt: now,
    lastSeenAt: now,
    resolvedAt: status === "resolved" ? now : null,
  };
}

describe("GET /api/ai/operator-alerts", () => {
  it("returns only open safe alert metadata by default", async () => {
    const openFingerprint = `operator-alert-test-open-${Date.now()}`;
    const resolvedFingerprint = `operator-alert-test-resolved-${Date.now()}`;
    fingerprints.push(openFingerprint, resolvedFingerprint);
    await db.insert(operatorAlertsTable).values([
      alertValues(openFingerprint),
      alertValues(resolvedFingerprint, "resolved"),
    ]);

    const res = await request(app).get("/api/ai/operator-alerts");

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0]).toMatchObject({
      fingerprint: openFingerprint,
      provider: "groq",
      modelRole: "fast",
      modelId: "openai/retired-fast",
      remediation: expect.stringContaining("restart the API"),
      occurrenceCount: 2,
    });
    expect(JSON.stringify(res.body)).not.toContain("apiKey");
    expect(JSON.stringify(res.body)).not.toContain("raw provider");
  });

  it("can include resolved history and enforces the response bound", async () => {
    const fingerprintsForTest = Array.from({ length: 3 }, (_, index) => `operator-alert-test-history-${Date.now()}-${index}`);
    fingerprints.push(...fingerprintsForTest);
    await db.insert(operatorAlertsTable).values(fingerprintsForTest.map((fingerprint) => alertValues(fingerprint)));

    const res = await request(app).get("/api/ai/operator-alerts?activeOnly=false&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(2);
  });

  it("rejects invalid bounds", async () => {
    const res = await request(app).get("/api/ai/operator-alerts?limit=101");
    expect(res.status).toBe(400);
  });
});