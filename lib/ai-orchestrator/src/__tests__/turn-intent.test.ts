import { describe, expect, it } from "vitest";
import { classifyRequest } from "../prompts/profile-classifier.js";
import { resolveTurnIntent } from "../turn-intent.js";

describe("resolveTurnIntent", () => {
  it.each([
    "ما هذا المشروع؟",
    "ممكن تساعدني أفهم المشروع؟",
    "هل المشروع شغال حاليًا؟",
    "What is this project?",
  ])("keeps low-risk orientation question tool-free: %s", (message) => {
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(classification.category).toBe("simple");
    expect(classification.allowPrefetch).toBe(false);
    expect(intent).toMatchObject({
      kind: "CHAT",
      requiresTools: false,
      requiresEvidence: false,
      operationMode: "CHAT",
    });
  });

  it("does not weaken an explicit forensic request containing project language", () => {
    const message = "افحص المشروع عن الفجوات";
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(classification.category).not.toBe("simple");
    expect(intent.requiresTools).toBe(true);
    expect(intent.kind).toBe("FORENSIC_AUDIT");
  });

  it.each(["مرحبا", "hello", "Thanks for your help", "Tell me a joke"])(
    "routes ordinary conversation as non-evidence CHAT: %s",
    (message) => {
      const intent = resolveTurnIntent(message);

      expect(intent).toMatchObject({
        kind: "CHAT",
        executionTaskType: "chat",
        requiresTools: false,
        requiresEvidence: false,
        allowsBuildHandoff: false,
        operationMode: "CHAT",
        outputContract: "GENERIC_RESPONSE",
      });
    },
  );

  it("routes a source-file question to tool chat without a forensic evidence gate", () => {
    const intent = resolveTurnIntent("Open src/server.ts and explain the route.");

    expect(intent).toMatchObject({
      kind: "PROJECT_QUERY",
      executionTaskType: "tool_chat",
      requiresTools: true,
      requiresEvidence: false,
      operationMode: "CHAT",
    });
  });

  it("routes an explicit audit through tools and the evidence gate", () => {
    const intent = resolveTurnIntent(
      "Audit the entire repository and identify the root causes.",
    );

    expect(intent).toMatchObject({
      kind: "FORENSIC_AUDIT",
      executionTaskType: "analysis",
      requiresTools: true,
      requiresEvidence: true,
      operationMode: "FORENSIC_AUDIT",
    });
  });

  it("resumes the verified prior classification for a real continuation", () => {
    const prior = classifyRequest(
      "Audit the entire repository and identify the root causes.",
    );
    const intent = resolveTurnIntent("Continue", {
      classification: prior,
      resumed: true,
    });

    expect(intent.resumed).toBe(true);
    expect(intent.allowsResume).toBe(true);
    expect(intent.requiresEvidence).toBe(true);
  });

  it("treats an approved Build handoff as delivery rather than chat", () => {
    const intent = resolveTurnIntent("Build the approved implementation plan.", {
      buildHandoff: true,
    });

    expect(intent).toMatchObject({
      kind: "DELIVERY",
      executionTaskType: "task_execution",
      requiresTools: true,
      requiresEvidence: false,
      allowsBuildHandoff: true,
      operationMode: "DELIVERY",
    });
  });

  it("keeps implementation-plan creation read-only despite action words", () => {
    const intent = resolveTurnIntent(
      "Create an implementation plan for feature X.",
    );

    expect(intent.classification.implementationPlanMode).toBe(true);
    expect(intent).toMatchObject({
      kind: "DELIVERY",
      executionTaskType: "chat",
      requiresTools: false,
      requiresEvidence: false,
      allowsBuildHandoff: false,
      operationMode: "DELIVERY",
      outputContract: "GENERIC_RESPONSE",
    });
  });

  it.each(["How do I edit settings?", "How do I change settings?"])(
    "does not treat an interrogative action word as a delivery request: %s",
    (message) => {
      const intent = resolveTurnIntent(message);

      expect(intent).toMatchObject({
        kind: "CHAT",
        executionTaskType: "chat",
        requiresTools: false,
        requiresEvidence: false,
        allowsBuildHandoff: false,
        operationMode: "CHAT",
      });
    },
  );

  it.each(["Can you please fix it?", "Please can you change it?"])(
    "routes a composed polite modification request as delivery: %s",
    (message) => {
      const intent = resolveTurnIntent(message);

      expect(intent).toMatchObject({
        kind: "DELIVERY",
        executionTaskType: "task_execution",
        requiresTools: true,
        requiresEvidence: false,
        allowsBuildHandoff: false,
        operationMode: "DELIVERY",
      });
    },
  );
});