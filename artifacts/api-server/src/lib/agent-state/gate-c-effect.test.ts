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
});