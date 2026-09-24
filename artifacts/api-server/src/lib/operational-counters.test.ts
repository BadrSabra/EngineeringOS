import { beforeEach, describe, expect, it } from "vitest";
import {
  getOperationalCounters,
  recordAgentEpisodeShadowFailure,
  recordAgentEpisodeShadowStart,
  recordAgentEpisodeShadowSuccess,
  resetOperationalCounters,
} from "./operational-counters.js";

describe("agent episode Shadow health counters", () => {
  beforeEach(() => {
    resetOperationalCounters();
  });

  it("records bounded write outcomes and computes a p95 latency", () => {
    recordAgentEpisodeShadowStart();
    recordAgentEpisodeShadowSuccess(10);
    recordAgentEpisodeShadowStart();
    recordAgentEpisodeShadowSuccess(40);
    recordAgentEpisodeShadowStart();
    recordAgentEpisodeShadowSuccess(100);
    recordAgentEpisodeShadowFailure("stale_worker");
    recordAgentEpisodeShadowFailure("sequence_conflict");
    recordAgentEpisodeShadowFailure("invalid_contract");
    recordAgentEpisodeShadowFailure("terminal_immutable");

    expect(getOperationalCounters().agentEpisodeShadow).toEqual({
      writes: 3,
      successes: 3,
      failures: 4,
      staleWorkerRejections: 1,
      sequenceConflicts: 1,
      idempotencyConflicts: 1,
      terminalImmutableRejections: 1,
      p95LatencyMs: 100,
    });
  });

  it("resets campaign state without affecting legacy counters", () => {
    recordAgentEpisodeShadowStart();
    recordAgentEpisodeShadowSuccess(60_000);
    resetOperationalCounters();

    expect(getOperationalCounters().agentEpisodeShadow).toEqual({
      writes: 0,
      successes: 0,
      failures: 0,
      staleWorkerRejections: 0,
      sequenceConflicts: 0,
      idempotencyConflicts: 0,
      terminalImmutableRejections: 0,
      p95LatencyMs: null,
    });
  });
});