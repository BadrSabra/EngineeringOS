import { describe, expect, it } from "vitest";
import type {
  AiAgentEffectBundle,
  AiAgentObservation,
  AiWorldTransition,
} from "@workspace/db";
import {
  linkedWorldTransitionObservationIds,
  projectRuntimeWorldTransition,
} from "./world-transition-read-projection.js";

const now = new Date("2026-09-27T10:00:00.000Z");

function makeTransition(overrides: Partial<AiWorldTransition> = {}): AiWorldTransition {
  return {
    id: "transition-1",
    projectId: "project-1",
    executionId: "execution-1",
    attempt: 2,
    episodeId: "episode-1",
    actionId: "action-1",
    effectBundleId: "effect-1",
    parentWorldRevision: "world-before",
    resultingWorldRevision: "world-after",
    taskScope: "runtime",
    environmentRevisionKey: "environment-1",
    environmentRevision: "environment-revision-1",
    freshness: "fresh",
    beforeObservationIds: ["before-1"],
    afterObservationIds: ["after-1"],
    materializedObservationIds: ["before-1", "after-1"],
    parentFactRefs: [],
    changedFactRefs: [],
    evidenceRefs: [],
    status: "materialized",
    idempotencyKey: "runtime.start:execution-1:2:episode-1:action-1",
    retryCount: 0,
    failureCode: null,
    nextRetryAt: null,
    materializedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeObservation(
  id: string,
  predicate: string,
  runtimeStatus: "stopped" | "running",
  overrides: Partial<AiAgentObservation> = {},
): AiAgentObservation {
  const observationRole = predicate === "runtime.before_state" ? "before" : "after";
  return {
    id,
    projectId: "project-1",
    executionId: "execution-1",
    episodeId: "episode-1",
    taskScope: "runtime",
    environmentRevisionKey: "environment-1",
    kind: "runtime-state",
    provenance: "DIRECT_OBSERVATION",
    observationRole,
    sourceType: "runtime",
    sourceId: "session-1",
    sourceVersion: null,
    subject: "runtime",
    predicate,
    value: { status: "observed", runtimeStatus, sessionId: "private-session-detail" },
    valueHash: `hash-${id}`,
    sourceRefs: [{ secret: "must-not-be-projected" }],
    observedAt: now,
    projectRevision: "project-revision-1",
    environmentRevision: "environment-revision-1",
    completeness: "complete",
    freshness: "fresh",
    environmentFreshness: "fresh",
    evidenceRefs: [{ secret: "must-not-be-projected" }],
    sequence: 1,
    createdAt: now,
    ...overrides,
  };
}

function makeEffectBundle(overrides: Partial<AiAgentEffectBundle> = {}): AiAgentEffectBundle {
  return {
    id: "effect-1",
    projectId: "project-1",
    executionId: "execution-1",
    attempt: 2,
    episodeId: "episode-1",
    effectIds: ["effect-runtime-start"],
    effectContractHashes: ["hash-effect"],
    verdict: "OBSERVED",
    worldRevision: "world-after",
    createdAt: now,
    ...overrides,
  };
}

describe("runtime World Transition read projection", () => {
  it("projects only bounded state and identity fields from fresh linked observations", () => {
    const projection = projectRuntimeWorldTransition(
      makeTransition(),
      [
        makeObservation("before-1", "runtime.before_state", "stopped"),
        makeObservation("after-1", "runtime.after_state", "running"),
      ],
      makeEffectBundle(),
    );

    expect(projection).toMatchObject({
      id: "transition-1",
      executionId: "execution-1",
      attempt: 2,
      episodeId: "episode-1",
      status: "materialized",
      effectBundle: { id: "effect-1", verdict: "OBSERVED" },
    });
    expect(projection.beforeObservations[0]).toMatchObject({
      id: "before-1",
      predicate: "runtime.before_state",
      runtimeStatus: "stopped",
    });
    expect(projection.afterObservations[0]).toMatchObject({
      id: "after-1",
      predicate: "runtime.after_state",
      runtimeStatus: "running",
    });
    expect(projection.beforeObservations[0]).not.toHaveProperty("value");
    expect(projection.beforeObservations[0]).not.toHaveProperty("sourceRefs");
    expect(projection.afterObservations[0]).not.toHaveProperty("evidenceRefs");
    expect(JSON.stringify(projection)).not.toContain("private-session-detail");
    expect(JSON.stringify(projection)).not.toContain("must-not-be-projected");
  });

  it("does not expose a state value or effect bundle when freshness or identity is invalid", () => {
    const projection = projectRuntimeWorldTransition(
      makeTransition(),
      [
        makeObservation("before-1", "runtime.before_state", "stopped", {
          freshness: "stale",
        }),
        makeObservation("after-1", "runtime.after_state", "running", {
          episodeId: "other-episode",
        }),
      ],
      makeEffectBundle({ episodeId: "other-episode" }),
    );

    expect(projection.beforeObservations[0]?.runtimeStatus).toBeNull();
    expect(projection.afterObservations).toEqual([]);
    expect(projection.effectBundle).toBeNull();
  });

  it("does not treat one observation reused on both sides as independent state evidence", () => {
    const transition = makeTransition({
      beforeObservationIds: ["shared-1"],
      afterObservationIds: ["shared-1"],
    });
    const projection = projectRuntimeWorldTransition(
      transition,
      [makeObservation("shared-1", "runtime.status", "running")],
      null,
    );

    expect(projection.beforeObservations[0]?.runtimeStatus).toBeNull();
    expect(projection.afterObservations[0]?.runtimeStatus).toBeNull();
  });

  it("deduplicates the transition-linked observation identifiers", () => {
    expect(linkedWorldTransitionObservationIds(makeTransition({
      beforeObservationIds: ["before-1", "before-1"],
      afterObservationIds: ["after-1", "before-1"],
    }))).toEqual(["before-1", "after-1"]);
  });
});