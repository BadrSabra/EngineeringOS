import { describe, expect, it } from "vitest";
import { AgentObservationSchema, parseAgentObservation } from "../agent-state/index.js";

const observation = {
  schemaVersion: "1" as const,
  observationId: "observation-1",
  projectId: "project-1",
  executionId: "execution-1",
  episodeId: "episode-1",
  kind: "SOURCE" as const,
  observationRole: "source_read",
  sourceType: "retained_read",
  sourceId: "read-1",
  subject: "src/index.ts",
  predicate: "exists",
  value: { exists: true },
  sourceRefs: ["evidence-1"],
  observedAt: "2026-09-24T00:00:00.000Z",
  completeness: "complete" as const,
  freshness: "fresh" as const,
  evidenceRefs: ["evidence-1"],
};

describe("agent observation contract", () => {
  it("parses server-owned observation metadata", () => {
    expect(parseAgentObservation(observation).freshness).toBe("fresh");
  });

  it("rejects unknown completeness and oversized values", () => {
    expect(AgentObservationSchema.safeParse({ ...observation, completeness: "complete-ish" }).success).toBe(false);
    expect(AgentObservationSchema.safeParse({ ...observation, value: "x".repeat(17 * 1024) }).success).toBe(false);
  });
});