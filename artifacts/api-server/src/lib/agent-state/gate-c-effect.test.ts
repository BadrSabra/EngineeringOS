import { describe, expect, it } from "vitest";
import {
  buildGateCAction,
  buildGateCEffectContract,
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
});