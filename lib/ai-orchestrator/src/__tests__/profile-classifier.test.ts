import { describe, expect, it } from "vitest";
import {
  extractOrderedForensicRoots,
  classifyRequest,
  isLowRiskChatQuestion,
  isProjectOrientationQuestion,
} from "../prompts/profile-classifier.js";

describe("classifyRequest — simple greetings", () => {
  it.each(["مرحبا", "مرحباً", "hello", "Hi"])("keeps %s on the simple chat profile", (message) => {
    const result = classifyRequest(message);

    expect(result.category).toBe("simple");
    expect(result.structuredOutputMode).toBe(false);
    expect(result.singleFileForensicMode).toBe(false);
    expect(result.orderedForensicRoots).toEqual([]);
  });
});

describe("classifyRequest — ordinary orientation questions", () => {
  it.each([
    "ما هذا المشروع؟",
    "ممكن تساعدني أفهم المشروع؟",
    "أشرح المشروع بصورة مبسطة",
    "What is this project?",
  ])("keeps %s on the fast chat profile", (message) => {
    const result = classifyRequest(message);

    expect(isProjectOrientationQuestion(message)).toBe(true);
    expect(isLowRiskChatQuestion(message)).toBe(false);
    expect(result.category).toBe("simple");
    expect(result.allowPrefetch).toBe(false);
    expect(result.orderedForensicRoots).toEqual([]);
    expect(result.structuredOutputMode).toBe(false);
  });

  it.each([
    "ما اسم المشروع؟",
  ])("keeps a factual name question %s outside orientation mode", (message) => {
    expect(isProjectOrientationQuestion(message)).toBe(false);
  });

  it("routes a broad Arabic architecture brief through source-backed orientation", () => {
    const message =
      "اشرح لي المعمارية الشاملة لمشروع EngineeringOS مع Dashboard وAuthentication وProject Discovery وKnowledge Graph وAI Execution وGovernance، وكل مسارات /api وملفات الإثبات والاستشهادات";
    const result = classifyRequest(message);

    expect(isProjectOrientationQuestion(message)).toBe(true);
    expect(result.category).toBe("simple");
    expect(result.projectTarget).toBeUndefined();
    expect(result.projectTargetResolution).toBe("not_applicable");
    expect(result.allowPrefetch).toBe(false);
    expect(result.structuredOutputMode).toBe(false);
    expect(result.orderedForensicRoots).toEqual([]);
  });

  it("recognizes the historical broad brief from user and internal-component framing", () => {
    const message =
      "اشرح EngineeringOS كاملًا من منظور المستخدم والمكونات الداخلية، واشمل Dashboard وAuthentication وProject Discovery وKnowledge Graph وAI Execution وGovernance، مع ذكر المسارات العامة كاملة ببادئة /api والاستشهاد بالملفات التي تثبت كل جزء.";
    const result = classifyRequest(message);

    expect(isProjectOrientationQuestion(message)).toBe(true);
    expect(result.category).toBe("simple");
    expect(result.projectTarget).toBeUndefined();
    expect(result.projectTargetResolution).toBe("not_applicable");
    expect(result.allowPrefetch).toBe(false);
    expect(result.structuredOutputMode).toBe(false);
    expect(result.orderedForensicRoots).toEqual([]);
  });

  it("does not classify a broad architecture audit as orientation", () => {
    const message =
      "دقّق معماريًا في مشروع EngineeringOS واكتشف فجوات Dashboard وAuthentication وحدد الأسباب الجذرية";
    expect(isProjectOrientationQuestion(message)).toBe(false);
    expect(classifyRequest(message).taskType).not.toBe("BEHAVIOR_QUERY");
  });

  it.each([
    "What is the project status?",
    "هل المشروع شغال حاليًا؟",
  ])("routes project status question %s through orientation mode", (message) => {
    const result = classifyRequest(message);

    expect(isProjectOrientationQuestion(message)).toBe(true);
    expect(result.category).toBe("simple");
    expect(result.allowPrefetch).toBe(false);
    expect(result.structuredOutputMode).toBe(false);
  });

  it.each([
    "ممكن تساعدني؟",
    "كيف أبدأ؟",
    "Can you help me?",
    "How do I start?",
  ])("keeps generic question %s separate from project orientation", (message) => {
    expect(isLowRiskChatQuestion(message)).toBe(true);
    expect(isProjectOrientationQuestion(message)).toBe(false);
  });

  it("does not downgrade an explicit forensic request", () => {
    const result = classifyRequest("افحص الكود الفعلي واكتشف الفجوات");

    expect(isLowRiskChatQuestion("افحص الكود الفعلي واكتشف الفجوات")).toBe(false);
    expect(result.taskType).toBe("FULL_FORENSIC_AUDIT");
    expect(result.structuredOutputMode).toBe(true);
  });
});

describe("classifyRequest — broad forensic requests bootstrap source discovery", () => {
  it("assigns the project root when a full audit names no directory", () => {
    const result = classifyRequest("تحقق من الكود الفعلي واكتشف الفجوات وحدد الأسباب الجذرية");

    expect(result.taskType).toBe("FULL_FORENSIC_AUDIT");
    expect(result.orderedForensicRoots).toEqual(["."]);
    expect(result.structuredOutputMode).toBe(true);
  });

  it("assigns the project root for an English whole-workspace review without paths", () => {
    const result = classifyRequest("Review the entire repository and identify the root causes");

    expect(result.taskType).toBe("WORKSPACE_REVIEW");
    expect(result.orderedForensicRoots).toEqual(["."]);
    expect(result.structuredOutputMode).toBe(true);
  });

  it("preserves explicitly ordered roots", () => {
    const result = classifyRequest("Audit lib/ai-orchestrator and artifacts/api-server");

    expect(result.orderedForensicRoots).not.toContain(".");
  });
});

// ─── extractOrderedForensicRoots ─────────────────────────────────────────────

describe("extractOrderedForensicRoots — prose pseudo-path rejection", () => {
  it("does not extract pass/fail as a root", () => {
    const roots = extractOrderedForensicRoots(
      "Audit lib/ai-orchestrator and lib/knowledge-engine. Each test should report pass/fail.",
    );
    expect(roots).not.toContain("pass/fail");
  });

  it("does not extract yes/no as a root", () => {
    const roots = extractOrderedForensicRoots(
      "Scan packages/core — answer yes/no for each finding.",
    );
    expect(roots).not.toContain("yes/no");
  });

  it("does not extract true/false as a root", () => {
    const roots = extractOrderedForensicRoots(
      "Forensic audit of src/services. Return true/false for each claim.",
    );
    expect(roots).not.toContain("true/false");
  });

  it("does not extract and/or as a root", () => {
    const roots = extractOrderedForensicRoots(
      "Audit lib/db and/or lib/api and confirm the findings.",
    );
    expect(roots).not.toContain("and/or");
  });

  // ── Legitimate directory names must NOT be rejected ──────────────────────

  it("preserves client/server as a root when that is the requested folder", () => {
    const roots = extractOrderedForensicRoots(
      "Forensic audit of the client/server directory.",
    );
    expect(roots).toContain("client/server");
  });

  it("preserves read/write as a root when that is the requested folder", () => {
    const roots = extractOrderedForensicRoots(
      "Scan packages/db read/write permission layer.",
    );
    expect(roots).toContain("read/write");
  });

  it("preserves request/response as a root when that is the requested folder", () => {
    const roots = extractOrderedForensicRoots(
      "Forensic audit of the request/response module.",
    );
    expect(roots).toContain("request/response");
  });

  it("preserves get/set as a root when that is the requested folder", () => {
    const roots = extractOrderedForensicRoots(
      "Audit lib/accessors get/set directory.",
    );
    expect(roots).toContain("get/set");
  });

  it("preserves before/after as a root when that is the requested folder", () => {
    const roots = extractOrderedForensicRoots(
      "Inspect the before/after snapshot directory.",
    );
    expect(roots).toContain("before/after");
  });

  it("still extracts real directory paths alongside prose pairs", () => {
    const roots = extractOrderedForensicRoots(
      "Audit lib/ai-orchestrator and lib/knowledge-engine. Each test should report pass/fail.",
    );
    expect(roots).toContain("lib/ai-orchestrator");
    expect(roots).toContain("lib/knowledge-engine");
    expect(roots).not.toContain("pass/fail");
  });

  it("extracts a single real root when accompanied by prose pairs", () => {
    const roots = extractOrderedForensicRoots(
      "Forensic audit of packages/core. Mark each finding yes/no.",
    );
    expect(roots).toContain("packages/core");
    expect(roots).not.toContain("yes/no");
  });

  it("handles mixed-case prose pairs", () => {
    const roots = extractOrderedForensicRoots(
      "Scan lib/services — each claim is Pass/Fail or True/False.",
    );
    expect(roots).not.toContain("Pass/Fail");
    expect(roots).not.toContain("True/False");
  });

  it("preserves deep real paths that contain no prose words", () => {
    const roots = extractOrderedForensicRoots(
      "Audit lib/ai-orchestrator/src/agents and lib/ai-orchestrator/src/prompts in this order.",
    );
    expect(roots).toContain("lib/ai-orchestrator/src/agents");
    expect(roots).toContain("lib/ai-orchestrator/src/prompts");
  });

  // get/set and before/after are plausible directory names — must be preserved
  it("preserves get/set alongside a real root (not rejected as prose)", () => {
    const roots = extractOrderedForensicRoots(
      "Audit lib/api — all get/set accessors must have evidence.",
    );
    // get/set may appear; it must not suppress the real root
    expect(roots).toContain("lib/api");
  });

  it("preserves before/after alongside a real root (not rejected as prose)", () => {
    const roots = extractOrderedForensicRoots(
      "Compare before/after states in packages/core.",
    );
    // before/after may appear; it must not suppress the real root
    expect(roots).toContain("packages/core");
  });
});

// ─── classifyRequest — orderedForensicRoots integration ──────────────────────

describe("classifyRequest — orderedForensicRoots excludes prose pseudo-paths", () => {
  it("does not include pass/fail in orderedForensicRoots", () => {
    // "folder" triggers directoryIntent so detectOrderedForensicRoots fires.
    const result = classifyRequest(
      "Forensic audit of the lib/ai-orchestrator folder and lib/knowledge-engine folder. " +
      "The Validation Checklist must mark each item pass/fail.",
    );
    expect(result.orderedForensicRoots).not.toContain("pass/fail");
    expect(result.orderedForensicRoots).toContain("lib/ai-orchestrator");
    expect(result.orderedForensicRoots).toContain("lib/knowledge-engine");
  });

  it("produces an empty orderedForensicRoots when the only slash-pair is prose", () => {
    // Only "pass/fail" appears — no real directory paths.  After the prose
    // filter rejects it, roots.length === 0 so detectOrderedForensicRoots → [].
    const result = classifyRequest(
      "Audit this module folder. Mark every test pass/fail.",
    );
    expect(result.orderedForensicRoots).toHaveLength(0);
  });

  it("does not include yes/no or true/false in orderedForensicRoots", () => {
    // "packages" in "packages/api" triggers directoryIntent (\bpackages\b matches).
    const result = classifyRequest(
      "Forensic audit of packages/api — answer yes/no and true/false for each finding.",
    );
    expect(result.orderedForensicRoots).not.toContain("yes/no");
    expect(result.orderedForensicRoots).not.toContain("true/false");
    expect(result.orderedForensicRoots).toContain("packages/api");
  });

  it("keeps forensic-report template prose out of orderedForensicRoots", () => {
    // Regression for FIRST_EVIDENCE_UNAVAILABLE: a single-file Behavioral
    // Verdict request also contained report-section labels ("defect/repair",
    // "Finding/Repair") in its prose. These were parsed as root directories and
    // formed a restricting scope that dropped the named file at admissibility.
    const result = classifyRequest(
      "Behavioral Verdict test. Inspect only lib/ai-orchestrator/src/agent-complete.ts. " +
      "The system MUST NOT reject merely because there is no defect/repair finding. " +
      "It must not require a Finding/Repair Plan for this behavioral question.",
    );
    expect(result.orderedForensicRoots).not.toContain("defect/repair");
    expect(result.orderedForensicRoots).not.toContain("Finding/Repair");
    expect(result.orderedForensicRoots).not.toContain("finding/repair");
    // No real directory root is named either — only the single source file —
    // so the ordered-roots manifest stays empty (no restricting scope forms).
    expect(result.orderedForensicRoots).toHaveLength(0);
  });

  it("does not treat ability-probe score/label slash-pairs as roots", () => {
    // A capability probe says "X/5 capabilities demonstrated" and labels its
    // sub-sections "line/location" / "symbol/pattern". These are metric and
    // report-prose slash-pairs, not directory roots — they must not form a
    // restricting ordered scope that derails the single-file audit.
    const result = classifyRequest(
      "Mark the verdict X/5 capabilities demonstrated. Name the line/location and the symbol/pattern for each claim.",
    );
    expect(result.orderedForensicRoots).not.toContain("X/5");
    expect(result.orderedForensicRoots).not.toContain("line/location");
    expect(result.orderedForensicRoots).not.toContain("symbol/pattern");
    expect(result.orderedForensicRoots).toHaveLength(0);
  });

  it("subordinates ordered roots to single-file mode so probes read exactly the named files", () => {
    // Regression for ORDERED_FORENSIC_ROOT_BLOCKED: a single-file capability
    // probe (with "Inspect ONLY these two files" + "X/5 capabilities") was
    // simultaneously classified with junk orderedForensicRoots parsed from its
    // output-format prose. Single-file mode is the stricter contract (exact
    // named files, read-only) and must win: no ordered roots should gate it.
    const result = classifyRequest(
      "AI Model Capability Probe. Inspect ONLY these two files: " +
      "lib/ai-orchestrator/src/prompts/profile-classifier.ts and " +
      "lib/ai-orchestrator/src/tools/file-tools.ts. " +
      "Do not broaden the investigation. End with X/5 capabilities demonstrated.",
    );
    expect(result.singleFileForensicMode).toBe(true);
    expect(result.orderedForensicRoots).toHaveLength(0);
    expect(result.structuredOutputMode).toBe(true);
  });
});

describe("classifyRequest — implementation tasks do not enter forensic mode", () => {
  it("keeps a forensic test task on the implementation path", () => {
    const result = classifyRequest(
      [
        "You are working on Task #61 — Confirm live tool-call events reach the streaming bubble.",
        "Done looks like: add tests in chat-sse.test.ts and use-ai-chat-stream.test.ts.",
        "Run the targeted tests and TypeScript validation. Do not summarize Task #53.",
        "The task covers forensic_status, tool_call, tool_result, model_call, thinking, synthesis_start, and execution_guard.",
      ].join("\n"),
    );

    expect(result.implementationTaskMode).toBe(true);
    expect(result.structuredOutputMode).toBe(false);
    expect(result.singleFileForensicMode).toBe(false);
    expect(result.orderedForensicRoots).toHaveLength(0);
    expect(result.analysisMode).toBe("STANDARD");
    expect(result.outputContract).toBe("GENERIC_RESPONSE");
  });

  it("keeps a real forensic audit in structured mode", () => {
    const result = classifyRequest(
      "Perform a forensic audit of lib/ai-orchestrator and produce the required Findings Matrix with direct evidence.",
    );

    expect(result.implementationTaskMode).toBe(false);
    expect(result.structuredOutputMode).toBe(true);
    expect(result.taskType).toBe("FULL_FORENSIC_AUDIT");
    expect(result.outputContract).toBe("FORENSIC_REPORT");
  });

  it("keeps UX planning out of REPAIR_ANALYSIS and forensic mode", () => {
    const result = classifyRequest("وضع خطة تنفيذية لتحسين تجربة المستخدم");

    expect(result.implementationPlanMode).toBe(true);
    expect(result.implementationTaskMode).toBe(false);
    expect(result.structuredOutputMode).toBe(false);
    expect(result.analysisMode).toBe("STANDARD");
    expect(result.taskType).toBe("BEHAVIOR_QUERY");
    expect(result.outputContract).toBe("GENERIC_RESPONSE");
  });

  it("routes an implementation roadmap to plan mode instead of forensic analysis", () => {
    const result = classifyRequest("Create an implementation plan to build the project activity timeline dashboard.");

    expect(result.implementationPlanMode).toBe(true);
    expect(result.implementationTaskMode).toBe(false);
    expect(result.structuredOutputMode).toBe(false);
    expect(result.analysisMode).toBe("STANDARD");
    expect(result.outputContract).toBe("GENERIC_RESPONSE");
  });
});

describe("classifyRequest — task-aware output contracts", () => {
  it("routes branch/code-only requests to extraction without a forensic report", () => {
    const result = classifyRequest("Extract Branch A and Branch B only from executeToolLoop.");
    expect(result.taskType).toBe("CODE_EXTRACTION");
    expect(result.analysisMode).toBe("STANDARD");
    expect(result.outputContract).toBe("EXTRACTED_CODE");
  });

  it("routes behavior questions to AnswerValidator semantics", () => {
    const result = classifyRequest("Does maxIterations always lead to exhausted?");
    expect(result.taskType).toBe("BEHAVIOR_QUERY");
    expect(result.analysisMode).toBe("STANDARD");
    expect(result.outputContract).toBe("BEHAVIOR_ANSWER");
  });

  it("does not classify a behavior question as a finding without defect intent", () => {
    const result = classifyRequest("What happens when maxIterations is reached?");
    expect(result.taskType).toBe("BEHAVIOR_QUERY");
    expect(result.outputContract).not.toBe("FINDING_ANALYSIS");
  });

  it("routes explicit defect analysis to FindingValidator", () => {
    const result = classifyRequest("Find and prove any behavioral defect in executeToolLoop.");
    expect(result.taskType).toBe("FINDING_ANALYSIS");
    expect(result.outputContract).toBe("FINDING_ANALYSIS");
  });

  it("routes repair requests to RepairValidator", () => {
    const result = classifyRequest("Create a repair plan for the proven defect.");
    expect(result.taskType).toBe("REPAIR_ANALYSIS");
    expect(result.outputContract).toBe("REPAIR_PLAN");
  });

  it("does not force an open Arabic implementation plan into BEHAVIOR_QUERY", () => {
    const result = classifyRequest("ضع خطة تنفيذية للإصلاح");
    expect(result.taskType).toBe("REPAIR_ANALYSIS");
    expect(result.analysisMode).toBe("FORENSIC");
    expect(result.outputContract).toBe("REPAIR_PLAN");
  });

  it("routes Arabic repair wording without the definite article to RepairValidator", () => {
    for (const message of [
      "اصلاح الفجوات الحالية",
      "ضع خطة اصلاح",
      "لقد طلبت وضع خطة اصلاح لهذا",
    ]) {
      const result = classifyRequest(message);
      expect(result.taskType, message).toBe("REPAIR_ANALYSIS");
      expect(result.analysisMode, message).toBe("FORENSIC");
      expect(result.outputContract, message).toBe("REPAIR_PLAN");
    }
  });

  it("routes an open AI-layer gap search to the forensic report contract", () => {
    const result = classifyRequest("ابحث عن الفجوات في طبقة الذكاء الاصطناعي");
    expect(result.taskType).toBe("FULL_FORENSIC_AUDIT");
    expect(result.analysisMode).toBe("FORENSIC");
    expect(result.outputContract).toBe("FORENSIC_REPORT");
  });

  it("routes broad Arabic agent-problem discovery to the forensic report contract", () => {
    const result = classifyRequest(
      "اكتشف المشاكل التى تظهر عند استخدام وكيل الذكاء الاصطناعي المدمج داخل المشروع",
    );
    expect(result.taskType).toBe("FULL_FORENSIC_AUDIT");
    expect(result.analysisMode).toBe("FORENSIC");
    expect(result.outputContract).toBe("FORENSIC_REPORT");
  });

  it("routes broad instruction-compliance questions to the forensic report contract", () => {
    for (const message of [
      "لماذا لا يلتزم النموذج بالتعليمات",
      "لماذا لا يلتزم النموذج الداخلى للمشروع بالتعليمات التى يرسلها المستخدم",
      "Why doesn't the model follow the user's instructions?",
    ]) {
      const result = classifyRequest(message);
      expect(result.taskType, message).toBe("FULL_FORENSIC_AUDIT");
      expect(result.analysisMode, message).toBe("FORENSIC");
      expect(result.outputContract, message).toBe("FORENSIC_REPORT");
    }
  });

  it("routes report regeneration requests to the forensic report contract", () => {
    for (const message of [
      "أعد توليد التقرير",
      "أعد المحاولة",
      "Regenerate the report",
      "Try again",
    ]) {
      const result = classifyRequest(message);
      expect(result.taskType, message).toBe("FULL_FORENSIC_AUDIT");
      expect(result.analysisMode, message).toBe("FORENSIC");
      expect(result.outputContract, message).toBe("FORENSIC_REPORT");
    }
  });

  it("routes investigation continuations to the forensic report contract", () => {
    for (const message of [
      "أكمل التحقيق",
      "استكمل التحليل",
      "Continue the investigation",
      "Resume the audit",
    ]) {
      const result = classifyRequest(message);
      expect(result.taskType, message).toBe("FULL_FORENSIC_AUDIT");
      expect(result.analysisMode, message).toBe("FORENSIC");
      expect(result.outputContract, message).toBe("FORENSIC_REPORT");
    }
  });
});

// ─── classifyRequest — exploration fast path ──────────────────────────────────

describe("classifyRequest — exploration (English)", () => {
  it.each([
    "Explain how the auth middleware works",
    "How does the query planner work?",
    "Why is the evidence gate designed this way?",
    "What is the purpose of the turn-intent resolver?",
    "Give me an overview of the session memory system",
    "Walk me through the forensic recovery flow",
  ])("routes %s to exploration", (message) => {
    const result = classifyRequest(message);
    expect(result.category).toBe("exploration");
    expect(result.contextProfile).toBe("chat-normal");
    expect(result.allowPrefetch).toBe(false);
    expect(result.structuredOutputMode).toBe(false);
    expect(result.orderedForensicRoots).toEqual([]);
  });

  it.each([
    // Note: messages containing the literal word "architecture" score 3 for that
    // category; use subject-neutral phrasing so exploration (weight 3) can win.
    "What are the main challenges with the current session system?",
    "What are the key differences between the two provider clients?",
  ])("routes coverage/challenge question %s to exploration", (message) => {
    const result = classifyRequest(message);
    expect(result.category).toBe("exploration");
  });
});

describe("classifyRequest — exploration (Arabic)", () => {
  it.each([
    "اشرح كيف يعمل نظام الذاكرة",
    // "كيف يعمل X؟" alone can be caught by the project-orientation early return
    // (classifyRequest returns 'simple' before scoring). Use a fuller phrasing
    // that pairs "كيف يعمل" with a clear subject so it bypasses that gate.
    "أشرح لي كيف يعمل نظام تخزين الجلسات",
    "لماذا تم تصميم بوابة الأدلة بهذه الطريقة؟",
    "ما أهمية دورة حياة الجلسة؟",
    "أعطني نظرة عامة على نظام الاستعادة",
    "نظرة عامة على بنية المشروع",
  ])("routes Arabic question %s to exploration", (message) => {
    const result = classifyRequest(message);
    expect(result.category).toBe("exploration");
    expect(result.contextProfile).toBe("chat-normal");
    expect(result.allowPrefetch).toBe(false);
    expect(result.structuredOutputMode).toBe(false);
    expect(result.orderedForensicRoots).toEqual([]);
  });
});

describe("classifyRequest — forensic/audit signals override exploration", () => {
  it.each([
    "Investigate how the auth token is actually validated in production",
    "Audit the forensic recovery module and find the root causes",
    "Verify that the evidence gate rejects truncated reads",
    "تحقق من الكود الفعلي واكتشف الفجوات",
  ])("keeps pure forensic message %s out of exploration", (message) => {
    const result = classifyRequest(message);
    expect(result.category).not.toBe("exploration");
  });

  // Mixed-signal messages: forensic keyword (weight 5) must beat exploration
  // (weight 4) so mixed prompts like "audit + explain" stay in deep_analysis.
  it.each([
    "Audit and explain how the auth middleware works",
    "Investigate and explain how the auth token is validated in production",
    "Investigate and give me an overview of the recovery system",
    "Explain how the auth middleware fails in production",
    "Explain how the session handler crashes under load",
  ])("keeps mixed English forensic+conceptual message in deep_analysis: %s", (message) => {
    const result = classifyRequest(message);
    expect(result.category).toBe("deep_analysis");
  });

  it.each([
    // تدقيق = audit (weight 5); must beat Arabic نظرة عامة exploration (weight 4)
    "تدقيق: أعطني نظرة عامة على نظام الاستعادة",
    // استقصاء = investigation (weight 5); must beat Arabic اشرح كيف exploration (weight 4)
    "استقصاء: اشرح كيف يعمل نظام الذاكرة",
  ])("keeps mixed Arabic forensic+conceptual message in deep_analysis: %s", (message) => {
    const result = classifyRequest(message);
    expect(result.category).toBe("deep_analysis");
  });
});

describe("classifyRequest — greetings remain simple regardless of exploration patterns", () => {
  it.each(["hello", "hi", "مرحبا", "مرحباً"])("keeps greeting %s as simple", (message) => {
    const result = classifyRequest(message);
    expect(result.category).toBe("simple");
  });
});
