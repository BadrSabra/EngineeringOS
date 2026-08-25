import { describe, expect, it } from "vitest";
import {
  isImmediateExecutionRequest,
  resolveBehaviorAnswerLanguage,
  isReportRegenerationRequest,
  extractPriorRepairPlan,
  extractPriorRepairPlanMetadata,
  extractExecutionFilePaths,
  getRepairPlanExecutionBlockers,
  restrictPendingChangesToRepairPlan,
  isRepairPlanExecutionRequest,
  extractRawForensicReport,
  hasUnverifiedPositiveForensicClaim,
  buildForensicRecoveryMessages,
  classifyRecoveryFailure,
  requiresBehavioralFindingAssessment,
  shouldRejectBehaviorAnswerForMissingEvidence,
  buildBehaviorEvidenceIncompleteResponse,
  isRepeatedConversationQuestion,
  buildResumedEvidenceLedger,
  structuredRecoveryParseDiagnostic,
  type ChatMessage,
} from "../agents/chat-agent.js";

describe("buildBehaviorEvidenceIncompleteResponse", () => {
  it("renders retained reads and an incomplete verdict after an empty provider response", () => {
    const response = buildBehaviorEvidenceIncompleteResponse(
      "ماذا يحدث عند انتهاء المهلة؟",
      new Map([
        ["src/execution-tools.ts", "if (timedOut) return partial;"],
        ["src/provider.ts", "return fallback;"],
      ]),
    );

    expect(response).toContain("ANALYSIS_INCOMPLETE");
    expect(response).toContain("src/execution-tools.ts");
    expect(response).toContain("src/provider.ts");
    expect(response).toContain("لم يُعتمد مقتطف تنفيذي");
    expect(response).not.toContain("FINDING PROVEN");
    expect(response).not.toContain("NO_VERIFIED_FINDING");
  });

  it("does not claim a read when no completed source is retained", () => {
    const response = buildBehaviorEvidenceIncompleteResponse(
      "What happens on timeout?",
      new Map(),
    );

    expect(response).toContain("ANALYSIS_INCOMPLETE");
    expect(response).toContain("No confirmed file read.");
    expect(response).not.toContain("FINDING PROVEN");
  });
});

describe("resolveBehaviorAnswerLanguage", () => {
  it("keeps Arabic behavior answers in Arabic when the question mentions tools", () => {
    expect(
      resolveBehaviorAnswerLanguage(
        "لماذا تتوقف الإجابة عند soft_limit؟ افحص read_file و list_directory.",
        "BEHAVIOR_QUERY",
        false,
      ),
    ).toBe("ar");
  });

  it("does not apply the behavior-answer contract to an execution command", () => {
    expect(
      resolveBehaviorAnswerLanguage("نفذ الإصلاحات باستخدام read_file", "BEHAVIOR_QUERY", true),
    ).toBeUndefined();
  });
});

describe("isImmediateExecutionRequest", () => {
  it.each([
    "نفذ الإصلاحات",
    "نفّذ التعديلات الآن",
    "طبّق الإصلاحات",
    "أصلحها",
    "اكتب ملفات الاختبار المطلوبة وقم بتنفيذها",
    "أنشئ الملف الجديد",
    "ابدأ",
    "ابدأ الآن في تنفيذ الخطة",
    "implement the fix",
    "apply the changes",
    "run the tests",
  ])("recognises direct execution command: %s", (message) => {
    expect(isImmediateExecutionRequest(message)).toBe(true);
  });

  it.each([
    "راجع الإصلاحات المقترحة",
    "كيف يمكن إصلاح المشكلة؟",
    "هل يمكنك شرح التعديل؟",
    "what would you change?",
  ])("does not confuse analysis with immediate execution: %s", (message) => {
    expect(isImmediateExecutionRequest(message)).toBe(false);
  });

  it.each([
    "أعد توليد التقرير",
    "أعد المحاولة",
    "Regenerate the report",
    "Try again",
  ])("keeps report regeneration out of the execution path: %s", (message) => {
    expect(isReportRegenerationRequest(message)).toBe(true);
    expect(isImmediateExecutionRequest(message)).toBe(false);
    expect(isRepairPlanExecutionRequest(message)).toBe(false);
  });
});

describe("isRepeatedConversationQuestion", () => {
  const repeatedQuestion = "ما الفرق بين getImpactedEntities و getShortestPath و getNeighborhood؟";
  const priorAnswer = "تختلف الدوال في نوع استعلام الرسم البياني الذي تنفذه.";

  it("detects a repeated question after a prior assistant answer", () => {
    expect(isRepeatedConversationQuestion([
      { role: "user", content: repeatedQuestion },
      { role: "assistant", content: priorAnswer },
      { role: "user", content: "السؤال التالي" },
    ], repeatedQuestion)).toBe(true);
  });

  it("does not treat the first occurrence or a control-only prompt as repeated", () => {
    expect(isRepeatedConversationQuestion([], repeatedQuestion)).toBe(false);
    expect(isRepeatedConversationQuestion([
      { role: "assistant", content: "ما السؤال الذي تريد طرحه؟" },
    ], "السؤال التالي")).toBe(false);
  });
});

describe("buildResumedEvidenceLedger", () => {
  it("rejects repeated unsupported speculation as progress", () => {
    const ledger = buildResumedEvidenceLedger(
      {
        evidence: { readFiles: ["src/agent.ts"] },
      } as never,
      true,
    );
    expect(ledger).toContain("unsupported possibilities is not progress");
    expect(ledger).toContain("return NOT PROVEN");
  });
});

describe("extractRawForensicReport", () => {
  const sections = [
    "1. Executive Verdict",
    "Verdict text",
    "## 2) Evidence Map",
    "Evidence text",
    "### 3. Findings",
    "Findings text",
    "#### 4. Repair Plan",
    "No repair phases identified.",
    "##### 5) Validation Checklist",
    "Validation text",
    "###### 6) Final Judgment",
    "NOT PROVEN",
  ].join("\n");

  it("recovers six ordered sections from heading variants", () => {
    const report = extractRawForensicReport(`Provider preamble\n${sections}\nProvider tail`);
    expect(report).toContain("## 1) Executive Verdict");
    expect(report).toContain("## 6) Final Judgment");
    expect(report).toContain("No repair phases identified.");
  });

  it("accepts harmless unnumbered and colon-terminated recovery headings", () => {
    const report = extractRawForensicReport([
      "**Executive Verdict:**",
      "NOT PROVEN — no verified defect.",
      "### Evidence Map:",
      "File: `src/example.ts`",
      "## Findings:",
      "No verified finding identified from inspected source code.",
      "### Repair Plan:",
      "No repair phases identified.",
      "## Validation Checklist:",
      "No validation scenario available.",
      "## Final Judgment:",
      "NOT PROVEN.",
    ].join("\n"));

    expect(report).not.toBeNull();
    expect(report).toContain("## 1) Executive Verdict");
    expect(report).toContain("## 6) Final Judgment");
    expect(report).toMatch(/## 1\)[\s\S]*## 2\)[\s\S]*## 3\)[\s\S]*## 4\)[\s\S]*## 5\)[\s\S]*## 6\)/);
  });

  it("recovers six sections whose newlines are JSON-escaped", () => {
    const escaped = sections.replace(/\n/g, "\\n");
    const report = extractRawForensicReport(`{"response":"${escaped}"}`);
    expect(report).toContain("## 1) Executive Verdict");
    expect(report).toContain("## 4) Repair Plan");
    expect(report).toContain("NOT PROVEN");
  });

  it("rejects prose that does not contain all six sections", () => {
    expect(extractRawForensicReport("## 1) Executive Verdict\nonly one section")).toBeNull();
  });
});

describe("hasUnverifiedPositiveForensicClaim", () => {
  it("blocks positive correctness claims when no evidence was accepted", () => {
    expect(
      hasUnverifiedPositiveForensicClaim(
        "تم تأكيد أن نظام التحقق يعمل بشكل صحيح ولا توجد إصلاحات مطلوبة.",
        0,
      ),
    ).toBe(true);
  });

  it("allows the same claim only when behavioral evidence was accepted", () => {
    expect(
      hasUnverifiedPositiveForensicClaim("The verification system works correctly.", 1),
    ).toBe(false);
  });

  it("does not block a neutral incomplete verdict", () => {
    expect(
      hasUnverifiedPositiveForensicClaim(
        "ANALYSIS_INCOMPLETE — no conclusive result was produced.",
        0,
      ),
    ).toBe(false);
  });
});

describe("buildForensicRecoveryMessages", () => {
  it("sends a bounded evidence-only context instead of replaying tool history", () => {
    const evidence = {
      toolSources: ["src/a.ts", "src/b.ts"],
      fileContents: new Map([
        ["src/b.ts", "export const b = " + "x".repeat(12_000)],
        ["src/a.ts", "export const a = true;"],
      ]),
      scope: { roots: ["src"] },
    };
    const messages = buildForensicRecoveryMessages(
      evidence,
      "Return the six-section report as JSON.",
      "x".repeat(20_000),
      "Audit only src/a.ts for a directly proven behavioral defect. Do not use search_code.",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    const serialized = messages
      .map((message) => typeof message.content === "string" ? message.content : "")
      .join("\n");

    expect(serialized).toContain("VERIFIED COMPLETED READ MANIFEST:");
    expect(serialized).toContain("ACTIVE EVIDENCE PACKET SCOPE:");
    expect(serialized).toContain("- src/a.ts");
    expect(serialized).toContain("- src/b.ts");
    expect(serialized).toContain("SOURCE_EXCERPT (bounded; complete read retained by verifier):");
    expect(serialized).toContain("ORIGINAL AUDIT OBJECTIVE (scope only; not source evidence):");
    expect(serialized).toContain("Audit only src/a.ts for a directly proven behavioral defect.");
    expect(serialized).toContain("UNTRUSTED PRIOR CANDIDATE");
    expect(serialized).not.toContain("tool_call_id");
    expect(serialized).not.toContain("x".repeat(20_000));
    expect(serialized.length).toBeLessThan(50_000);
  });

  it("allocates Recovery evidence across the whole manifest instead of starving later files", () => {
    const evidence = {
      toolSources: [],
      fileContents: new Map(
        Array.from({ length: 12 }, (_, index) => [
          `src/file-${String(index).padStart(2, "0")}.ts`,
          `export const file${index} = true;\n${"x".repeat(4_000)}\n// late-marker-${index}`,
        ]),
      ),
      scope: { roots: ["src"] },
    };

    const messages = buildForensicRecoveryMessages(
      evidence,
      "Return the staged Recovery envelope.",
      "",
      "Find a directly proven behavioral defect in src.",
    );
    const serialized = messages
      .map((message) => typeof message.content === "string" ? message.content : "")
      .join("\n");

    for (let index = 0; index < 12; index += 1) {
      expect(serialized).toContain(`FILE: src/file-${String(index).padStart(2, "0")}.ts`);
      expect(serialized).toContain(`// late-marker-${index}`);
    }
    expect(serialized).toContain("Assess every listed file before deciding");
    expect(serialized).toContain("Never emit a Repair Plan without a matching Finding ID");
    expect(serialized.length).toBeLessThan(50_000);
  });
});

describe("requiresBehavioralFindingAssessment", () => {
  it.each([
    "ابحث عن عيب سلوكي مثبت في هذا الملف",
    "اِبْحَثْ عن عَيْبٍ سُلُوكِيٍّ مُثْبَتٍ في هذا الملف",
    "Find a proven behavioral defect in this file",
    "identify the bug in the implementation",
    "find a security vulnerability in this implementation",
  ])("requires an assessed negative basis: %s", (objective) => {
    expect(requiresBehavioralFindingAssessment(objective)).toBe(true);
  });

  it.each([
    "اقرأ الملف كاملًا وسجّل مسار القراءة فقط",
    "Summarize the implementation without judging behavior",
  ])("does not require a defect assessment: %s", (objective) => {
    expect(requiresBehavioralFindingAssessment(objective)).toBe(false);
  });
});

describe("structuredRecoveryParseDiagnostic", () => {
  it("does not report a parse failure for a syntactically valid envelope", () => {
    expect(structuredRecoveryParseDiagnostic({ ok: true }, 1)).toBeNull();
  });

  it("reports the actual parser code only for a failed envelope parse", () => {
    expect(structuredRecoveryParseDiagnostic({ ok: false, code: "MALFORMED_JSON" }, 2)).toEqual({
      code: "FORENSIC_STRUCTURED_RECOVERY_PARSE_FAILED",
      details: [
        "structured envelope parse failed on recovery attempt 2",
        "parse code: MALFORMED_JSON",
      ],
    });
  });
});

describe("extractPriorRepairPlan", () => {
  const auditResponse =
    "## Findings\nF-01: getImpactedEntities drops frontier IDs\n\n## Repair Plan\n1. Fix entityMap filter in queries.ts";

  it("recovers the latest assistant audit message", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "راجع الكود" },
      { role: "assistant", content: auditResponse },
    ];
    expect(extractPriorRepairPlan(history)).toBe(auditResponse);
  });

  it("recovers an Arabic خطة الإصلاح section", () => {
    const arabic = "النتائج:\n- مشكلة في الفلترة\n\nخطة الإصلاح:\n1. تعديل الدالة";
    const history: ChatMessage[] = [{ role: "assistant", content: arabic }];
    expect(extractPriorRepairPlan(history)).toBe(arabic);
  });

  it("skips assistant messages without a plan and user messages", () => {
    const history: ChatMessage[] = [
      { role: "assistant", content: auditResponse },
      { role: "user", content: "Repair Plan? what is that" },
      { role: "assistant", content: "Hello! How can I help?" },
    ];
    expect(extractPriorRepairPlan(history)).toBe(auditResponse);
  });

  it("returns null when no prior plan exists", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello! How can I help?" },
    ];
    expect(extractPriorRepairPlan(history)).toBeNull();
  });

  it("truncates oversized plans keeping the tail", () => {
    const big = "## Findings\n" + "x".repeat(9000) + "\n## Repair Plan\nfix the thing";
    const out = extractPriorRepairPlan([{ role: "assistant", content: big }]);
    expect(out!.length).toBeLessThanOrEqual(6000);
    expect(out!.endsWith("fix the thing")).toBe(true);
  });
});

describe("extractPriorRepairPlanMetadata", () => {
  it("prefers the latest server-verified structured phase list", () => {
    const plan = [{
      findingId: "F-01" as const,
      files: ["lib/ai-orchestrator/src/forensic-recovery.ts"],
      steps: ["Update the structured handoff."],
      validationProfile: "ai-orchestrator-tests" as const,
    }];
    expect(extractPriorRepairPlanMetadata([
      { role: "assistant", content: "old report", repairPlan: plan },
      { role: "assistant", content: "new report", repairPlan: plan },
    ])).toEqual(plan);
  });

  it("returns null for legacy Markdown-only history", () => {
    expect(extractPriorRepairPlanMetadata([
      { role: "assistant", content: "## Repair Plan\nFix `src/known.ts`." },
    ])).toBeNull();
  });
});

describe("extractExecutionFilePaths", () => {
  it("extracts implementation paths from a recovered repair plan", () => {
    const plan = [
      "F-01: update `lib/knowledge-engine/src/inference.ts`.",
      "Phase 2: adjust `lib/ai-orchestrator/src/groq-client.ts` and artifacts/api-server/src/routes/ai/chat.ts.",
      "Do not edit `lib/api-zod/src/generated/api.ts`.",
    ].join("\n");

    expect(extractExecutionFilePaths(plan)).toEqual([
      "lib/knowledge-engine/src/inference.ts",
      "lib/ai-orchestrator/src/groq-client.ts",
      "artifacts/api-server/src/routes/ai/chat.ts",
    ]);
  });

  it("skips generated, dist, and build paths", () => {
    const plan = [
      "`lib/api-zod/src/generated/api.ts`",
      "`dist/index.js`",
      "`build/output.js`",
      "`lib/ai-orchestrator/src/chat-agent.ts`",
    ].join("\n");

    expect(extractExecutionFilePaths(plan)).toEqual([
      "lib/ai-orchestrator/src/chat-agent.ts",
    ]);
  });

  it("extracts only unblocked paths from the Repair Plan", () => {
    const plan = [
      "## 3) Findings",
      "* ID: F-01 · HIGH",
      "* File(s): `src/unverified.ts`",
      "* Evidence: `const unverified = true`",
      "* Why it matters: the unverified branch may be unsafe",
      "* Root cause: missing validation",
      "* Fix: add validation",
      "* ID: F-02 · MEDIUM",
      "* File(s): `src/verified.ts`",
      "* Evidence: `const verified = true`",
      "* Why it matters: the verified branch needs alignment",
      "* Root cause: configuration mismatch",
      "* Fix: align the implementation",
      "## 4) Repair Plan",
      "Phase 1 (F-01): [BLOCKED: F-01 is NOT PROVEN] — `src/unverified.ts`",
      "Phase 2 (F-02): update the verified implementation — `src/verified.ts`",
    ].join("\n");

    expect(extractExecutionFilePaths(plan)).toEqual(["src/verified.ts"]);
  });

  it("extracts both files from the uploaded report's single-line Repair Plan", () => {
    const uploadedRepairPlan =
      "## 3) Findings\n" +
      "ID: F-01 · HIGH\n" +
      "ID: F-02 · HIGH\n" +
      "## 4) Repair Plan\n" +
      "Phase 1 (F-01): Fix tool-execution-engine budget exhaustion logic to validate content before returning partial/exhausted responses — lib/ai-orchestrator/src/tool-execution-engine.ts Phase 2 (F-02): Fix groq-client circuit breaker logic to properly handle transient vs final-call failures — lib/ai-orchestrator/src/groq-client.ts";

    expect(extractExecutionFilePaths(uploadedRepairPlan)).toEqual([
      "lib/ai-orchestrator/src/tool-execution-engine.ts",
      "lib/ai-orchestrator/src/groq-client.ts",
    ]);
  });

  it("extracts actionable Batch and Split phases from the dashboard report", () => {
    const dashboardReport =
      "## 3) Findings\n" +
      "ID: F-01 · HIGH\n" +
      "ID: F-02 · HIGH\n" +
      "## 4) Repair Plan\n" +
      "Phase 1 (F-01): Batch graph relationship queries to eliminate per-depth database calls — lib/knowledge-engine/src/queries.ts " +
      "Phase 2 (F-02): Split monolithic orchestrator exports into focused submodules — lib/ai-orchestrator/src/index.ts";

    expect(extractExecutionFilePaths(dashboardReport)).toEqual([
      "lib/knowledge-engine/src/queries.ts",
      "lib/ai-orchestrator/src/index.ts",
    ]);
  });

  it("recognises an unnumbered Repair Plan heading from the dashboard report", () => {
    const plan = [
      "## 3) Findings",
      "ID: F-01 · HIGH",
      "ID: F-02 · HIGH",
      "4) Repair Plan",
      "Phase 1 (F-01): Verify provenance edge cases — `lib/knowledge-engine/src/queries.ts`",
      "Phase 2 (F-02): Update semantic filtering — `lib/knowledge-engine/src/queries.ts`",
    ].join("\n");

    expect(extractExecutionFilePaths(plan)).toEqual(["lib/knowledge-engine/src/queries.ts"]);
  });

  it("does not extract Evidence Map or Findings paths for a validation-only plan", () => {
    const plan = [
      "## 2) Evidence Map",
      "File: `lib/knowledge-engine/src/queries.ts`",
      "## 3) Findings",
      "File(s): `lib/ai-orchestrator/src/index.ts`",
      "4) Repair Plan",
      "Phase 1 (F-01): Verify provenance edge cases — `lib/knowledge-engine/src/queries.ts`",
      "Phase 2 (F-02): Test semantic tags — `lib/knowledge-engine/src/queries.test.ts`",
    ].join("\n");

    expect(extractExecutionFilePaths(plan)).toEqual([]);
  });

  it("does not turn wildcard investigation phases into executable file targets", () => {
    const unsupportedPlan = [
      "4) Repair Plan",
      "Phase 1 (F-01): Investigate error handling patterns in lib/ai-orchestrator/src/ source files — lib/ai-orchestrator/src/*.ts",
      "Phase 2 (F-02): Add comprehensive error handling if missing — lib/ai-orchestrator/src/*.ts",
    ].join("\n");

    expect(extractExecutionFilePaths(unsupportedPlan)).toEqual([]);
  });

  it("blocks a forensic report whose validation and judgment are still placeholders", () => {
    const uploadedReport = [
      "## 3) Findings",
      "ID: F-01 · HIGH",
      "Fix: Implement stricter path canonicalization",
      "## 4) Repair Plan",
      "Phase 1 (F-01): Implement stricter path canonicalization in git-tools.ts — `lib/ai-orchestrator/src/tools/git-tools.ts`",
      "Phase 2 (F-02): Add atomic circuit state operations — `lib/ai-orchestrator/src/groq-client.ts`",
      "## 5) Validation Checklist",
      "- [pass/fail test scenario for F-01]",
      "- [pass/fail test scenario for F-02]",
      "## 6) Final Judgment",
      "Patch صغير / Refactor / إعادة تصميم — [exact code reference needed]",
    ].join("\n");

    expect(extractExecutionFilePaths(uploadedReport)).toEqual([]);
    expect(getRepairPlanExecutionBlockers(uploadedReport)).toEqual([
      "Validation Checklist contains a placeholder scenario, not an actual pass/fail result.",
      "Final Judgment still contains an unresolved code-reference placeholder.",
      "Final Judgment still contains an unresolved patch-scope choice.",
    ]);
  });

  it("allows an executable plan after concrete validation replaces placeholders", () => {
    const verifiedPlan = [
      "## 3) Findings",
      "ID: F-01 · HIGH",
      "## 4) Repair Plan",
      "Phase 1 (F-01): Update the verified guard — `lib/ai-orchestrator/src/tools/git-tools.ts`",
      "## 5) Validation Checklist",
      "- PASS: `git_diff` rejects `../../outside.txt` with the project-root error.",
      "## 6) Final Judgment",
      "Patch صغير — the containment guard in git-tools.ts rejects escaped paths.",
    ].join("\n");

    expect(extractExecutionFilePaths(verifiedPlan)).toEqual([
      "lib/ai-orchestrator/src/tools/git-tools.ts",
    ]);
  });
});

describe("isRepairPlanExecutionRequest", () => {
  it("recognises direct Repair Plan handoff commands", () => {
    expect(isRepairPlanExecutionRequest("نفذ Repair Plan")).toBe(true);
    expect(isRepairPlanExecutionRequest("نفذ الإصلاحات")).toBe(true);
    expect(isRepairPlanExecutionRequest("ابدأ")).toBe(true);
    expect(isRepairPlanExecutionRequest("apply the repair plan")).toBe(true);
  });

  it("does not classify an unrelated execution request as a Repair Plan handoff", () => {
    expect(isRepairPlanExecutionRequest("run the tests")).toBe(false);
  });
});

describe("restrictPendingChangesToRepairPlan", () => {
  const change = (filePath: string) => ({
    path: filePath,
    absolutePath: `/project/${filePath}`,
    newContent: "updated",
    originalContent: "original",
    reason: "verified repair",
  });

  it("keeps only changes whose paths appear in executable phases", () => {
    expect(
      restrictPendingChangesToRepairPlan(
        [change("lib/ai-orchestrator/src/tool-execution-engine.ts"), change("lib/ai-orchestrator/src/tools/git-tools.ts")],
        ["lib/ai-orchestrator/src/tool-execution-engine.ts"],
      ).map((item) => item.path),
    ).toEqual(["lib/ai-orchestrator/src/tool-execution-engine.ts"]);
  });

  it("normalizes slash and dot-path differences without allowing unrelated files", () => {
    expect(
      restrictPendingChangesToRepairPlan(
        [change("./src/fix.ts"), change("src/other.ts")],
        ["src/fix.ts"],
      ).map((item) => item.path),
    ).toEqual(["./src/fix.ts"]);
  });

  it("returns no changes when the recovered plan has no executable paths", () => {
    expect(restrictPendingChangesToRepairPlan([change("src/fix.ts")], [])).toEqual([]);
  });
});

describe("classifyRecoveryFailure", () => {
  it("returns undefined when there is no terminal failure", () => {
    expect(classifyRecoveryFailure(undefined)).toBeUndefined();
  });

  it("classifies a malformed candidate as PARSE_FAILURE", () => {
    expect(classifyRecoveryFailure({ kind: "parse", parseCode: "NOT_FOUND" })).toBe("PARSE_FAILURE");
  });

  it("classifies a provider timeout distinctly from a generic provider failure", () => {
    expect(classifyRecoveryFailure({ kind: "provider", code: "TIMEOUT" })).toBe("TIMEOUT");
    expect(classifyRecoveryFailure({ kind: "provider", code: "RATE_LIMIT" })).toBe("PROVIDER_FAILURE");
  });

  it("classifies a behavioural no-finding outcome as EVIDENCE_FAILURE", () => {
    expect(classifyRecoveryFailure({ kind: "no_finding" })).toBe("EVIDENCE_FAILURE");
  });

  it("classifies a contract violation as VALIDATION_FAILURE", () => {
    expect(
      classifyRecoveryFailure({ kind: "contract", violations: ["missing field"] }),
    ).toBe("VALIDATION_FAILURE");
  });
});

describe("shouldRejectBehaviorAnswerForMissingEvidence", () => {
  it("is never a failure when an explicit behavior query has any source evidence", () => {
    // A grounded answer (source evidence linked) is returned regardless of
    // whether a defect Finding was proven — BEHAVIOR_QUERY is not defect-prove mode.
    const grounded = [
      {
        source: "src/loop.ts",
        excerpt: "if (maxIterations >= 20) return exhausted;",
        supportsClaim: true,
        relevance: 0.9,
        directness: "DIRECT",
        sourceType: "IMPLEMENTATION",
        productionReachability: "NOT_PROVEN",
        evidenceClass: "BEHAVIOR_PROVEN",
      },
    ] as const;
    expect(
      shouldRejectBehaviorAnswerForMissingEvidence(true, grounded),
    ).toBe(false);
  });

  it("treats source evidence that does not reach BEHAVIOR_PROVEN as still grounded", () => {
    // READ_CONFIRMED evidence exists but no Finding is proven — this must not
    // fail the behavior answer, only a truly evidence-less one must.
    const readOnly = [
      {
        source: "src/loop.ts",
        excerpt: "DEFAULT_MAX_ITERATIONS = 30",
        supportsClaim: false,
        relevance: 0.5,
        directness: "INDIRECT",
        sourceType: "IMPLEMENTATION",
        productionReachability: "NOT_PROVEN",
        evidenceClass: "READ_CONFIRMED",
      },
    ] as const;
    expect(shouldRejectBehaviorAnswerForMissingEvidence(true, readOnly)).toBe(false);
  });

  it("rejects only when the answer has zero supporting source evidence", () => {
    expect(shouldRejectBehaviorAnswerForMissingEvidence(true, [])).toBe(true);
  });

  it("never rejects outside the behavior-evidence gate", () => {
    // Gate not active (e.g. summary/implementation task): no rejection decision.
    expect(shouldRejectBehaviorAnswerForMissingEvidence(false, [])).toBe(false);
  });
});
