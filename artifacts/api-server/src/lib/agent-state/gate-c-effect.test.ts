import { describe, expect, it } from "vitest";
import {
  buildGateCAction,
  buildGateCEffectContract,
  buildRuntimeGateCAfterObservation,
  gateCEffectIdentity,
} from "./gate-c-effect.js";

describe("Gate C effect contracts", () => {
  it("binds browser verification to the operation and server-owned capability", () => {
    const identity = gateCEffectIdentity({
      kind: "browser",
      operationId: "operation-browser",
    });
    const action = buildGateCAction({
      actionId: "action-browser",
      episodeId: "episode-browser",
      projectId: "project-browser",
      operationId: "operation-browser",
      sourceRevision: "revision-browser",
      recipeId: "browser.verify",
      capabilityId: "browser.verify.default",
      approvedPaths: ["src/App.tsx"],
    });
    const contract = buildGateCEffectContract({
      kind: "browser",
      operationId: "operation-browser",
      beforeEvidenceRef: "before-browser",
      afterEvidenceRef: "after-browser",
    });

    expect(action).toMatchObject({
      episodeId: "episode-browser",
      capabilityId: "browser.verify.default",
      observationProfile: "BROWSER",
      expectedEffects: [identity.effectId],
    });
    expect(contract).toMatchObject({
      effectId: identity.effectId,
      observationProfile: "BROWSER",
      requiredEvidence: ["before-browser", "after-browser"],
      expectedStateChanges: [{
        subject: identity.subject,
        predicate: identity.predicate,
        expectedValue: "passed",
      }],
    });
  });

  it("treats delivery as a high-risk remote effect", () => {
    const action = buildGateCAction({
      actionId: "action-delivery",
      episodeId: "episode-delivery",
      projectId: "project-delivery",
      operationId: "operation-delivery",
      sourceRevision: "revision-delivery",
      recipeId: "delivery.push.github",
      capabilityId: "github.push_verified_commit",
      approvedPaths: [],
    });

    expect(action.risk).toBe("HIGH");
    expect(action.observationProfile).toBe("DELIVERY");
    expect(action.authorization).toMatchObject({ source: "server" });
  });

  it("preserves runtime.start identity while separating restart and stop profiles", () => {
    const start = gateCEffectIdentity({ kind: "runtime", operationId: "operation-runtime" });
    expect(start).toEqual({
      subject: "runtime:operation-runtime",
      predicate: "serving.status",
      effectId: "runtime.serving.observed",
    });
    const restart = gateCEffectIdentity({ kind: "runtime-restart", operationId: "operation-runtime" });
    const stop = gateCEffectIdentity({ kind: "runtime-stop", operationId: "operation-runtime" });
    expect(restart.effectId).not.toBe(start.effectId);
    expect(stop.effectId).not.toBe(start.effectId);
    for (const [recipeId, capabilityId] of [
      ["runtime.restart", "runtime.restart"],
      ["runtime.stop", "runtime.stop"],
    ] as const) {
      const action = buildGateCAction({
        actionId: `action-${recipeId}`,
        episodeId: "episode-runtime",
        projectId: "project-runtime",
        operationId: "operation-runtime",
        sourceRevision: "revision-runtime",
        recipeId,
        capabilityId,
        approvedPaths: [],
      });
      expect(action.observationProfile).toBe("RUNTIME");
      expect(action.expectedEffects).toEqual([
        recipeId === "runtime.restart" ? restart.effectId : stop.effectId,
      ]);
    }
  });

  it("accepts runtime serving only from a complete identity-bound after-state", () => {
    const projectId = "project-runtime";
    const sessionId = "session-runtime";
    const revision = "revision-runtime";
    const state = (overrides: Record<string, unknown> = {}) => ({
      status: "passed",
      projectId,
      sessionId,
      revision,
      pid: 321,
      port: 43123,
      processAlive: true,
      portReady: true,
      healthStatus: 200,
      servingRevision: revision,
      markerMatched: null,
      observedAt: "2026-09-25T12:00:00.000Z",
      ...overrides,
    });
    const observe = (
      afterState: unknown,
      evidenceOverrides: Record<string, unknown> = {},
      recipeId = "runtime.start",
    ) =>
      buildRuntimeGateCAfterObservation({
        recipeId,
        projectId,
        sourceRevision: revision,
        evidence: {
          sessionId,
          afterState,
          ...evidenceOverrides,
        },
      });

    expect(observe(state())).toMatchObject({
      effectValue: "passed",
      sessionId,
      facts: {
        after: {
          projectId,
          sessionId,
          revision,
          processAlive: true,
          portReady: true,
          healthStatus: 200,
          servingRevision: revision,
        },
      },
    });
    expect(observe(state(), {}, "runtime.restart")?.effectValue).toBe("passed");

    for (const invalidState of [
      state({ processAlive: false }),
      state({ portReady: false }),
      state({ healthStatus: 503 }),
      state({ servingRevision: "older-revision" }),
      state({ markerMatched: false }),
      state({ status: "unavailable" }),
    ]) {
      expect(observe(invalidState)?.effectValue).toBe("failed");
    }
    expect(observe(undefined)).toBeUndefined();
    expect(observe(state({ sessionId: "another-session" }))).toBeUndefined();
    expect(observe(state({ projectId: "another-project" }))).toBeUndefined();
    expect(observe(state({ revision: "another-revision" }))).toBeUndefined();
    expect(observe(state({ observedAt: "not-a-date" }))).toBeUndefined();
    expect(observe(state(), { sessionId: "another-session" })).toBeUndefined();
  });

  it("requires matching live-before and stopped-after identities for runtime.stop", () => {
    const projectId = "project-runtime";
    const sessionId = "session-runtime";
    const revision = "revision-runtime";
    const beforeState = {
      status: "passed",
      projectId,
      sessionId,
      revision,
      pid: 321,
      port: 43123,
      processAlive: true,
      portReady: true,
      healthStatus: 200,
      servingRevision: revision,
      markerMatched: null,
      observedAt: "2026-09-25T12:00:00.000Z",
    };
    const afterState = {
      ...beforeState,
      processAlive: false,
      portReady: false,
      healthStatus: null,
      servingRevision: null,
      observedAt: "2026-09-25T12:00:05.000Z",
    };
    const observe = (after: unknown, before: unknown = beforeState) =>
      buildRuntimeGateCAfterObservation({
        recipeId: "runtime.stop",
        projectId,
        sourceRevision: revision,
        evidence: { sessionId, beforeState: before, afterState: after },
      });

    expect(observe(afterState)?.effectValue).toBe("passed");
    expect(observe({ ...afterState, pid: 999 })?.effectValue).toBe("failed");
    expect(observe(afterState, { ...beforeState, healthStatus: 503 })?.effectValue).toBe("failed");
    expect(observe(afterState, null)).toBeUndefined();
  });
});
