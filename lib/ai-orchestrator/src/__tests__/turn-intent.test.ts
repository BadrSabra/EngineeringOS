import { describe, expect, it } from "vitest";
import { classifyRequest } from "../prompts/profile-classifier.js";
import {
  isCompoundExecutionRequest,
  isRunProjectScanRequest,
  isWriteCapableTurn,
  resolveTurnIntent,
} from "../turn-intent.js";
import { buildProviderTools } from "../agents/chat-agent.js";

describe("resolveTurnIntent", () => {
  it.each([
    "تشغيل الفحص",
    "تشغيل فحص المشروع",
    "شغّل الفحص",
    "نفّذ الفحص",
    "ابدأ الفحص",
    "run scan",
    "execute the scan",
    "please run the project scan",
  ])("routes a project-scan command to the server-owned action: %s", (message) => {
    expect(isRunProjectScanRequest(message)).toBe(true);
    expect(resolveTurnIntent(message).serverAction).toBe("RUN_PROJECT_SCAN");
  });

  it.each([
    "ما هو الفحص؟",
    "اشرح لي الفحص",
    "What is a project scan?",
    "Audit the entire repository and identify the root causes.",
  ])("does not treat a scan question or audit as the scan action: %s", (message) => {
    expect(isRunProjectScanRequest(message)).toBe(false);
    expect(resolveTurnIntent(message).serverAction).toBeUndefined();
  });

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
    expect(intent.contextMode).toBe("light");
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
      contextMode: "project",
      outputContract: "GENERIC_RESPONSE",
    });
  });

  it("routes an Arabic question about the AI agent internals to the targeted project query", () => {
    const message = "ما هي آلية عمل وكيل الذكاء الاصطناعي؟";
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(classification.projectTarget?.id).toBe("embedded-ai");
    expect(intent).toMatchObject({
      kind: "PROJECT_QUERY",
      executionTaskType: "tool_chat",
      requiresTools: true,
      requiresEvidence: true,
      contextMode: "project",
    });
  });

  it("keeps an Arabic gap question as an evidence-backed project query", () => {
    for (const message of [
      "ما هي نقاط الضعف لدى الوكيل",
      "حدد نقاط ضعف الوكيل الداخلى للمشروع",
    ]) {
      const intent = resolveTurnIntent(message);

      expect(intent, message).toMatchObject({
        kind: "PROJECT_QUERY",
        executionTaskType: "tool_chat",
        requiresTools: true,
        requiresEvidence: true,
        outputContract: "BEHAVIOR_ANSWER",
        operationMode: "CHAT",
        projectTarget: { id: "gap-analysis" },
      });
    }
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
        contextMode: "light",
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
      contextMode: "project",
      outputContract: "GENERIC_RESPONSE",
    });
  });

  it("keeps the ordinary project-query provider manifest source-read-only", () => {
    const tools = buildProviderTools(
      "groq",
      "/tmp/project",
      undefined,
      false,
      false,
      [],
      false,
      false,
      false,
      true,
      "project-read-only",
    );
    const names = (tools ?? []).map((tool) => tool.function.name);

    expect(names).toEqual([
      "read_file",
      "read_file_range",
      "list_directory",
      "search_code",
    ]);
  });

  it("only marks write-capable delivery turns for apply serialization", () => {
    expect(isWriteCapableTurn(resolveTurnIntent("Open src/server.ts and explain the route."))).toBe(false);
    expect(isWriteCapableTurn(resolveTurnIntent("Create an implementation plan for feature X."))).toBe(false);
    expect(isWriteCapableTurn(resolveTurnIntent("Please fix the route in src/server.ts."))).toBe(false);
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

  it("routes Arabic session root-cause tracing through the evidence gate", () => {
    const intent = resolveTurnIntent(
      "تتبع مسار الجلسه الاخيره وقم بتحديد الاسباب الجذرية التي تؤدى إلى سلوك غير صحيح",
    );

    expect(intent).toMatchObject({
      kind: "FORENSIC_AUDIT",
      executionTaskType: "analysis",
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
    "Audit my project for important problems.",
    "دقق مشروعي بحثًا عن مشاكل مهمة.",
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
    "Analyze my project architecture.",
    "حلل معمارية مشروعي.",
  ])("keeps an ambiguous architecture question out of broad forensic scanning: %s", (message) => {
    const classification = classifyRequest(message);
    const intent = resolveTurnIntent(message, { classification });

    expect(intent).toMatchObject({
      kind: "PROJECT_QUERY",
      executionTaskType: "tool_chat",
      requiresTools: true,
      requiresEvidence: false,
      scopeClarificationRequired: false,
      operationMode: "CHAT",
    });
    expect(classification.orderedForensicRoots).toEqual([]);
  });

  it.each([
    "Audit src/api and identify important problems.",
    "Audit the core production files and identify important problems.",
    "Audit the entire repository and identify the root causes.",
    "دقق مجلد src/api وابحث عن المشاكل المهمة.",
    "دقق المشروع بالكامل وحدد الأسباب الجذرية.",
    "Full project audit with the required evidence map.",
    "تدقيق شامل للمشروع بحثًا عن المشاكل.",
    "تدقيق شامل للمشروع مع خريطة الأدلة المطلوبة.",
  ])("starts only after the user declares an audit scope: %s", (message) => {
    const intent = resolveTurnIntent(message);

    expect(intent.scopeClarificationRequired).toBe(false);
    expect(intent.requiresTools).toBe(true);
    expect(intent.requiresEvidence).toBe(true);
  });

  it.each([
    ["of", "project"],
    ["on", "workspace"],
    ["in", "repository"],
    ["of", "repo"],
    ["in", "codebase"],
  ])("keeps whole-project audit wording tool-enabled: %s the %s", (preposition, scope) => {
    const intent = resolveTurnIntent(
      `Audit important problems ${preposition} the ${scope}.`,
    );

    expect(intent).toMatchObject({
      kind: "FORENSIC_AUDIT",
      executionTaskType: "analysis",
      requiresTools: true,
      requiresEvidence: true,
      scopeClarificationRequired: false,
      operationMode: "FORENSIC_AUDIT",
    });
  });

  it.each([
    "تدقيق شامل للمشروع",
    "مراجعة كاملة للمستودع",
    "فحص واسع لقاعدة الكود",
    "دقق في المشروع وابحث عن المشاكل المهمة.",
    "راجع في المستودع وحدد المشاكل.",
    "افحص الريبو بالكامل.",
    "حلل قاعدة الشفرة بالكامل.",
    "تَدْقِيقٌ شَامِلٌ لِلْمَشْرُوعِ",
    "مـراجـعـةٌ كـامـلـةٌ لِلـمُسـتـودَعِ",
    "فَحْصٌ وَاسِعٌ لِقَاعِدَةِ الْكُودِ",
    "دَقِّقْ فِي الْمَشْرُوعِ بِالْكَامِلِ",
  ])("keeps Arabic whole-project audit wording tool-enabled: %s", (message) => {
    const intent = resolveTurnIntent(message);

    expect(intent).toMatchObject({
      kind: "FORENSIC_AUDIT",
      executionTaskType: "analysis",
      requiresTools: true,
      requiresEvidence: true,
      scopeClarificationRequired: false,
      operationMode: "FORENSIC_AUDIT",
    });
  });

  it.each([
    "راجع مشروعي وأخبرني إن كانت هناك مشاكل مهمة.",
    "دقق مشروعي بحثًا عن مشاكل مهمة.",
    "رَاجِعْ مَشْرُوعِي وَأَخْبِرْنِي إِنْ كَانَتْ هُنَاكَ مُشْكِلَاتٌ مُهِمَّةٌ.",
    "دقّقْ مـشْرُوعِي بَحْثًا عَنْ مَشَاكِلَ مُهِمَّةٍ.",
  ])("keeps unscoped Arabic broad reviews on scope consent: %s", (message) => {
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

  it.each([
    "إنشاء ملف tasks.json في جذر المشروع",
    "أنشئ الملف الجديد",
  ])("routes direct mutations through reviewable plan mode: %s", (message) => {
    const intent = resolveTurnIntent(message);

    expect(intent.classification.implementationPlanMode).toBe(true);
    expect(intent.classification.implementationTaskMode).toBe(false);
    expect(intent).toMatchObject({
      kind: "DELIVERY",
      executionTaskType: "chat",
      requiresTools: false,
      requiresEvidence: false,
      allowsBuildHandoff: false,
      operationMode: "DELIVERY",
      compoundWrite: false,
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
    "routes a composed polite modification request through plan mode: %s",
    (message) => {
      const intent = resolveTurnIntent(message);

      expect(intent).toMatchObject({
        kind: "DELIVERY",
        executionTaskType: "chat",
        requiresTools: false,
        requiresEvidence: false,
        allowsBuildHandoff: false,
        operationMode: "DELIVERY",
      });
      expect(intent.classification.implementationPlanMode).toBe(true);
      expect(intent.classification.implementationTaskMode).toBe(false);
    },
  );

  it.each([
    "inspect src/foo.ts and fix the bug",
    "audit src/foo.ts then apply the approved repair plan",
    "تحقق من src/foo.ts ثم أصلح المشكلة",
    "افحص أولًا الملف artifacts/dashboard/src/App.tsx، وبعد اكتمال قراءة المصدر، انتقل إلى مسار inspect → fix وأنشئ تغييرًا معلّقًا للمراجعة فقط",
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

  it("routes a compound validation request without write semantics", () => {
    const message = "verify src/foo.ts then run the tests";

    expect(isCompoundExecutionRequest(message)).toBe(true);
    expect(resolveTurnIntent(message)).toMatchObject({
      kind: "DELIVERY",
      executionTaskType: "task_execution",
      requiresTools: true,
      requiresEvidence: false,
      compoundExecution: true,
      compoundWrite: false,
      phases: ["evidence", "validation"],
    });
    expect(isWriteCapableTurn(resolveTurnIntent(message))).toBe(false);
  });

  it("keeps the provider manifest write-free for validation-only compounds", () => {
    const validationIntent = resolveTurnIntent("verify src/foo.ts then run the tests");
    const writeIntent = resolveTurnIntent("inspect src/foo.ts then fix the bug");
    const buildManifest = (intent: typeof validationIntent) =>
      buildProviderTools(
        "openrouter",
        process.cwd(),
        undefined,
        false,
        false,
        [],
        true,
        false,
        intent.compoundExecution,
        intent.compoundWrite,
      )?.map((tool) => tool.function.name) ?? [];

    const validationTools = buildManifest(validationIntent);
    const writeTools = buildManifest(writeIntent);

    expect(validationTools).toContain("run_validation");
    expect(validationTools).not.toContain("write_file");
    expect(validationTools).not.toContain("replace_text");
    expect(writeTools).toContain("write_file");
    expect(writeTools).toContain("replace_text");
  });

  it.each([
    "Audit src/foo.ts and report the root cause.",
    "راجع src/foo.ts ثم اذكر السبب الجذري فقط",
    "How do I edit settings?",
    "Inspect src/foo.ts and explain how to fix the bug.",
  ])("does not promote read-only or explanatory requests to compound delivery: %s", (message) => {
    expect(isCompoundExecutionRequest(message)).toBe(false);
  });
});