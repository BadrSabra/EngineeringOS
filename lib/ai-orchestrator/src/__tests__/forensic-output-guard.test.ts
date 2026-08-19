import { describe, expect, it } from "vitest";
import {
  applyForensicEvidenceGate,
  applyForensicOutputContract,
  collectForensicEvidence,
} from "../forensic-output-guard.js";

function readEvidence(path: string, content: string) {
  return collectForensicEvidence(
    [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "read-1",
            function: { name: "read_file", arguments: JSON.stringify({ path }) },
          },
        ],
      },
      { role: "tool", tool_call_id: "read-1", content },
    ],
    [path],
  );
}

describe("forensic output evidence gate", () => {
  it("downgrades Findings when the requested forensic scope is only partially read", () => {
    const evidence = {
      ...readEvidence("src/runtime.ts", "export const runtime = true;\n"),
      sourceCoverage: {
        complete: false,
        roots: [{
          root: "src",
          discoveredFiles: 2,
          readFiles: 1,
          unreadFiles: 1,
          status: "PARTIAL" as const,
        }],
        reason: "The requested forensic scope was only partially read: src=PARTIAL (1/2)",
      },
    };
    const report = [
      "## 3) Findings",
      "ID: F-01 · Runtime defect",
      "* File(s): `src/runtime.ts`",
      "* Evidence: `export const runtime = true;`",
      "* Why it matters: The behavior is unsafe.",
      "* Root cause: The implementation is incomplete.",
      "* Fix: Replace the implementation.",
      "",
      "## 4) Repair Plan",
      "Phase 1 (F-01): Replace the implementation.",
    ].join("\n");

    const result = applyForensicEvidenceGate(report, evidence);

    expect(result.violations[0]?.findingId).toBe("F-01");
    expect(result.response).toContain("ID: F-01 · NOT PROVEN");
    expect(result.response).toContain("requested forensic scope was only partially read");
    expect(result.response).toContain("[BLOCKED: F-01 is NOT PROVEN");
  });

  it("can retain packet-local proof without authorizing a partial-scope Finding", () => {
    const evidence = {
      ...readEvidence("src/runtime.ts", "return eval(expression);\n"),
      sourceCoverage: {
        complete: false,
        roots: [{
          root: "src",
          discoveredFiles: 2,
          readFiles: 1,
          unreadFiles: 1,
          status: "PARTIAL" as const,
        }],
      },
    };
    const report = [
      "## 3) Findings",
      "ID: F-01 · Dynamic evaluation",
      "* File(s): `src/runtime.ts`",
      "* Evidence: `return eval(expression);`",
      "* Why it matters: caller input can execute code.",
      "* Root cause: the implementation evaluates the input.",
      "* Fix: replace eval with an allow-listed parser.",
    ].join("\n");

    const result = applyForensicEvidenceGate(report, evidence, {
      allowPartialScopeFinding: true,
    });

    expect(result.violations).toEqual([]);
    expect(result.response).toContain("ID: F-01 · Dynamic evaluation");
  });

  it("treats an unread schema as a verification gap, not as a proven query defect", () => {
    const path = "lib/knowledge-engine/src/queries.ts";
    const evidence = readEvidence(
      path,
      'import { graphEntitiesTable } from "@workspace/db";\nexport function getImpactedEntities() { return []; }\n',
    );
    const report = [
      "## 3) Findings",
      "ID: F-01 · Schema mismatch",
      `* File(s): \`${path}\``,
      '* Evidence: `import { graphEntitiesTable } from "@workspace/db";`',
      "* Why it matters: The columns may be incompatible.",
      "* Root cause: The schema file was not read, so compatibility cannot be verified.",
      "* Fix: Read the graph schema and update the query.",
      "",
      "## 4) Repair Plan",
      "Phase 1 (F-01): Update the query.",
    ].join("\n");

    const result = applyForensicEvidenceGate(report, evidence);

    expect(result.violations[0]?.reasons).toContain(
      "a missing schema/context read is a verification gap, not a proven implementation defect",
    );
    expect(result.response).toContain("ID: F-01 · NOT PROVEN");
  });

  it("does not accept an unmeasured memory concern as a behavioral Finding", () => {
    const path = "lib/knowledge-engine/src/inference.ts";
    const evidence = readEvidence(
      path,
      "for (const e of entities) { inDegree.set(e.id, 0); outDegree.set(e.id, 0); }\n",
    );
    const report = [
      "## 3) Findings",
      "ID: F-02 · Memory overhead",
      `* File(s): \`${path}\``,
      "* Evidence: `inDegree.set(e.id, 0); outDegree.set(e.id, 0);`",
      "* Why it matters: The extra maps may consume additional memory.",
      "* Root cause: The algorithm creates O(n) additional memory.",
      "* Fix: Use Map.has() instead.",
      "",
      "## 4) Repair Plan",
      "Phase 1 (F-02): Replace the map initialization.",
    ].join("\n");

    const result = applyForensicEvidenceGate(report, evidence);

    expect(result.violations[0]?.reasons).toContain(
      "the performance or memory impact is asserted without a completed measurement or reproducible result",
    );
    expect(result.response).toContain("ID: F-02 · NOT PROVEN");
  });

  it("does not treat a package-manager catalog alias as an unspecified dependency version", () => {
    const path = "lib/knowledge-engine/package.json";
    const evidence = readEvidence(path, '{ "dependencies": { "drizzle-orm": "catalog:" } }\n');
    const report = [
      "## 3) Findings",
      "ID: F-03 · Unpinned dependency",
      `* File(s): \`${path}\``,
      '* Evidence: `"drizzle-orm": "catalog:"`',
      "* Why it matters: The dependency version is unspecified.",
      "* Root cause: The catalog alias does not pin an explicit version.",
      "* Fix: Replace catalog: with an explicit version.",
      "",
      "## 4) Repair Plan",
      "Phase 1 (F-03): Pin the dependency version.",
    ].join("\n");

    const result = applyForensicEvidenceGate(report, evidence);

    expect(result.violations[0]?.reasons).toContain(
      "a package-manager catalog alias does not prove a missing version without the root catalog or lockfile",
    );
    expect(result.response).toContain("ID: F-03 · NOT PROVEN");
  });

  it("rewrites the final judgment when a candidate Finding is blocked", () => {
    const path = "src/runtime.ts";
    const evidence = readEvidence(path, "export const runtime = true;\n");
    const report = [
      "## 1) Executive Verdict",
      "A small patch is recommended.",
      "",
      "## 2) Evidence Map",
      `File: \`${path}\``,
      "Role: implementation",
      "Evidence: `export const runtime = true;`",
      "Risk: runtime behavior",
      "Notes: FACT",
      "",
      "## 3) Findings",
      "ID: F-01 · Unverified runtime defect",
      `* File(s): \`${path}\``,
      "* Evidence: `return missing();`",
      "* Why it matters: The behavior may be unsafe.",
      "* Root cause: The implementation may be incomplete.",
      "* Fix: Replace the implementation.",
      "",
      "## 4) Repair Plan",
      "Phase 1 (F-01): Replace the implementation.",
      "",
      "## 5) Validation Checklist",
      "- Run a focused test.",
      "",
      "## 6) Final Judgment",
      "Patch صغير — update src/runtime.ts.",
    ].join("\n");

    const result = applyForensicEvidenceGate(report, evidence);

    expect(result.response).toContain(
      "NOT PROVEN — one or more candidate Findings failed the evidence or semantic gate.",
    );
    expect(result.response).toContain("[BLOCKED: F-01 is NOT PROVEN");
    expect(result.response).not.toContain("Patch صغير — update src/runtime.ts.");
  });

  it("rejects a generic Summary that omits the forensic report contract", () => {
    const result = applyForensicOutputContract(
      "Summary\n\nProject Overview: this is a TypeScript workspace.",
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(6);
    for (const header of [
      "## 1) Executive Verdict",
      "## 2) Evidence Map",
      "## 3) Findings",
      "## 4) Repair Plan",
      "## 5) Validation Checklist",
      "## 6) Final Judgment",
    ]) {
      expect(result.response).toContain(header);
    }
    expect(result.response).not.toContain("Project Overview");
  });

  it("normalizes a compact capability-test report into a proven finding and repair phase", () => {
    const evidence = readEvidence(
      "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts",
      "export function evaluateUserExpression(expression: string): unknown {\n  return eval(expression);\n}\n",
    );
    const compact = [
      "## Verdict",
      "PROVEN",
      "## Direct Evidence",
      "File: `lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts`",
      "Evidence: `return eval(expression);`",
      "## Finding",
      "Dynamic evaluation executes caller-controlled input.",
      "Why it matters: Input can execute arbitrary code.",
      "Root cause: The implementation evaluates the caller-provided string directly.",
      "## Repair Plan",
      "Replace dynamic evaluation with an allow-listed parser.",
      "## Validation",
      "Run the focused security regression test.",
    ].join("\n");

    const result = applyForensicOutputContract(compact, evidence);

    expect(result.valid).toBe(true);
    expect(result.response).toContain("ID: F-01 · Dynamic evaluation executes caller-controlled input.");
    expect(result.response).toContain("`return eval(expression);`");
    expect(result.response).toContain("Phase 1 (F-01): Replace dynamic evaluation with an allow-listed parser.");
    expect(result.response).toContain("- Run the focused security regression test.");
    expect(result.response).not.toContain("No verified finding identified");
  });

  it("normalizes harmless numbered heading variants without weakening evidence gates", () => {
    const response = [
      "1) Executive Verdict",
      "The inspected layers were reviewed.",
      "2) Evidence Map",
      "File: `src/example.ts`",
      "Role: implementation",
      "Evidence: `const value = 1`",
      "Risk: runtime behavior",
      "Notes: FACT",
      "3) Findings",
      "No verified finding identified from inspected source code.",
      "4) Repair Plan",
      "No repair phases identified.",
      "5) Validation Checklist",
      "No validation scenario available.",
      "6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response, {
      toolSources: ["src/example.ts"],
      fileContents: new Map([["src/example.ts", "const value = 1;\n"]]),
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    for (const header of [
      "## 1) Executive Verdict",
      "## 2) Evidence Map",
      "## 3) Findings",
      "## 4) Repair Plan",
      "## 5) Validation Checklist",
      "## 6) Final Judgment",
    ]) {
      expect(result.response).toContain(header);
    }
    expect(result.response).toContain("## 1) Executive Verdict");
    expect(result.response).toContain("## 6) Final Judgment");
    expect(result.response).toContain("NOT PROVEN — insufficient evidence.");

    const fallbackValidation = applyForensicOutputContract(result.response);
    expect(fallbackValidation.valid).toBe(true);
    expect(fallbackValidation.violations).toEqual([]);
  });

  it("repairs a rejected report from completed source reads without creating findings", () => {
    const evidence = readEvidence(
      "lib/knowledge-engine/src/queries.ts",
      "export function findPath() {\n  return [];\n}\n",
    );
    const response = [
      "## 1) Executive Verdict",
      "The implementation is robust and production-safe.",
      "## 2) Evidence Map",
      "No verified evidence map was produced.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phase is executable.",
      "## 5) Validation Checklist",
      "- FAIL — no validated scenario.",
      "## 6) Final Judgment",
      "NOT PROVEN.",
    ].join("\n");

    const result = applyForensicOutputContract(response, evidence);

    expect(result.valid).toBe(true);
    expect(result.response).toContain("File: `lib/knowledge-engine/src/queries.ts`");
    expect(result.response).toContain(
      "Evidence: completed read_file result; executable source fragment at line 1:",
    );
    expect(result.response).toContain(
      "(read proof only; no behavioral finding accepted)",
    );
    expect(result.response).toContain("Notes: READ_CONFIRMED · NOT_BEHAVIORAL_PROOF");
    expect(result.response).toContain("NOT PROVEN — the available source evidence does not establish a broad quality or completeness claim.");
    expect(result.response.match(/Evidence Map Evidence must cite/g)).toBeNull();

    const fallbackValidation = applyForensicOutputContract(result.response, evidence);
    expect(fallbackValidation.valid).toBe(true);
    expect(fallbackValidation.violations).toEqual([]);
    expect(fallbackValidation.response).toContain("No verified finding identified");
  });

  it("repairs the screenshot-shaped report when a complete prefetch body is supplied separately", () => {
    const path = "lib/knowledge-engine/src/queries.ts";
    const source = "export function findPath() {\n  return [];\n}\n";
    const evidence = collectForensicEvidence(
      [],
      [path],
      new Map([[path, source]]),
    );
    const response = [
      "## 1) Executive Verdict",
      "The implementation is comprehensive and robust.",
      "## 2) Evidence Map",
      `File: \`${path}\``,
      "Role: implementation source",
      "Evidence: `export function findPath()`",
      "Risk: runtime behavior",
      "Notes: FACT",
      "## 3) Findings",
      "The implementation has a critical issue and should be fixed.",
      "## 4) Repair Plan",
      "Phase 1: update `lib/knowledge-engine/src/queries.ts`",
      "## 5) Validation Checklist",
      "- Run focused tests",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response, evidence);

    expect(result.valid).toBe(true);
    expect(result.response).toContain(`File: \`${path}\``);
    expect(result.response).toContain("No verified finding identified");
    expect(result.response).toContain(
      "No repair phases identified because no executable Finding was accepted.",
    );
    expect(result.response).not.toContain("The implementation is comprehensive");
    expect(result.response).not.toContain("Phase 1: update");
    expect(applyForensicOutputContract(result.response, evidence)).toMatchObject({
      valid: true,
      violations: [],
    });
  });

  it("rejects a report that claims a confirmed defect but leaves Findings empty", () => {
    const evidence = readEvidence(
      "src/__tests__/fixtures/known-defect.ts",
      "export function evaluateUserExpression(expression: string): unknown {\n  return eval(expression);\n}\n",
    );
    const response = [
      "## 1) Executive Verdict",
      "A verified behavioral defect exists in known-defect.ts.",
      "## 2) Evidence Map",
      "File: `src/__tests__/fixtures/known-defect.ts`",
      "Role: implementation source read during the forensic scan",
      "Evidence: `return eval(expression);`",
      "Risk: arbitrary code execution",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified because no executable Finding was accepted.",
      "## 5) Validation Checklist",
      "No validation scenario available because no Finding passed the report contract.",
      "## 6) Final Judgment",
      "Patch صغير — `return eval(expression);` in `src/__tests__/fixtures/known-defect.ts`",
    ].join("\n");

    const result = applyForensicOutputContract(response, evidence);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Findings contradicts a positive defect claim elsewhere in the report; emit a fully evidenced Finding or mark the other sections NOT PROVEN",
    );
  });

  it("rejects the Arabic screenshot-shaped contradiction before it can become NO_FINDING", () => {
    const evidence = readEvidence(
      "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts",
      "export function evaluateUserExpression(expression: string): unknown {\n  return eval(expression);\n}\n",
    );
    const response = [
      "## 1) Executive Verdict",
      "تم اكتشاف عيب سلوكي مثبت في known-defect.ts: الدالة evaluateUserExpression تستخدم eval على إدخال مستخدم غير مُعقَّد، مما يتيح تنفيذ شيفرة عشوائية.",
      "## 2) Evidence Map",
      "File: lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts",
      "Role: دالة تقييم تعبير نصي يُمرره المستخدم.",
      "Evidence: return eval(expression);",
      "Risk: تنفيذ شيفرة ضارة عبر إدخال المستخدم.",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified because no executable Finding was accepted.",
      "## 5) Validation Checklist",
      "No validation scenario available because no Finding passed the report contract.",
      "## 6) Final Judgment",
      "Patch صغير — استبدال eval بتطبيق آمن داخل lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts.",
    ].join("\n");

    const result = applyForensicOutputContract(response, evidence);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Findings contradicts a positive defect claim elsewhere in the report; emit a fully evidenced Finding or mark the other sections NOT PROVEN",
    );
  });

  it("rejects Arabic contradiction variants with diacritics and an inline Finding ID", () => {
    const evidence = readEvidence(
      "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts",
      "export function evaluateUserExpression(expression: string): unknown {\n  return eval(expression);\n}\n",
    );
    const response = [
      "## 1) Executive Verdict",
      "تم العثور على عيب سلوكي مُثبت في known-defect.ts: الدالة evaluateUserExpression تستخدم eval على إدخال مستخدم غير مُعثّر، مما يتيح تنفيذ شيفرة ضارة. Finding ID: F-001 (Critical).",
      "## 2) Evidence Map",
      "File: lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts",
      "Role: دالة تقييم تعبير نصي يُمرره المستخدم.",
      "Evidence: return eval(expression);",
      "Risk: تنفيذ شيفرة ضارة عن بُعد (RCE) إذا تم توجيه الإدخال.",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified because no executable Finding was accepted.",
      "## 5) Validation Checklist",
      "No validation scenario available because no Finding passed the report contract.",
      "## 6) Final Judgment",
      "Patch صغير — استبدال eval(expression) بتنفيذ آمن في lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts.",
    ].join("\n");

    const result = applyForensicOutputContract(response, evidence);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Findings contradicts a positive defect claim elsewhere in the report; emit a fully evidenced Finding or mark the other sections NOT PROVEN",
    );
  });

  it("repairs a multi-file recovery report with short paths, stale FACT claims, and broad wording", () => {
    const paths = [
      "lib/knowledge-engine/src/inference.ts",
      "lib/knowledge-engine/src/types.ts",
      "lib/ai-orchestrator/src/groq-client.ts",
      "lib/ai-orchestrator/src/tool-execution-engine.ts",
      "lib/ai-orchestrator/src/agent-complete.ts",
    ];
    const messages = paths.map((path, index) => ({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: `read-${index}`,
        function: { name: "read_file", arguments: JSON.stringify({ path }) },
      }],
    }));
    const evidence = collectForensicEvidence(
      [
        ...messages,
        ...paths.map((path, index) => ({
          role: "tool",
          tool_call_id: `read-${index}`,
          content: `File: ${path}\n\`\`\`ts\nexport const inspected = true;\n\`\`\``,
        })),
      ],
      paths,
    );
    const response = [
      "## 1) Executive Verdict",
      "The inspected implementation is comprehensive and robust.",
      "## 2) Evidence Map",
      "File: `inference.ts`",
      "Role: robust implementation",
      "Evidence: `const stale = true`",
      "Risk: no issues identified",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — the available evidence is insufficient.",
    ].join("\n");

    const result = applyForensicOutputContract(response, evidence);

    expect(result.valid).toBe(true);
    for (const path of paths) {
      expect(result.response).toContain(`File: \`${path}\``);
    }
    expect(result.response).not.toContain("comprehensive and robust");
    expect(result.response).not.toContain("File: `inference.ts`");
    expect(result.response).toContain("Notes: READ_CONFIRMED · NOT_BEHAVIORAL_PROOF");
    expect(applyForensicOutputContract(result.response, evidence)).toMatchObject({
      valid: true,
      violations: [],
    });
  });

  it("preserves prefetch evidence when synthetic tool messages are unavailable", () => {
    const path = "src/prefetched.ts";
    const evidence = collectForensicEvidence(
      [],
      [path],
      new Map([[path, "export const prefetched = true;\n"]]),
    );

    expect(evidence.fileContents.get(path)).toBe(
      "export const prefetched = true;",
    );
  });

  it("does not leak stale original-report violations into the reconstructed fallback", () => {
    const evidence = {
      toolSources: [
        "lib/knowledge-engine/src/types.ts",
        "lib/ai-orchestrator/src/groq-client.ts",
        "lib/ai-orchestrator/src/agent-complete.ts",
      ],
      fileContents: new Map([
        [
          "lib/knowledge-engine/src/types.ts",
          'export type GraphNode = { id: string };\n',
        ],
        [
          "lib/ai-orchestrator/src/groq-client.ts",
          "const DEFAULT_TIMEOUT_MS = 30_000;\n",
        ],
        [
          "lib/ai-orchestrator/src/agent-complete.ts",
          "export function complete() { return true; }\n",
        ],
      ]),
    };

    const result = applyForensicOutputContract(
      [
        "## 1) Executive Verdict",
        "The original response was malformed.",
        "## 2) Evidence Map",
        "File: `lib/knowledge-engine/src/types.ts`",
        "Role: implementation",
        "Evidence: `export type GraphNode = { id: string }`",
        "Risk: runtime behavior",
        "Notes: FACT",
        "## 3) Findings",
        "No verified finding identified from inspected source code.",
        "## 4) Repair Plan",
        "No repair phases identified.",
        "## 5) Validation Checklist",
        "No validation scenario available.",
        "## 6) Final Judgment",
        "Patch صغير / Refactor / إعادة تصميم — NOT PROVEN.",
        "Original response violations:",
        "- Evidence Map omits completed implementation reads: lib/ai-orchestrator/src/groq-client.ts",
      ].join("\n"),
      evidence,
    );

    expect(result.valid).toBe(true);
    expect(result.response).toContain("File: `lib/ai-orchestrator/src/groq-client.ts`");
    expect(result.response).toContain("File: `lib/ai-orchestrator/src/agent-complete.ts`");
    expect(result.response).not.toContain("Original response violations:");
    expect(result.response).not.toContain("Evidence Map omits completed implementation reads:");
    expect(applyForensicOutputContract(result.response, evidence).valid).toBe(true);
  });

  it("marks display-truncated reads NOT PROVEN and requires a targeted complete read", () => {
    const evidence = {
      toolSources: ["lib/ai-orchestrator/src/index.ts"],
      fileContents: new Map([
        [
          "lib/ai-orchestrator/src/index.ts",
          [
            "export { complete } from './agent-complete.js';",
            "[prefetch output truncated — this is a display limit, not evidence that the file is incomplete. Use targeted search_code for exact evidence]",
            "export function run() { return complete(); }",
          ].join("\n"),
        ],
      ]),
    };

    const fallback = applyForensicOutputContract("invalid response", evidence);

    expect(fallback.response).toContain("Notes: NOT PROVEN");
    expect(fallback.response).toContain("display truncation marker");
    expect(fallback.response).toContain("targeted complete read required");
    expect(fallback.response).not.toContain("Notes: FACT");
    expect(applyForensicOutputContract(fallback.response, evidence).valid).toBe(true);
  });

  it("uses the real cached read body instead of the cache marker as evidence", () => {
    const evidence = collectForensicEvidence(
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "read-cached",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "src/cached.ts" }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "read-cached",
          content:
            "[cached — identical call already executed this request]\n" +
            "export const cachedValue = 42;\n\n" +
            "EXECUTION GUARD: Do not call this same tool with the same arguments again. " +
            "Return a final response.",
        },
      ],
      ["src/cached.ts"],
    );

    expect(evidence.fileContents.get("src/cached.ts")).toBe(
      "export const cachedValue = 42;",
    );

    const result = applyForensicOutputContract(
      [
        "## 1) Executive Verdict",
        "No verified finding identified from inspected source code.",
        "## 2) Evidence Map",
        "File: `src/cached.ts`",
        "Role: implementation",
        "Evidence: `export const cachedValue = 42;`",
        "Risk: runtime behavior",
        "Notes: FACT",
        "## 3) Findings",
        "No verified finding identified from inspected source code.",
        "## 4) Repair Plan",
        "No repair phases identified.",
        "## 5) Validation Checklist",
        "No validation scenario available.",
        "## 6) Final Judgment",
        "NOT PROVEN — insufficient evidence.",
      ].join("\n"),
      evidence,
    );

    expect(result.valid).toBe(true);
  });

  it("keeps blocked and out-of-scope tool results out of the production Evidence Map", () => {
    const evidence = collectForensicEvidence(
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "allowed",
              function: { name: "read_file", arguments: JSON.stringify({ path: "lib/ai-orchestrator/src/chat.ts" }) },
            },
            {
              id: "outside",
              function: { name: "read_file", arguments: JSON.stringify({ path: "lib/api-zod/src/generated/types.ts" }) },
            },
            {
              id: "blocked-fixture",
              function: { name: "read_file", arguments: JSON.stringify({ path: "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts" }) },
            },
          ],
        },
        { role: "tool", tool_call_id: "allowed", content: "export function chat() { return true; }" },
        { role: "tool", tool_call_id: "outside", content: "export type Generated = string;" },
        {
          role: "tool",
          tool_call_id: "blocked-fixture",
          content: "Production forensic audits exclude test/spec/fixture sources. Read an implementation source file instead.",
        },
      ],
      [
        "lib/ai-orchestrator/src/chat.ts",
        "lib/api-zod/src/generated/types.ts",
        "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts",
      ],
      undefined,
      false,
      { roots: ["lib/ai-orchestrator"] },
    );

    expect([...evidence.fileContents.keys()]).toEqual(["lib/ai-orchestrator/src/chat.ts"]);
    expect(evidence.toolSources).toEqual(["lib/ai-orchestrator/src/chat.ts"]);
    expect(evidence.fileContents.has("lib/api-zod/src/generated/types.ts")).toBe(false);
    expect(evidence.fileContents.has("lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts")).toBe(false);
  });

  it("does not allow a truncated source body to prove a deterministic Finding", () => {
    const sourcePath = "lib/ai-orchestrator/src/evaluator.ts";
    const evidence = collectForensicEvidence(
      [],
      [sourcePath],
      new Map([[
        sourcePath,
        "return eval(expression);\n[prefetch output truncated — targeted complete read required]",
      ]]),
      false,
      { roots: ["lib/ai-orchestrator"] },
    );

    expect(evidence.incompleteFiles?.has(sourcePath)).toBe(true);
    expect(applyForensicEvidenceGate(
      [
        "ID: F-01 · Dynamic evaluation executes source text at runtime",
        `* File(s): \`${sourcePath}\``,
        "* Evidence: `return eval(expression);`",
      ].join("\n"),
      evidence,
    ).response).toContain("NOT PROVEN");
  });

  it("extracts source code from the read_file transport wrapper", () => {
    const evidence = collectForensicEvidence(
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "read-wrapped",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "src/wrapped.ts" }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "read-wrapped",
          content: "File: src/wrapped.ts\n```\nexport const value = 7;\n```",
        },
      ],
      ["src/wrapped.ts"],
    );

    expect(evidence.fileContents.get("src/wrapped.ts")).toBe(
      "export const value = 7;",
    );

    const fallback = applyForensicOutputContract(
      [
        "## 1) Executive Verdict",
        "The system is production-ready.",
        "## 2) Evidence Map",
        "No verified evidence map was produced.",
        "## 3) Findings",
        "No verified finding identified from inspected source code.",
        "## 4) Repair Plan",
        "No repair phases identified.",
        "## 5) Validation Checklist",
        "No validation scenario available.",
        "## 6) Final Judgment",
        "NOT PROVEN — insufficient evidence.",
      ].join("\n"),
      evidence,
    );

    expect(fallback.valid).toBe(true);
    expect(fallback.response).toContain(
      "Evidence: completed read_file result; executable source fragment at line 1: `export const value = 7;` (read proof only; no behavioral finding accepted)",
    );
    expect(fallback.response).not.toContain(
      "Evidence: completed read_file result; line 1: `File: src/wrapped.ts`",
    );
    const fallbackValidation = applyForensicOutputContract(
      fallback.response,
      evidence,
    );
    expect(fallbackValidation.valid).toBe(true);
  });

  it("does not treat a File label without a source body as evidence", () => {
    const evidence = collectForensicEvidence(
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "read-empty",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "src/empty.ts" }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "read-empty",
          content: "File: src/empty.ts",
        },
      ],
      ["src/empty.ts"],
    );

    expect(evidence.fileContents.has("src/empty.ts")).toBe(false);
  });

  it("excludes failed reads and synthesis instructions from source evidence", () => {
    const evidence = collectForensicEvidence(
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "missing",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "queries.js" }),
              },
            },
            {
              id: "synthesis",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "lib/knowledge-engine/src/queries.ts" }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "missing",
          content: 'Error reading "queries.js": ENOENT: no such file or directory',
        },
        {
          role: "tool",
          tool_call_id: "synthesis",
          content:
            "Synthesis phase is active. No further tools may run. " +
            "Produce the final answer from the evidence already gathered.",
        },
      ],
      ["queries.js", "lib/knowledge-engine/src/queries.ts"],
    );

    expect(evidence.fileContents.has("queries.js")).toBe(false);
    expect(evidence.fileContents.has("lib/knowledge-engine/src/queries.ts")).toBe(false);
  });

  it("skips comment-only lines when choosing a fallback source fragment", () => {
    const evidence = {
      toolSources: ["src/commented.ts"],
      fileContents: new Map([
        [
          "src/commented.ts",
          "/**\n * module documentation\n */\nexport function run() {}\n",
        ],
      ]),
    };

    const result = applyForensicOutputContract(
      "invalid response",
      evidence,
    );

    expect(result.response).toContain(
      "Evidence: completed read_file result; executable source fragment at line 4: `export function run() {}`",
    );
    expect(result.response).not.toContain(
      "line 2: `* module documentation`",
    );
  });

  it("prefers executable fallback evidence over imports and labels it as read proof only", () => {
    const evidence = {
      toolSources: ["src/behavior.ts"],
      fileContents: new Map([
        [
          "src/behavior.ts",
          [
            'import { db } from "@workspace/db";',
            "import type { User } from './types.js';",
            "",
            "export function loadUser(id: string) {",
            "  return db.query.users.findFirst({ where: { id } });",
            "}",
          ].join("\n"),
        ],
      ]),
    };

    const result = applyForensicOutputContract("invalid response", evidence);

    expect(result.response).toContain(
      "executable source fragment at line 4: `export function loadUser(id: string) {`",
    );
    expect(result.response).not.toContain(
      "line 1: `import { db } from \"@workspace/db\";`",
    );
    expect(result.response).toContain(
      "(read proof only; no behavioral finding accepted)",
    );
    expect(result.response).toContain(
      "no behavioral inference made",
    );
  });

  it("accepts the exact six-section forensic contract", () => {
    const response = [
      "## 1) Executive Verdict",
      "No verified finding identified from inspected source code.",
      "## 2) Evidence Map",
      "No verified evidence map was produced.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phase is executable.",
      "## 5) Validation Checklist",
      "- PASS — report contract is present.",
      "## 6) Final Judgment",
      "Patch صغير / Refactor / إعادة تصميم — NOT PROVEN.",
    ].join("\n");

    expect(applyForensicOutputContract(response)).toEqual({
      response,
      valid: true,
      violations: [],
    });
  });

  it("rejects a six-section report that copied template placeholders", () => {
    const response = [
      "## 1) Executive Verdict",
      "The implementation was reviewed.",
      "## 2) Evidence Map",
      "File: `src/example.ts`",
      "## 3) Findings",
      "ID: F-01 · HIGH",
      "Evidence: [exact code snippet]",
      "## 4) Repair Plan",
      "Phase 1 (F-01): update the implementation — `src/example.ts`",
      "## 5) Validation Checklist",
      "- [pass/fail test scenario for F-01]",
      "## 6) Final Judgment",
      "Patch صغير / Refactor / إعادة تصميم — `src/example.ts` line N: [one direct code reference]",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Validation Checklist contains an unresolved pass/fail scenario placeholder",
    );
    expect(result.response).toContain("No verified forensic verdict");
    expect(result.response).not.toContain("[pass/fail test scenario");
  });

  it("rejects a generic search summary as an Evidence Map", () => {
    const response = [
      "## 1) Executive Verdict",
      "No verified findings identified from inspected source code.",
      "## 2) Evidence Map",
      "File: search results summary",
      "Role: Code analysis",
      "Evidence: All search queries returned no matches.",
      "Risk: Low",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Evidence Map contains a search summary instead of file-level source evidence",
    );
    expect(result.violations).toContain(
      "Evidence Map does not cite a concrete inspected source file",
    );
  });

  it("rejects an Evidence Map file that was not actually read", () => {
    const response = [
      "## 1) Executive Verdict",
      "No verified findings identified.",
      "## 2) Evidence Map",
      "File: `src/not-read.ts`",
      "Role: implementation",
      "Evidence: exported function",
      "Risk: runtime behavior",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response, {
      toolSources: [],
      fileContents: new Map(),
    });

    expect(result.valid).toBe(false);
    expect(result.violations[0]).toMatch(/without completed read evidence/);
  });

  it("rejects merged Evidence Map fields", () => {
    const response = [
      "## 1) Executive Verdict",
      "The inspected layers appear healthy.",
      "## 2) Evidence Map",
      "File: `src/example.ts` Role: implementation Evidence: Implements the handler Risk: runtime Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Evidence Map fields must be on separate lines; a file record combines multiple fields",
    );
  });

  it("rejects descriptive Evidence without a direct code reference", () => {
    const response = [
      "## 1) Executive Verdict",
      "The inspected layers appear healthy.",
      "## 2) Evidence Map",
      "File: `src/example.ts`",
      "Role: implementation",
      "Evidence: Implements the handler",
      "Risk: runtime",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Evidence Map Evidence must cite a code fragment, function reference, line number, or completed tool result",
    );
  });

  it("rebuilds descriptive Evidence records from complete source bodies", () => {
    const evidence = {
      toolSources: ["src/one.ts", "src/two.ts"],
      fileContents: new Map([
        ["src/one.ts", "export function one() { return true; }\n"],
        ["src/two.ts", "export const two = 2;\n"],
      ]),
    };
    const response = [
      "## 1) Executive Verdict",
      "The available evidence is insufficient.",
      "## 2) Evidence Map",
      "File: `src/one.ts`",
      "Role: implementation",
      "Evidence: Implements the handler",
      "Risk: runtime behavior",
      "Notes: FACT",
      "File: `src/two.ts`",
      "Role: implementation",
      "Evidence: Defines the value",
      "Risk: runtime behavior",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response, evidence);

    expect(result.valid).toBe(true);
    expect(result.response).toContain("completed read_file result");
    expect(result.response).toContain("File: `src/one.ts`");
    expect(result.response).toContain("File: `src/two.ts`");
    expect(applyForensicOutputContract(result.response, evidence)).toMatchObject({
      valid: true,
      violations: [],
    });
  });

  it("repairs a short six-section recovery response when the map omits many reads", () => {
    const paths = [
      "lib/knowledge-engine/src/queries.ts",
      "lib/knowledge-engine/src/inference.ts",
      "lib/knowledge-engine/src/types.ts",
      "lib/ai-orchestrator/src/groq-client.ts",
      "lib/ai-orchestrator/src/tool-execution-engine.ts",
      "lib/ai-orchestrator/src/agent-complete.ts",
    ];
    const evidence = {
      toolSources: paths,
      fileContents: new Map(
        paths.map((path, index) => [
          path,
          `export function inspected${index}() { return ${index}; }\n`,
        ]),
      ),
    };
    const response = [
      "## 1) Executive Verdict",
      "NOT PROVEN — the available evidence is insufficient.",
      "## 2) Evidence Map",
      "No verified evidence map was produced.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response, evidence);

    expect(result.valid).toBe(true);
    for (const path of paths) {
      expect(result.response).toContain(`File: \`${path}\``);
    }
    expect(applyForensicOutputContract(result.response, evidence)).toMatchObject({
      valid: true,
      violations: [],
    });
  });

  it("fails closed with a rebuilt map when stale paths survive a malformed recovery", () => {
    const evidence = {
      toolSources: [
        "lib/ai-orchestrator/src/groq-client.ts",
        "lib/ai-orchestrator/src/context-builder.ts",
      ],
      fileContents: new Map([
        [
          "lib/ai-orchestrator/src/groq-client.ts",
          "export function complete() { return true; }\n",
        ],
        [
          "lib/ai-orchestrator/src/context-builder.ts",
          "export function buildContext() { return {}; }\n",
        ],
      ]),
    };
    const response = [
      "## 1) Executive Verdict",
      "NOT PROVEN — the available evidence is insufficient.",
      "## 2) Evidence Map",
      "File: `openrouter/index.js`",
      "Role: implementation",
      "Evidence: `const stale = true`",
      "Risk: runtime behavior",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
    ].join("\n");

    const result = applyForensicOutputContract(response, evidence);

    expect(result.valid).toBe(true);
    expect(result.evidenceMapRebuilt).toBe(true);
    expect(result.response).toContain("## 5) Validation Checklist");
    expect(result.response).toContain("## 6) Final Judgment");
    expect(result.response).toContain("File: `lib/ai-orchestrator/src/groq-client.ts`");
    expect(result.response).toContain("File: `lib/ai-orchestrator/src/context-builder.ts`");
    expect(result.response).not.toContain("openrouter/index.js");
    expect(result.response).not.toContain("Evidence: `const stale = true`");
    expect(result.response).toContain("Completed source reads were preserved");
    expect(result.response).toContain("Evidence Map was rebuilt deterministically");
    expect(result.response).not.toContain("original model response was rejected");
    expect(applyForensicOutputContract(result.response, evidence)).toMatchObject({
      valid: true,
      violations: [],
    });
  });

  it("rejects an unverified quality score", () => {
    const response = [
      "## 1) Executive Verdict",
      "The system has a quality score of 91/100.",
      "## 2) Evidence Map",
      "No verified evidence map was produced.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "The report contains an unverified numeric score; cite a completed metric result or omit the number",
    );
  });

  it("rejects broad unverified quality claims in the Executive Verdict", () => {
    const response = [
      "## 1) Executive Verdict",
      "The codebase is well-structured with comprehensive functionality and robust error handling. No critical issues identified.",
      "## 2) Evidence Map",
      "No verified evidence map was produced.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Executive Verdict contains an unverified broad quality or completeness claim",
    );
  });

  it("rejects broad unverified quality claims written in Arabic", () => {
    const response = [
      "## 1) Executive Verdict",
      "النظام منظم بشكل جيد ويقدم وظائف شاملة، ولا توجد مشاكل حرجة.",
      "## 2) Evidence Map",
      "No verified evidence map was produced.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Executive Verdict contains an unverified broad quality or completeness claim",
    );
  });

  it("rejects broad quality claims outside Executive Verdict", () => {
    const response = [
      "## 1) Executive Verdict",
      "The inspected files contain no verified finding.",
      "## 2) Evidence Map",
      "File: `src/example.ts`",
      "Role: clean re-export pattern with sophisticated abstractions",
      "Evidence: `export function run() {}`",
      "Risk: None identified - robust implementation",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "Patch صغير. The codebase is production-ready with excellent architecture.",
    ].join("\n");

    const result = applyForensicOutputContract(response, {
      toolSources: ["src/example.ts"],
      fileContents: new Map([["src/example.ts", "export function run() {}\n"]]),
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Report contains an unverified broad quality or completeness claim outside an explicit NOT PROVEN/INFERENCE statement",
    );
  });

  it("allows broad terms when the report explicitly labels them as inference or not proven", () => {
    const response = [
      "## 1) Executive Verdict",
      "The available evidence is insufficient to establish production readiness.",
      "## 2) Evidence Map",
      "File: `src/example.ts`",
      "Role: implementation",
      "Evidence: `export function run() {}`",
      "Risk: Production-ready status is NOT PROVEN.",
      "Notes: NOT PROVEN",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — production readiness is not established by the inspected evidence.",
    ].join("\n");

    expect(
      applyForensicOutputContract(response, {
        toolSources: ["src/example.ts"],
        fileContents: new Map([["src/example.ts", "export function run() {}\n"]]),
      }).valid,
    ).toBe(true);
  });

  it("requires FACT Evidence Map records to match completed source reads", () => {
    const response = [
      "## 1) Executive Verdict",
      "The inspected file contains a verified implementation detail.",
      "## 2) Evidence Map",
      "File: `src/example.ts`",
      "Role: implementation",
      "Evidence: `const actual = true`",
      "Risk: runtime behavior",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response, {
      toolSources: ["src/example.ts"],
      fileContents: new Map([["src/example.ts", "const different = true;\n"]]),
    });

    expect(result.valid).toBe(true);
    expect(result.response).toContain("Evidence: completed read_file result;");
    expect(result.response).toContain("Notes: READ_CONFIRMED · NOT_BEHAVIORAL_PROOF");
  });

  it("rejects an unstructured finding that bypasses the finding ID grammar", () => {
    const response = [
      "## 1) Executive Verdict",
      "The available evidence is insufficient.",
      "## 2) Evidence Map",
      "No verified evidence map was produced.",
      "## 3) Findings",
      "Critical finding: the parser is unsafe and must be rewritten.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Findings contains an unstructured claim without a recognized finding ID",
    );
  });

  it("rejects a repair phase that is not linked to a recognized finding", () => {
    const response = [
      "## 1) Executive Verdict",
      "The available evidence is insufficient.",
      "## 2) Evidence Map",
      "No verified evidence map was produced.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "Phase 1: rewrite `src/parser.ts`",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Repair Plan phase must use `Phase N (F-XX):` and link to a Finding",
    );
  });

  it("rejects forensic sections that appear out of order", () => {
    const response = [
      "## 1) Executive Verdict",
      "The available evidence is insufficient.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 2) Evidence Map",
      "No verified evidence map was produced.",
      "## 4) Repair Plan",
      "No repair phases identified.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(response);

    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "Forensic report sections must appear in the required order",
    );
  });

  it("does not let one file's exact snippet prove a multi-file finding", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-01 · HIGH",
      "* File(s): `src/one.ts`, `src/two.ts`",
      "* Evidence: `const shared = true`",
      "* Why it matters: the shared condition is unsafe",
      "* Root cause: incorrect guard",
      "* Fix: change the guard",
      "",
      "## 4) Repair Plan",
      "Phase 1 (F-01): change the guard — `src/one.ts`",
    ].join("\n");

    const evidence = {
      toolSources: ["src/one.ts", "src/two.ts"],
      fileContents: new Map([
        ["src/one.ts", "const shared = true;\n"],
        ["src/two.ts", "const other = false;\n"],
      ]),
    };

    const result = applyForensicEvidenceGate(response, evidence);

    expect(result.response).toContain("F-01 · NOT PROVEN");
    expect(result.response).toContain("[BLOCKED: F-01 is NOT PROVEN");
  });

  it("keeps a complete report when malformed findings and phases are removed safely", () => {
    const response = [
      "## 1) Executive Verdict",
      "The inspected layers require further validation.",
      "No executable repair is accepted from the current evidence.",
      "## 2) Evidence Map",
      "File: `src/example.ts`",
      "Role: implementation",
      "Evidence: `const value = true`",
      "Risk: runtime behavior",
      "Notes: FACT",
      "## 3) Findings",
      "ID: F-01 · HIGH",
      "Evidence: an incomplete finding without the required file field",
      "## 4) Repair Plan",
      "Phase 1 (F-01): change the implementation",
      "## 5) Validation Checklist",
      "- Verify the proposed change",
      "## 6) Final Judgment",
      "Patch صغير / Refactor / إعادة تصميم — based on the inspected evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(
      response,
      readEvidence("src/example.ts", "const value = true;\n"),
    );
    expect(result.valid).toBe(true);
    expect(result.response).toContain("No verified finding identified");
    expect(result.response).toContain("No repair phases identified");
    expect(result.response).toContain("## 6) Final Judgment");
    expect(result.response).toContain("NOT PROVEN");
    expect(result.response).not.toContain("Phase 1 (F-01)");
  });

  it("removes unstructured findings and unknown repair IDs from rejected recovery output", () => {
    const response = [
      "## 1) Executive Verdict",
      "The available evidence is insufficient.",
      "## 2) Evidence Map",
      "File: `src/example.ts`",
      "Role: implementation",
      "Evidence: `const value = true`",
      "Risk: runtime behavior",
      "Notes: FACT",
      "## 3) Findings",
      "Critical finding: the parser is unsafe and must be rewritten.",
      "## 4) Repair Plan",
      "Phase 1 (F-001): rewrite the parser",
      "Phase 2 (F-002): add validation",
      "Phase 3 (F-003): run tests",
      "## 5) Validation Checklist",
      "- Verify the proposed changes",
      "## 6) Final Judgment",
      "Patch صغير / Refactor / إعادة تصميم — based on the inspected evidence.",
    ].join("\n");

    const result = applyForensicOutputContract(
      response,
      readEvidence("src/example.ts", "const value = true;\n"),
    );

    expect(result.valid).toBe(true);
    expect(result.response).toContain("No verified finding identified");
    expect(result.response).toContain("No repair phases identified");
    expect(result.response).not.toMatch(/Phase \d+ \(F-00[1-3]\)/);
    expect(result.response).not.toContain("Critical finding:");
  });

  it("keeps a finding whose cited snippet appears in a completed file read", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-01 · HIGH",
      "* File(s): `src/example.ts`",
      "* Evidence: `const retries = 2`",
      "* Why it matters: the configured retry count is used by the request path",
      "* Root cause: configuration mismatch",
      "* Fix: align the retry setting",
      "",
      "## 4) Repair Plan",
      "Phase 1 (F-01): align the retry setting — `src/example.ts`",
    ].join("\n");

    const result = applyForensicEvidenceGate(
      response,
      readEvidence("src/example.ts", "const retries = 2;\n"),
    );

    expect(result.violations).toEqual([]);
    expect(result.response).toContain("F-01 · HIGH");
    expect(result.response).not.toContain("NOT PROVEN");
  });

  it("downgrades a finding for a file that was not read", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-01 · HIGH",
      "* File(s): `src/missing.ts`",
      "* Evidence: `for (let attempt = 0; attempt <= maxRetries; attempt++)`",
      "* Why it matters: it may loop forever",
      "* Root cause: retry condition",
      "* Fix: change the comparison",
      "",
      "## 4) Repair Plan",
      "Phase 1 (F-01): change the comparison — `src/missing.ts`",
    ].join("\n");

    const result = applyForensicEvidenceGate(response, {
      toolSources: [],
      fileContents: new Map(),
    });

    expect(result.violations[0]?.findingId).toBe("F-01");
    expect(result.response).toContain("F-01 · NOT PROVEN");
    expect(result.response).toContain("[BLOCKED: F-01 is NOT PROVEN");
  });

  it("guards an unbulleted finding from the uploaded-report shape", () => {
    const response = [
      "## 3) Findings",
      "ID: F-01 · HIGH",
      "File(s): `src/missing.ts`",
      "Evidence: `const broken = true`",
      "Why it matters: the branch is always taken",
      "Root cause: incorrect condition",
      "Fix: change the condition",
      "",
      "## 4) Repair Plan",
      "Phase 1 (F-01): change the condition — `src/missing.ts`",
    ].join("\n");

    const result = applyForensicEvidenceGate(response, {
      toolSources: [],
      fileContents: new Map(),
    });

    expect(result.violations[0]?.findingId).toBe("F-01");
    expect(result.response).toContain("F-01 · NOT PROVEN");
  });

  it("rejects the known circular-reference JSON.parse claim", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-03 · HIGH",
      "* File(s): `src/parsing.ts`",
      "* Evidence: `JSON.parse(candidate)` without circular reference checks",
      "* Why it matters: circular JSON can overflow the stack",
      "* Root cause: unsafe parser",
      "* Fix: use a safer JSON parser",
    ].join("\n");

    const result = applyForensicEvidenceGate(
      response,
      readEvidence("src/parsing.ts", "return JSON.parse(candidate);\n"),
    );

    expect(result.response).toContain("F-03 · NOT PROVEN");
    expect(result.violations[0]?.reasons.join(" ")).toContain("circular object");
  });

  it("does not apply semantic false-positive rules without read source", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-03 · HIGH",
      "* File(s): `src/parsing.ts`",
      "* Evidence: `JSON.parse(candidate)` without circular reference checks",
      "* Why it matters: circular JSON can overflow the stack",
      "* Root cause: unsafe parser",
      "* Fix: use a safer JSON parser",
    ].join("\n");

    const result = applyForensicEvidenceGate(response, {
      toolSources: [],
      fileContents: new Map(),
    });

    expect(result.violations[0]?.reasons).toEqual([
      "the cited file/evidence was not verified by a completed read result",
    ]);
  });

  it("rejects the known buildSlice memory-growth claim", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-04 · MEDIUM",
      "* File(s): `src/context-object.ts`",
      "* Evidence: `buildSlice` creates slices without size limits",
      "* Why it matters: unbounded memory growth",
      "* Root cause: missing slice constraints",
      "* Fix: add maximum slice size",
    ].join("\n");

    const result = applyForensicEvidenceGate(
      response,
      readEvidence("src/context-object.ts", "export function buildSlice(id, content) {\n"),
    );

    expect(result.response).toContain("F-04 · NOT PROVEN");
    expect(result.violations[0]?.reasons.join(" ")).toContain("admission");
  });

  it("does not treat retry attempts as infinite when the continuation is bounded", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-01 · HIGH",
      "* File(s): `src/groq-client.ts`",
      "* Evidence: `for (let attempt = 0; attempt <= maxRetries; attempt++)`",
      "* Why it matters: could cause an infinite retry loop",
      "* Root cause: off-by-one retry condition",
      "* Fix: change attempt <= maxRetries to attempt < maxRetries",
    ].join("\n");

    const result = applyForensicEvidenceGate(
      response,
      readEvidence(
        "src/groq-client.ts",
        "for (let attempt = 0; attempt <= maxRetries; attempt++) {\n  if (attempt < maxRetries) continue;\n}\n",
      ),
    );

    expect(result.response).toContain("F-01 · NOT PROVEN");
    expect(result.violations[0]?.reasons.join(" ")).toContain("bounded");
  });

  it("does not treat an exported error type as proof that error handling is missing", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-01 · MEDIUM",
      "* File(s): `lib/ai-orchestrator/src/index.ts`",
      '* Evidence: `export { GroqClientError } from "./errors.js";`',
      "* Why it matters: no error handling was found in the orchestrator",
      "* Root cause: missing error handling",
      "* Fix: add comprehensive error handling",
    ].join("\n");

    const result = applyForensicEvidenceGate(
      response,
      readEvidence(
        "lib/ai-orchestrator/src/index.ts",
        'export { GroqClientError } from "./errors.js";\n',
      ),
    );

    expect(result.response).toContain("F-01 · NOT PROVEN");
    expect(result.violations[0]?.reasons.join(" ")).toContain(
      "exported error type does not prove",
    );
  });

  it("rejects an unlimited maxDepth claim when the inspected implementation is capped", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-01 · HIGH",
      "* File(s): `lib/knowledge-engine/src/queries.ts`",
      "* Evidence: `export async function getImpactedEntities(db: Db, entityId: string, maxDepth = 4)`",
      "* Why it matters: unlimited maxDepth enables DoS through graph traversal",
      "* Root cause: missing input validation and bounds checking",
      "* Fix: add maxDepth validation and a circuit breaker",
    ].join("\n");

    const result = applyForensicEvidenceGate(
      response,
      readEvidence(
        "lib/knowledge-engine/src/queries.ts",
        [
          "export async function getImpactedEntities(db: Db, entityId: string, maxDepth = 4) {",
          "  const depth = Math.min(maxDepth, 6);",
          "  while (frontier.length > 0 && currentDepth < depth) {",
          "    // bounded traversal",
          "  }",
          "}",
        ].join("\n"),
      ),
    );

    expect(result.response).toContain("F-01 · NOT PROVEN");
    expect(result.violations[0]?.reasons.join(" ")).toContain(
      "caps maxDepth at 6",
    );
  });

  it("does not treat a barrel export as proof that API security controls are missing", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-02 · HIGH",
      "* File(s): `lib/ai-orchestrator/src/index.ts`",
      '* Evidence: `export { complete, completeRaw, completeStream } from "./groq-client.js";`',
      "* Why it matters: completion functions are exposed without authentication or rate limiting",
      "* Root cause: missing security controls on external API integrations",
      "* Fix: implement authentication and rate limiting before export",
    ].join("\n");

    const result = applyForensicEvidenceGate(
      response,
      readEvidence(
        "lib/ai-orchestrator/src/index.ts",
        'export { complete, completeRaw, completeStream } from "./groq-client.js";\n',
      ),
    );

    expect(result.response).toContain("F-02 · NOT PROVEN");
    expect(result.violations[0]?.reasons.join(" ")).toContain(
      "barrel export does not establish",
    );
  });

  it("rejects a stale entityCount claim when the current admission source has no entityCount", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-02 · MEDIUM",
      "* File(s): `lib/ai-orchestrator/src/context-runtime/context-admission.ts`",
      "* Evidence: `entityCount: (() => { const ids = new Set<string>(); return ids.size; })()`",
      "* Why it matters: Runtime entity count always returns 0, breaking KG-06 requirements",
      "* Root cause: incomplete implementation",
      "* Fix: replace the placeholder with actual entity counting",
    ].join("\n");

    const result = applyForensicEvidenceGate(
      response,
      readEvidence(
        "lib/ai-orchestrator/src/context-runtime/context-admission.ts",
        [
          "export function runAdmission(plan: ContextPlan, executionPlan: ExecutionPlan): ContextObject {",
          "  const budget = { remaining: plan.budgetTokens };",
          "  return { plan, admittedSlices: [], referenceSlices: [], deferredSlices: [], droppedSlices: [] };",
          "}",
        ].join("\n"),
      ),
    );

    expect(result.response).toContain("F-02 · NOT PROVEN");
    expect(result.violations[0]?.reasons.join(" ")).toContain(
      "entityCount implementation is absent",
    );
  });

  it("does not call a logged graceful fallback silent", () => {
    const response = [
      "## 3) Findings",
      "* ID: F-03 · MEDIUM",
      "* File(s): `lib/ai-orchestrator/src/context-loader.ts`",
      "* Evidence: `return fallback; inside catch block in safeLoad`",
      "* Why it matters: silently returns empty defaults and hides critical failures",
      "* Root cause: overly broad error handling",
      "* Fix: add specific error handling and alerting",
    ].join("\n");

    const result = applyForensicEvidenceGate(
      response,
      readEvidence(
        "lib/ai-orchestrator/src/context-loader.ts",
        [
          "catch (err) {",
          "  console.warn(JSON.stringify({ code: 'QUERY_DEGRADED', error: String(err) }));",
          "  return fallback;",
          "}",
        ].join("\n"),
      ),
    );

    expect(result.response).toContain("F-03 · NOT PROVEN");
    expect(result.violations[0]?.reasons.join(" ")).toContain(
      "fallback path emits structured console telemetry",
    );
  });

  it("keeps a DIRECT_READ-pinned primary target admissible despite bogus text-derived roots", () => {
    // Regression for FIRST_EVIDENCE_UNAVAILABLE: a run that names one explicit
    // file (DIRECT_READ) but whose classifier also derived a text-imagined roots
    // list (e.g. "defect/repair" parsed from a question's prose) previously had
    // its only completed source body dropped at admissibility, starving the run.
    const pinnedPath = "lib/ai-orchestrator/src/agent-complete.ts";
    const bogusTextRoots = ["defect/repair", "Finding/Repair"];
    const evidence = collectForensicEvidence(
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "read-1", function: { name: "read_file", arguments: JSON.stringify({ path: pinnedPath }) } },
          ],
        },
        {
          role: "tool",
          tool_call_id: "read-1",
          content: `File: ${pinnedPath}\`\`\`\nexport async function agentComplete() { return "ok"; }\n\`\`\``,
        },
      ],
      [pinnedPath],
      new Map([[pinnedPath, 'export async function agentComplete() { return "ok"; }\n']]),
      false,
      // The scope chat-agent derives from the FEG gate: roots from the text,
      // but the DIRECT_READ primary target pinned in `admit`.
      { roots: bogusTextRoots, admit: [pinnedPath] },
    );

    expect(evidence.fileContents.has(pinnedPath)).toBe(true);
    expect(evidence.fileContents.size).toBe(1);
    expect(evidence.incompleteFiles?.size ?? 0).toBe(0);
  });
});