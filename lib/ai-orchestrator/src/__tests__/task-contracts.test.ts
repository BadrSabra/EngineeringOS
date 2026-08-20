import { describe, expect, it } from "vitest";
import {
  BehaviorAnswerSchema,
  buildSemanticBehaviorAnswer,
  capBudgetForTask,
  classifyForensicTask,
  CodeExtractionSchema,
  FindingAnalysisSchema,
  ForensicTaskTypeSchema,
  getTaskOutputContract,
  RepairAnalysisSchema,
  routeTask,
  extractQuestionCoverage,
  SemanticBehaviorAnswerSchema,
  validateBehaviorEvidence,
  validateTaskResponse,
  isProductionReachabilityRequest,
} from "../task-contracts.js";

describe("task-aware contracts", () => {
  it("keeps the six task types explicit", () => {
    expect(ForensicTaskTypeSchema.options).toEqual([
      "BEHAVIOR_QUERY",
      "CODE_EXTRACTION",
      "FINDING_ANALYSIS",
      "FULL_FORENSIC_AUDIT",
      "WORKSPACE_REVIEW",
      "REPAIR_ANALYSIS",
    ]);
  });

  it("assigns a task-specific validator without touching provider selection", () => {
    expect(routeTask("BEHAVIOR_QUERY")).toMatchObject({
      outputContract: "BEHAVIOR_ANSWER",
      validator: "AnswerValidator",
      analysisMode: "STANDARD",
    });
    expect(routeTask("CODE_EXTRACTION")).toMatchObject({
      outputContract: "EXTRACTED_CODE",
      validator: "CodeExtractionValidator",
    });
    expect(routeTask("FINDING_ANALYSIS").validator).toBe("FindingValidator");
    expect(routeTask("FULL_FORENSIC_AUDIT").validator).toBe("ForensicReportValidator");
    expect(routeTask("WORKSPACE_REVIEW")).toMatchObject({
      outputContract: "FORENSIC_REPORT",
      validator: "ForensicReportValidator",
      analysisMode: "FORENSIC",
      requiresEvidence: true,
    });
    expect(routeTask("REPAIR_ANALYSIS").validator).toBe("RepairValidator");
  });

  it("caps narrow task budgets independently from broad forensic execution", () => {
    expect(
      capBudgetForTask("CODE_EXTRACTION", { maxIterations: 150, maxToolCalls: 500 }),
    ).toEqual({ maxIterations: 16, maxToolCalls: 12 });
    expect(
      capBudgetForTask("BEHAVIOR_QUERY", { maxIterations: 150, maxToolCalls: 500 }),
    ).toEqual({ maxIterations: 120, maxToolCalls: 260 });
    expect(
      capBudgetForTask("FULL_FORENSIC_AUDIT", { maxIterations: 220, maxToolCalls: 800 }),
    ).toEqual({ maxIterations: 120, maxToolCalls: 480 });
    expect(
      capBudgetForTask("WORKSPACE_REVIEW", { maxIterations: 150, maxToolCalls: 500 }),
    ).toEqual({ maxIterations: 144, maxToolCalls: 480 });
  });

  it("validates independent result shapes", () => {
    const evidence = [{ source: "src/loop.ts", excerpt: "return partial", supportsClaim: true }];
    expect(BehaviorAnswerSchema.safeParse({ answer: "No", evidence, sourceScope: ["src/loop.ts"] }).success).toBe(true);
    expect(CodeExtractionSchema.safeParse({ extractedCode: "return partial;" }).success).toBe(true);
    expect(FindingAnalysisSchema.safeParse({
      finding: "The loop drops partial output",
      evidence,
      severity: "MEDIUM",
    }).success).toBe(true);
    expect(RepairAnalysisSchema.safeParse({
      repairPlan: "Preserve the partial result",
      evidence,
      readiness: "READY",
    }).success).toBe(true);
  });

  it("keeps function-scoped forensic/repair detection which rejects the first", () => {
    const judgment = (input: string) => classifyForensicTask(input);
    expect(judgment("Create a repair plan for the proven defect.")).toBe("REPAIR_ANALYSIS");
    expect(judgment("Find and prove any behavioral defect in executeToolLoop.")).toBe(
      "FINDING_ANALYSIS",
    );
  });

  it("routes a capability probe that only denies repair/finding intent to BEHAVIOR_QUERY", () => {
    // The probe explicitly says "Do not perform repair analysis", "do NOT invent
    // a defect finding", and "Do not include a repair plan". Those keywords appear
    // ONLY inside negations, so the classifier must NOT route to REPAIR/FINDING and
    // force the six-section forensic-report + R-PROOF contract. Same root-cause
    // family as the junk-roots fix.
    const probe = `# AI Model Capability Probe
You are auditing the behavior of the code in this repo. Answer each sub-question
with evidence grounded in the ACTUAL source files. Do NOT infer, guess, or
invent symbols that are not present.
Inspecting ONLY these two files:
\`\`\`text
lib/ai-orchestrator/src/prompts/profile-classifier.ts
lib/ai-orchestrator/src/tools/file-tools.ts
\`\`\`
Do not broaden the investigation. Do not perform repair analysis. Do not
provide recommendations.
### C6 — Negative behavioral verdict is valid
Does profile-classifier.ts contain any call to the eval() or Function() constructors? Answer YES or NO. If NO, this is a valid behavioral
result — do NOT invent a defect finding, and do NOT treat "no such call" as a
failure that needs a repair plan.
End with one line stating the overall score. Do not include a repair plan.`;
    const taskType = classifyForensicTask(probe);
    expect(taskType).toBe("BEHAVIOR_QUERY");
    expect(getTaskOutputContract(taskType)).toBe("BEHAVIOR_ANSWER");
  });

  it("still routes a POSITIVE repair/finding request even when negation words appear elsewhere", () => {
    // "Don't broaden the investigation" is a negation, but "Create a repair plan"
    // is a genuinely positive intent — the classifier must still honor it.
    expect(
      classifyForensicTask("Don't broaden the investigation. Create a repair plan for the proven defect."),
    ).toBe("REPAIR_ANALYSIS");
    expect(
      classifyForensicTask(
        "Don't broaden. Find and prove any behavioral defect in executeToolLoop.",
      ),
    ).toBe("FINDING_ANALYSIS");
  });

  it("routes open implementation-plan language to REPAIR_ANALYSIS", () => {
    expect(classifyForensicTask("ضع خطة تنفيذية للإصلاح")).toBe("REPAIR_ANALYSIS");
    expect(classifyForensicTask("Create an implementation plan for the AI layer")).toBe(
      "REPAIR_ANALYSIS",
    );
  });

  it("routes broad gap-analysis language to FULL_FORENSIC_AUDIT", () => {
    expect(classifyForensicTask("ابحث عن الفجوات في طبقة الذكاء الاصطناعي")).toBe(
      "FULL_FORENSIC_AUDIT",
    );
    expect(classifyForensicTask("Find the gaps in the AI orchestration layer")).toBe(
      "FULL_FORENSIC_AUDIT",
    );
  });

  it("keeps Arabic production reachability on the forensic proof contract", () => {
    const reachabilityPrompt = "أثبت أن الدالة computeCentrality قابلة للوصول في الإنتاج.";
    expect(isProductionReachabilityRequest(reachabilityPrompt)).toBe(true);
    expect(classifyForensicTask(reachabilityPrompt)).toBe("FINDING_ANALYSIS");
    expect(getTaskOutputContract("FINDING_ANALYSIS")).toBe("FINDING_ANALYSIS");

    const behaviorPrompt = "ماذا يحدث عند انتهاء المهلة في الدالة computeCentrality؟";
    expect(isProductionReachabilityRequest(behaviorPrompt)).toBe(false);
    expect(classifyForensicTask(behaviorPrompt)).toBe("BEHAVIOR_QUERY");
    expect(getTaskOutputContract("BEHAVIOR_QUERY")).toBe("BEHAVIOR_ANSWER");
  });

  it("routes broad workspace reviews to the dedicated evidence contract", () => {
    for (const message of [
      "#151 review workspace",
      "review the entire codebase",
      "assess the full repository",
      "review all code",
      "راجع مساحة العمل بالكامل",
      "حلل كل الكود",
    ]) {
      expect(classifyForensicTask(message), message).toBe("WORKSPACE_REVIEW");
    }
    expect(classifyForensicTask("review src/loop.ts only")).not.toBe("WORKSPACE_REVIEW");
  });

  it("rejects a forensic report when the task only asks for code", () => {
    expect(
      validateTaskResponse("CODE_EXTRACTION", "```ts\nreturn partial;\n```").valid,
    ).toBe(true);
    expect(
      validateTaskResponse(
        "CODE_EXTRACTION",
        "## 1) Executive Verdict\n## 2) Evidence Map\n## 3) Findings",
      ),
    ).toMatchObject({
      valid: false,
    });
  });

  it("keeps behavior answers independent from the six-section audit contract", () => {
    expect(
      validateTaskResponse("BEHAVIOR_QUERY", "It returns the partial result.").valid,
    ).toBe(true);
    expect(
      validateTaskResponse(
        "BEHAVIOR_QUERY",
        [
          "## 1) Executive Verdict",
          "## 2) Evidence Map",
          "## 3) Findings",
          "## 4) Repair Plan",
          "## 5) Validation Checklist",
          "## 6) Final Judgment",
        ].join("\n"),
      ),
    ).toMatchObject({
      valid: false,
    });
  });

  it("requires the six-section evidence report for WORKSPACE_REVIEW", () => {
    expect(validateTaskResponse("WORKSPACE_REVIEW", "Project overview: package.json and src/.").valid).toBe(false);
    expect(
      validateTaskResponse(
        "WORKSPACE_REVIEW",
        [
          "## 1) Executive Verdict",
          "## 2) Evidence Map",
          "## 3) Findings",
          "## 4) Repair Plan",
          "## 5) Validation Checklist",
          "## 6) Final Judgment",
        ].join("\n"),
      ).valid,
    ).toBe(true);
  });

  it("requires task-shaped content for finding, repair, and full-audit responses", () => {
    expect(validateTaskResponse("FINDING_ANALYSIS", "NOT PROVEN").valid).toBe(true);
    expect(validateTaskResponse("FINDING_ANALYSIS", "Looks interesting").valid).toBe(false);
    expect(validateTaskResponse("REPAIR_ANALYSIS", "BLOCKED — no proven defect").valid).toBe(true);
    expect(validateTaskResponse("REPAIR_ANALYSIS", "Looks interesting").valid).toBe(false);
    expect(
      validateTaskResponse("FULL_FORENSIC_AUDIT", "## 1) Executive Verdict").valid,
    ).toBe(false);
  });

  it("accepts a behavior claim only when an exact read excerpt is linked", () => {
    const fileContents = new Map([
      ["src/loop.ts", 'export function run() {\n  return "partial";\n}\n'],
    ]);
    const accepted = validateBehaviorEvidence(
      "What does run return?",
      'Source: `src/loop.ts`\nEvidence: `return "partial"`\nThe function returns the partial result.',
      fileContents,
    );
    expect(accepted).toMatchObject({
      valid: true,
      violations: [],
      evidence: [{
        source: "src/loop.ts",
        excerpt: 'return "partial"',
        supportsClaim: true,
        directness: "DIRECT",
        evidenceClass: "BEHAVIOR_PROVEN",
        // Exact 1-based line span for the quoted fragment
        sourceSpan: { startLine: 2, endLine: 2 },
      }],
    });

    const rejected = validateBehaviorEvidence(
      "What does run return?",
      "Source: `src/loop.ts`\nThe function returns the partial result.",
      fileContents,
    );
    expect(rejected.valid).toBe(false);
    expect(rejected.evidence).toEqual([]);
    expect(rejected.violations[0]).toContain("relevant control-flow");

    const defaultOnly = validateBehaviorEvidence(
      "What happens when maxIterations is reached?",
      "Source: `src/loop.ts`\nEvidence: `const DEFAULT_MAX_ITERATIONS = 20`",
      new Map([[
        "src/loop.ts",
        "const DEFAULT_MAX_ITERATIONS = 20;\nexport function run(maxIterations) { return maxIterations; }\n",
      ]]),
    );
    expect(defaultOnly.valid).toBe(false);
    expect(defaultOnly.evidence).toMatchObject([{
      supportsClaim: false,
      evidenceClass: "READ_CONFIRMED",
      directness: "INDIRECT",
    }]);
  });

  it("rejects a bare constant as behavioral evidence even when the file was fully read", () => {
    // DEFAULT_MAX_ITERATIONS = 30 tells us the configured limit; it does NOT prove
    // what the code does when that limit is reached (partial branch ≠ exhausted branch).
    const fileContent =
      "const DEFAULT_MAX_ITERATIONS = 30;\n\n" +
      "export function runAgent(iterations: number) {\n" +
      "  if (iterations >= DEFAULT_MAX_ITERATIONS) return 'exhausted';\n" +
      "  return 'partial';\n" +
      "}\n";
    const fileContents = new Map([["src/agent.ts", fileContent]]);

    const result = validateBehaviorEvidence(
      "What happens when the iteration limit is reached?",
      "Source: `src/agent.ts`\nEvidence: `const DEFAULT_MAX_ITERATIONS = 30`\n" +
        "The agent uses 30 iterations as its limit.",
      fileContents,
    );

    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("relevant control-flow");
    expect(result.evidence).toMatchObject([{
      supportsClaim: false,
      evidenceClass: "READ_CONFIRMED",
      directness: "INDIRECT",
      // The span IS computed (constant is found verbatim at line 1) but a
      // constant assignment carries no control-flow semantics and therefore
      // cannot prove the behavioral claim.
      sourceSpan: { startLine: 1, endLine: 1 },
    }]);
  });

  it("rejects a constant whose value contains a flow-marker word in a string literal", () => {
    // `const RETURN_CODE = "return partial"` would pass a naïve FLOW_MARKERS
    // regex because "return" appears in the string literal.  After stripping
    // non-executable tokens via the lexical scanner, no flow marker remains,
    // so supportsClaim must be false and the excerpt must stay READ_CONFIRMED.
    const fileContent =
      'const RETURN_CODE = "return partial";\n\n' +
      "export function getCode() {\n" +
      "  return RETURN_CODE;\n" +
      "}\n";
    const fileContents = new Map([["src/codes.ts", fileContent]]);

    const result = validateBehaviorEvidence(
      "What does getCode return?",
      'Source: `src/codes.ts`\nEvidence: `const RETURN_CODE = "return partial"`\n' +
        "The function returns RETURN_CODE.",
      fileContents,
    );

    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("relevant control-flow");
    // The constant is found verbatim, so a span is computed, but the
    // string-literal "return" must not elevate it to BEHAVIOR_PROVEN.
    expect(result.evidence).toMatchObject([{
      supportsClaim: false,
      evidenceClass: "READ_CONFIRMED",
      directness: "INDIRECT",
      sourceSpan: { startLine: 1, endLine: 1 },
    }]);
  });

  it("accepts valid behavioral proof when the excerpt contains // inside a string literal", () => {
    // A naïve chained-regex stripper running `//` comment removal before string
    // stripping would truncate `"http://host"` at `//host`, removing the
    // executable `if`/`return` tokens that follow.  The lexical scanner must
    // handle string delimiters before comment markers in a single pass.
    const fileContent =
      "export function fetchData(url: string) {\n" +
      '  if (url === "http://host") return fallback;\n' +
      "  return fetch(url);\n" +
      "}\n";
    const fileContents = new Map([["src/fetch.ts", fileContent]]);

    const result = validateBehaviorEvidence(
      "What happens when url is http://host?",
      'Source: `src/fetch.ts`\n' +
        'Evidence: `if (url === "http://host") return fallback`\n' +
        "The function returns the fallback value.",
      fileContents,
    );

    expect(result.valid).toBe(true);
    expect(result.evidence).toMatchObject([{
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      directness: "DIRECT",
      sourceSpan: { startLine: 2, endLine: 2 },
    }]);
  });

  it("accepts valid behavioral proof when the excerpt contains /* inside a string literal", () => {
    // A block-comment marker inside a string must not be treated as a comment
    // start.  The lexical scanner processes the string delimiter first.
    const fileContent =
      "export function validate(note: string) {\n" +
      '  if (note === "/* not a comment */") return "ok";\n' +
      '  throw new Error("invalid note");\n' +
      "}\n";
    const fileContents = new Map([["src/validate.ts", fileContent]]);

    const result = validateBehaviorEvidence(
      "What happens when note contains a comment marker?",
      'Source: `src/validate.ts`\n' +
        'Evidence: `if (note === "/* not a comment */") return "ok"`\n' +
        'The function returns "ok".',
      fileContents,
    );

    expect(result.valid).toBe(true);
    expect(result.evidence).toMatchObject([{
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      directness: "DIRECT",
      sourceSpan: { startLine: 2, endLine: 2 },
    }]);
  });

  it("locates the span at the correct occurrence when a fragment appears in more than one branch", () => {
    // The same `return "partial"` fragment appears in BOTH the `if` and the
    // `else` branch. A blind first-occurrence search (indexOf) would always
    // report line 4. When the response cites the fragment in context of the
    // *second* occurrence (the safe fallback), computeSourceSpan must prefer
    // the occurrence whose surrounding lines match the citation context.
    const fileContent =
      "export function pick(flag: boolean): string {\n" +
      "  if (flag) {\n" +
      '    console.log("fast path");\n' +
      '    return "partial";\n' +
      "  } else {\n" +
      '    console.log("safe fallback");\n' +
      '    return "partial";\n' +
      "  }\n" +
      "}\n";
    const fileContents = new Map([["src/pick.ts", fileContent]]);

    const result = validateBehaviorEvidence(
      "What does pick return when flag is false?",
      "Source: `src/pick.ts`\n" +
        "In the safe fallback branch:\n" +
        'Evidence: `return "partial"`\n' +
        "The function returns the partial result in the fallback.",
      fileContents,
    );

    expect(result.valid).toBe(true);
    expect(result.evidence).toMatchObject([{
      source: "src/pick.ts",
      excerpt: 'return "partial"',
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      // The second occurrence (else branch) is the contextually-cited one.
      sourceSpan: { startLine: 7, endLine: 7 },
    }]);
  });

  it("downgrades evidence whose duplicated fragment has identical surrounding contexts", () => {
    // The SAME one-line `return "partial"` appears inside two `if` blocks that
    // are structurally identical on their surrounding lines. With no context
    // signal separating the two occurrences, no span can be proven to be the
    // one the answer cites — trusting the first match (line 4) would present a
    // confidently wrong branch as exact (task #24).
    const fileContent =
      "export function run(tag: string): string {\n" +
      "  if (tag === 'a') {\n" +
      "    doWork();\n" +
      '    return "partial";\n' +
      "  }\n" +
      "  if (tag === 'b') {\n" +
      "    doWork();\n" +
      '    return "partial";\n' +
      "  }\n" +
      "  return 'complete';\n" +
      "}\n";
    const fileContents = new Map([["src/dup.ts", fileContent]]);

    const result = validateBehaviorEvidence(
      "What does run return when tag is a?",
      "Source: `src/dup.ts`\n" +
        "Evidence: `return \"partial\"`\n" +
        "The function returns the partial result.",
      fileContents,
    );

    // The evidence must NOT claim BEHAVIOR_PROVEN at the first-match span (line
    // 4). Both occurrences have identical neighbours, so it is downgraded to
    // READ_CONFIRMED and carries no verifiable span.
    const evidence = result.evidence.find((item) => item.excerpt === 'return "partial"');
    expect(evidence).toBeDefined();
    expect(evidence?.evidenceClass).toBe("READ_CONFIRMED");
    expect(evidence?.supportsClaim).toBe(false);
    expect(evidence?.sourceSpan).toBeUndefined();
  });

  it("tracks requested, answered, and missing behavior fields independently", () => {
    const evidence = [{
      source: "src/loop.ts",
      excerpt: "if (maxIterations >= limit) return exhausted;",
      supportsClaim: true,
      relevance: 0.9,
      directness: "DIRECT" as const,
      sourceType: "IMPLEMENTATION" as const,
      productionReachability: "PROVEN" as const,
      evidenceClass: "BEHAVIOR_PROVEN" as const,
    }];
    expect(
      extractQuestionCoverage(
        "What happens to maxIterations and timeout?",
        "maxIterations returns exhausted.",
        evidence,
      ),
    ).toEqual({
      requestedFields: ["maxiterations", "timeout"],
      answeredFields: ["maxiterations"],
      missingFields: ["timeout"],
      complete: false,
    });
    const answer = buildSemanticBehaviorAnswer(
      "What happens to maxIterations?",
      "maxIterations returns exhausted.",
      evidence,
      ["src/loop.ts"],
    );
    expect(SemanticBehaviorAnswerSchema.safeParse(answer).success).toBe(true);
    expect(answer.confidence).toBe(0.9);
    expect(answer.coverage.complete).toBe(true);
  });
});