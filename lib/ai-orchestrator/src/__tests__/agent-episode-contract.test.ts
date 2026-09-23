import { describe, expect, it } from "vitest";
import {
  AgentEpisodeEventSchema,
  AgentEpisodeSchema,
  canonicalJsonHash,
  parseAgentEpisode,
  toPublicAgentEpisode,
} from "../agent-state/index.js";

const baseEpisode = {
  schemaVersion: "1" as const,
  episodeId: "episode-1",
  projectId: "project-1",
  executionId: "execution-1",
  attempt: 0,
  projectRevision: "revision-1",
  intentKind: "TASK_EXECUTION",
  scope: { kind: "project", projectId: "project-1" },
  observationRefs: [],
  actionRefs: [],
  expectedEffectRefs: [],
  observedEffectRefs: [],
  evidenceRefs: [],
  state: "created" as const,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

describe("agent episode contract", () => {
  it("parses a bounded episode and rejects unknown states", () => {
    expect(parseAgentEpisode(baseEpisode).episodeId).toBe("episode-1");
    expect(AgentEpisodeSchema.safeParse({ ...baseEpisode, state: "unknown" }).success).toBe(false);
  });

  it("rejects oversized event payloads", () => {
    const result = AgentEpisodeEventSchema.safeParse({
      schemaVersion: "1",
      eventId: "event-1",
      episodeId: "episode-1",
      projectId: "project-1",
      executionId: "execution-1",
      attempt: 0,
      sequence: 0,
      eventType: "EPISODE_CREATED",
      payload: { text: "x".repeat(33 * 1024) },
      actorType: "server",
      createdAt: "2026-09-24T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("hashes equivalent object key order identically", () => {
    expect(canonicalJsonHash({ b: 2, a: 1 })).toBe(canonicalJsonHash({ a: 1, b: 2 }));
  });

  it("does not expose scope or provider-shaped payloads in the public projection", () => {
    const publicEpisode = toPublicAgentEpisode(parseAgentEpisode({
      ...baseEpisode,
      scope: { providerDiagnostics: "secret", path: "/tmp/private" },
      reasonCode: "PROVIDER_FAILURE",
    }));
    expect(publicEpisode).not.toHaveProperty("scope");
    expect(publicEpisode).not.toHaveProperty("providerDiagnostics");
    expect(JSON.stringify(publicEpisode)).not.toContain("/tmp/private");
  });
});