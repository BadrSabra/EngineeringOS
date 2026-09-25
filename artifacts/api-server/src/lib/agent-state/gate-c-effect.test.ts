import { describe, expect, it } from "vitest";
import {
  buildGateCAction,
  buildGateCEffectContract,
  buildBrowserGateCAfterObservation,
  buildDeliveryGateCAfterObservation,
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

  it("accepts browser after-state only when project, run, profile, revision, and origin agree", () => {
    const input = {
      projectId: "project-browser",
      operationId: "operation-browser",
      executionId: "execution-browser",
      executionAttempt: 2,
      sourceRevision: "revision-browser",
      expectedProfileName: "default",
    };
    const sessionId = "session-browser";
    const origin = "http://127.0.0.1:43123";
    const browserOutput = (
      status = "passed",
      evidenceOverrides: Record<string, unknown> = {},
      outputOverrides: Record<string, unknown> = {},
    ) => ({
      status,
      profile: "default",
      ...outputOverrides,
      evidence: {
        kind: "browser_preview",
        projectId: input.projectId,
        operationId: input.operationId,
        executionId: input.executionId,
        executionAttempt: input.executionAttempt,
        sourceRevision: input.sourceRevision,
        revision: input.sourceRevision,
        sessionId,
        profileName: "default",
        origin,
        permittedOrigin: origin,
        artifactRef: `browser-preview:${sessionId}:${input.operationId}:${input.executionId}`,
        status,
        consoleErrorCount: 0,
        observedAt: "2026-09-25T12:00:00.000Z",
        evidenceId: "browser-evidence",
        ...evidenceOverrides,
      },
    });

    expect(buildBrowserGateCAfterObservation({
      ...input,
      output: browserOutput(),
    })).toMatchObject({
      effectValue: "passed",
      facts: {
        projectId: input.projectId,
        operationId: input.operationId,
        executionId: input.executionId,
        executionAttempt: input.executionAttempt,
        sourceRevision: input.sourceRevision,
        servingRevision: input.sourceRevision,
        sessionId,
        profileName: "default",
        origin,
        permittedOrigin: origin,
        consoleErrorCount: 0,
      },
      sourceRefs: ["browser-evidence", `browser-preview:${sessionId}:${input.operationId}:${input.executionId}`],
    });
    expect(buildBrowserGateCAfterObservation({
      ...input,
      output: browserOutput("passed", { consoleErrorCount: 1 }),
    })?.effectValue).toBe("failed");
    expect(buildBrowserGateCAfterObservation({
      ...input,
      output: browserOutput("failed"),
    })?.effectValue).toBe("failed");
    expect(buildBrowserGateCAfterObservation({
      ...input,
      output: browserOutput("passed", { executionAttempt: 1 }),
    })).toBeUndefined();
    expect(buildBrowserGateCAfterObservation({
      ...input,
      output: browserOutput("passed", { origin: "http://127.0.0.1:43124" }),
    })).toBeUndefined();
    expect(buildBrowserGateCAfterObservation({
      ...input,
      output: browserOutput("passed", {}, { status: "failed" }),
    })).toBeUndefined();
  });

  it("requires an identity-bound GitHub after-state and exact remote commit, parent, tree, and marker", () => {
    const input = {
      projectId: "project-delivery",
      operationId: "operation-delivery",
      executionId: "execution-delivery",
      executionAttempt: 3,
      sourceRevision: "revision-delivery",
    };
    const operationMarker = `EngineeringOS-Operation: ${input.operationId}`;
    const deliveryOutput = (overrides: Record<string, unknown> = {}) => ({
      status: "passed",
      evidence: {
        evidenceId: "delivery-evidence",
        artifactRef: "github-delivery:verified",
        resultHash: "f".repeat(64),
      },
      afterState: {
        status: "passed",
        projectId: input.projectId,
        operationId: input.operationId,
        executionId: input.executionId,
        executionAttempt: input.executionAttempt,
        sourceRevision: input.sourceRevision,
        proposalId: "proposal-delivery",
        remoteUrl: "https://github.com/example/project.git",
        branch: "main",
        expectedCommitHash: "commit-1",
        remoteCommitHash: "commit-1",
        expectedParentHash: "parent-1",
        remoteParentHash: "parent-1",
        expectedTreeHash: "tree-1",
        remoteTreeHash: "tree-1",
        remoteParentCount: 1,
        candidateTreeHash: "candidate-tree",
        committedTreeHash: "candidate-tree",
        operationMarker,
        markerMatched: true,
        observedAt: "2026-09-25T12:00:00.000Z",
        ...overrides,
      },
    });

    expect(buildDeliveryGateCAfterObservation({
      ...input,
      output: deliveryOutput(),
    })).toMatchObject({
      effectValue: "passed",
      facts: {
        projectId: input.projectId,
        operationId: input.operationId,
        executionId: input.executionId,
        executionAttempt: input.executionAttempt,
        sourceRevision: input.sourceRevision,
        expectedCommitHash: "commit-1",
        remoteCommitHash: "commit-1",
        expectedParentHash: "parent-1",
        remoteParentHash: "parent-1",
        expectedTreeHash: "tree-1",
        remoteTreeHash: "tree-1",
        remoteParentCount: 1,
        markerMatched: true,
      },
      sourceRefs: [
        "delivery-evidence",
        "github-delivery:verified",
        "f".repeat(64),
      ],
    });
    expect(buildDeliveryGateCAfterObservation({
      ...input,
      output: deliveryOutput({ remoteCommitHash: "other-commit" }),
    })?.effectValue).toBe("failed");
    expect(buildDeliveryGateCAfterObservation({
      ...input,
      output: deliveryOutput({ remoteParentHash: "other-parent" }),
    })?.effectValue).toBe("failed");
    expect(buildDeliveryGateCAfterObservation({
      ...input,
      output: deliveryOutput({ remoteTreeHash: "other-tree" }),
    })?.effectValue).toBe("failed");
    expect(buildDeliveryGateCAfterObservation({
      ...input,
      output: deliveryOutput({ remoteParentCount: 2 }),
    })?.effectValue).toBe("failed");
    expect(buildDeliveryGateCAfterObservation({
      ...input,
      output: deliveryOutput({ committedTreeHash: "other-candidate" }),
    })?.effectValue).toBe("failed");
    expect(buildDeliveryGateCAfterObservation({
      ...input,
      output: deliveryOutput({ markerMatched: false }),
    })?.effectValue).toBe("failed");
    expect(buildDeliveryGateCAfterObservation({
      ...input,
      output: deliveryOutput({ executionAttempt: 2 }),
    })).toBeUndefined();
    expect(buildDeliveryGateCAfterObservation({
      ...input,
      output: deliveryOutput({ remoteUrl: "https://user:secret@github.com/example/project.git" }),
    })).toBeUndefined();
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
    const listener = (port: number) => ({
      status: "known",
      reasonCode: "listener_process_attested",
      port,
      identityDigest: "d".repeat(64),
      processAttestation: {
        status: "known",
        reasonCode: "child_process_observed",
        bindingDigest: "e".repeat(64),
        attestationDigest: "f".repeat(64),
        processEnvironmentDigest: "1".repeat(64),
      },
    });
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
      listener: listener(43123),
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
          listener: {
            status: "known",
            port: 43123,
            identityDigest: "d".repeat(64),
          },
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
      state({ listener: { ...listener(43123), status: "mismatch" } }),
    ]) {
      expect(observe(invalidState)?.effectValue).toBe("failed");
    }
    expect(observe(state({ listener: undefined }))).toBeUndefined();
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
      listener: {
        status: "known",
        reasonCode: "listener_process_attested",
        port: 43123,
        identityDigest: "d".repeat(64),
        processAttestation: {
          status: "known",
          reasonCode: "child_process_observed",
          bindingDigest: "e".repeat(64),
          attestationDigest: "f".repeat(64),
          processEnvironmentDigest: "1".repeat(64),
        },
      },
      observedAt: "2026-09-25T12:00:00.000Z",
    };
    const afterState = {
      ...beforeState,
      processAlive: false,
      portReady: false,
      healthStatus: null,
      servingRevision: null,
      observedAt: "2026-09-25T12:00:05.000Z",
      listener: {
        status: "unknown",
        reasonCode: "listener_not_running",
        port: null,
        identityDigest: null,
        processAttestation: {
          status: "unknown",
          reasonCode: "process_unavailable",
          bindingDigest: null,
          attestationDigest: null,
          processEnvironmentDigest: null,
        },
      },
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
