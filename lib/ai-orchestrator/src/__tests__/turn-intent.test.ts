import { describe, expect, it } from "vitest";
import { classifyRequest } from "../prompts/profile-classifier.js";
import {
  isCompoundExecutionRequest,
  isWriteCapableTurn,
  resolveTurnIntent,
} from "../turn-intent.js";

describe("resolveTurnIntent", () => {
  it("treats an explicit validation capability request as a project query, not a forensic audit", () => {
    const intent = resolveTurnIntent(
      "pecheck تشغيل اختبارات المعرفة عبر validation.run.knowledge-engine-tests",
    );

    expect(intent.kind).toBe("PROJECT_QUERY");
    expect(intent.executionTaskType).toBe("tool_chat");
    expect(intent.requiresTools).toBe(true);
    expect(intent.requiresEvidence).toBe(false);
  });

  it("keeps a bare Arabic greeting as isolated chat", () => {
    const intent = resolveTurnIntent("مرحبا");

    expect(intent.kind).toBe("CHAT");
    expect(intent.executionTaskType).toBe("chat");
    expect(intent.requiresTools).toBe(false);
    expect(intent.requiresEvidence).toBe(false);
  });

  it.each([
    "ما هذا المشروع؟",
    "ممكن تساعدني أفهم المشروع؟",
    "هل المشروع شغال حاليًا؟",
    "What is this project?",
  ])("requests project capability for orientation question without evidence mode: %s", (message) => {
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(classification.category).toBe("simple");
    expect(classification.allowPrefetch).toBe(false);
    expect(intent).toMatchObject({
      kind: "PROJECT_QUERY",
      executionTaskType: "tool_chat",
      requiresTools: true,
      requiresEvidence: false,
      operationMode: "CHAT",
    });
  });

  it.each(["ممكن تساعدني؟", "كيف أبدأ؟", "Can you help me?"])(
    "keeps generic question tool-free: %s",
    (message) => {
      const intent = resolveTurnIntent(message);

      expect(intent).toMatchObject({
        kind: "CHAT",
        executionTaskType: "chat",
        requiresTools: false,
        requiresEvidence: false,
      });
    },
  );

  it("does not weaken an explicit forensic request containing project language", () => {
    const message = "افحص المشروع عن الفجوات";
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(classification.taskType).not.toBe("BEHAVIOR_QUERY");
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

  it("only marks write-capable delivery turns for apply serialization", () => {
    expect(isWriteCapableTurn(resolveTurnIntent("Open src/server.ts and explain the route."))).toBe(false);
    expect(isWriteCapableTurn(resolveTurnIntent("Create an implementation plan for feature X."))).toBe(false);
    expect(isWriteCapableTurn(resolveTurnIntent("Please fix the route in src/server.ts."))).toBe(true);
    expect(isWriteCapableTurn(resolveTurnIntent("Build the approved implementation plan.", {
      buildHandoff: true,
    }))).toBe(true);
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

  it("routes Arabic production-reachability proof requests to the forensic proof contract", () => {
    const message = "أثبت أن computeCentrality قابل للوصول في الإنتاج.";
    const intent = resolveTurnIntent(message);

    expect(intent).toMatchObject({
      kind: "FORENSIC_AUDIT",
      forensicTaskType: "FINDING_ANALYSIS",
      analysisMode: "FORENSIC",
      outputContract: "FINDING_ANALYSIS",
      requiresTools: true,
      requiresEvidence: true,
      operationMode: "FORENSIC_AUDIT",
    });
  });

  it("keeps ordinary Arabic behavior questions on the behavior-query path", () => {
    const intent = resolveTurnIntent(
      "ما الذي يحدث عندما تكون flag=false في الدالة pick داخل src/pick.ts؟",
    );

    expect(intent).toMatchObject({
      forensicTaskType: "BEHAVIOR_QUERY",
      outputContract: "BEHAVIOR_ANSWER",
      requiresEvidence: true,
    });
  });

  it.each([
    "افحص مشروعي وأخبرني إن كانت هناك مشاكل مهمة.",
    "Review my project and tell me about important problems.",
  ])("asks for scope before a broad audit: %s", (message) => {
    const intent = resolveTurnIntent(message);

    expect(intent).toMatchObject({
      kind: "CHAT",
      executionTaskType: "chat",
      requiresTools: false,
      requiresEvidence: false,
      scopeClarificationRequired: true,
      operationMode: "CHAT",
    });
  });

  it.each([
    "Audit src/api and identify important problems.",
    "Audit the core production files and identify important problems.",
    "Audit the entire repository and identify the root causes.",
  ])("starts only after the user declares an audit scope: %s", (message) => {
    const intent = resolveTurnIntent(message);

    expect(intent.scopeClarificationRequired).toBe(false);
    expect(intent.requiresTools).toBe(true);
    expect(intent.requiresEvidence).toBe(true);
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

  it("treats a bare Arabic start as analysis continuation, not delivery", () => {
    const prior = classifyRequest(
      "Audit src/api and identify important problems.",
    );
    const intent = resolveTurnIntent("ابدأ", {
      classification: prior,
      resumed: true,
    });

    expect(intent).toMatchObject({
      kind: "FORENSIC_AUDIT",
      executionTaskType: "analysis",
      requiresTools: true,
      requiresEvidence: true,
      resumed: true,
      operationMode: "FORENSIC_AUDIT",
    });
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

  it("routes a persisted implementation-plan continuation to tools without replanning", () => {
    const classification = classifyRequest("Continue");
    const intent = resolveTurnIntent("Continue", {
      classification: { ...classification, implementationPlanMode: true },
      resumed: true,
      implementationPlanResume: true,
    });

    expect(intent).toMatchObject({
      implementationPlanResume: true,
      kind: "PROJECT_QUERY",
      requiresTools: true,
      requiresEvidence: false,
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

  it.each([
    "inspect src/foo.ts and fix the bug",
    "audit src/foo.ts then apply the approved repair plan",
    "تحقق من src/foo.ts ثم أصلح المشكلة",
  ])("keeps compound inspect-and-change requests write-capable: %s", (message) => {
    expect(isCompoundExecutionRequest(message)).toBe(true);
    expect(resolveTurnIntent(message)).toMatchObject({
      kind: "DELIVERY",
      executionTaskType: "task_execution",
      requiresTools: true,
      requiresEvidence: false,
      compoundExecution: true,
      phases: ["evidence", "proposal"],
    });
  });

  it.each([
    "Audit src/foo.ts and report the root cause.",
    "راجع src/foo.ts ثم اذكر السبب الجذري فقط",
    "How do I edit settings?",
  ])("does not promote read-only or explanatory requests to compound delivery: %s", (message) => {
    expect(isCompoundExecutionRequest(message)).toBe(false);
  });
});