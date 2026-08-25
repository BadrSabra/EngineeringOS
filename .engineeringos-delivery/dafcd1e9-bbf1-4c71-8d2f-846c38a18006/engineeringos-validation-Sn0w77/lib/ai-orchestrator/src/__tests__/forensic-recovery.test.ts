import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_FORENSIC_RECOVERY_ENVELOPE,
  buildSourceGroundedNoFindingEnvelope,
  buildStructuredForensicReport,
  buildExecutableRepairPlan,
  hasSourceGroundedNoFindingBasis,
  mergeForensicRecoveryEnvelopes,
  validateStructuredForensicRecovery,
  type ForensicRecoveryEnvelope,
} from "../forensic-recovery.js";

const sourcePath = "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts";
const source = readFileSync(new URL("./fixtures/known-defect.ts", import.meta.url), "utf8");

const evidence = {
  toolSources: [sourcePath],
  fileContents: new Map([[sourcePath, source]]),
  allowTestSources: true,
};

describe("staged forensic Recovery", () => {
  it("keeps Arabic empty-result classifications and the six-section contract", () => {
    const envelope: ForensicRecoveryEnvelope = {
      verdict: "NO_FINDING",
      findings: [],
      repairPlan: [],
      validationChecklist: [],
    };
    const completedEvidence = {
      ...evidence,
      sourceCoverage: { complete: true, roots: [] },
    };
    const incompleteEvidence = {
      ...completedEvidence,
      sourceCoverage: { complete: false, roots: [] },
    };
    const unreadableEvidence = {
      toolSources: [sourcePath],
      fileContents: new Map<string, string>(),
      allowTestSources: true,
      sourceCoverage: { complete: false, roots: [] },
    };

    const reports = [
      buildStructuredForensicReport(envelope, completedEvidence, {
        language: "ar",
      }),
      buildStructuredForensicReport(envelope, incompleteEvidence, {
        language: "ar",
      }),
      buildStructuredForensicReport(envelope, unreadableEvidence, {
        language: "ar",
      }),
    ];

    expect(reports[0]).toContain("NO_VERIFIED_FINDING");
    expect(reports[0]).not.toContain("ANALYSIS_INCOMPLETE");
    expect(reports[1]).toContain("ANALYSIS_INCOMPLETE");
    expect(reports[2]).toContain("ANALYSIS_INCOMPLETE");

    const headers = [
      "## 1) Executive Verdict",
      "## 2) Evidence Map",
      "## 3) Findings",
      "## 4) Repair Plan",
      "## 5) Validation Checklist",
      "## 6) Final Judgment",
    ];
    for (const report of reports) {
      const positions = headers.map((header) => report.indexOf(header));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      for (const header of headers) {
        expect(report.match(new RegExp(header.replace(/[()[\]]/g, "\\$&"), "g"))).toHaveLength(1);
      }
      expect(report).not.toContain("recovery-model");
      expect(report).not.toContain("initial-model");
      expect(report).not.toContain("recoveryAttemptId");
    }
  });

  it("keeps a cancelled Arabic audit incomplete and exposes blocked Recovery in Repair Plan", () => {
    const report = buildStructuredForensicReport(
      {
        verdict: "NO_FINDING",
        findings: [],
        repairPlan: [],
        validationChecklist: [],
      },
      {
        ...evidence,
        sourceCoverage: { complete: false, roots: [] },
      },
      {
        emptyVerdict: "ANALYSIS_INCOMPLETE",
        language: "ar",
        cancelled: true,
      },
    );

    expect(report).toContain("ANALYSIS_INCOMPLETE");
    expect(report).toContain("Recovery needed");
    expect(report).toContain("Blocked by");
    expect(report).not.toContain("NO_VERIFIED_FINDING");
    expect(report.match(/## [1-6]\)/g)).toHaveLength(6);
  });

  it("builds a six-section report and keeps an evidence-linked repair phase", () => {
    const envelope: ForensicRecoveryEnvelope = {
      verdict: "FINDING_PROVEN",
      findings: [{
        id: "F-01",
        title: "Dynamic evaluation executes untrusted input",
        files: [sourcePath],
        evidence: "`return eval(expression);`",
        whyItMatters: "Input can execute arbitrary code.",
        rootCause: "The implementation evaluates the caller-provided string directly.",
        fix: "Replace dynamic evaluation with an allow-listed parser.",
      }],
      repairPlan: [{
        findingId: "F-01",
        steps: ["Replace eval with an allow-listed parser.", "Add a regression test."],
      }],
      validationChecklist: ["Run the focused security test and the full orchestrator suite."],
    };

    const result = validateStructuredForensicRecovery(envelope, evidence);

    expect(result.accepted).toBe(true);
    expect(result.verdict).toBe("FINDING_PROVEN");
    expect(result.violations).toEqual([]);
    expect(result.report).toContain("ID: F-01 · Dynamic evaluation executes untrusted input");
    expect(result.report).toContain("`return eval(expression);`");
    expect(result.report).toContain("Why it matters: Input can execute arbitrary code.");
    expect(result.report).toContain("Root cause: The implementation evaluates the caller-provided string directly.");
    expect(result.report).toContain("Fix: Replace dynamic evaluation with an allow-listed parser.");
    expect(result.report).toContain("Phase 1 (F-01):");
    expect(result.report).toContain(`File(s): \`${sourcePath}\``);
    expect(result.report).toContain("Run the focused security test");
    expect(result.report).toContain("FINDING PROVEN");
    expect(result.report).toContain("exact evidence linked to an accepted Finding");
    expect(result.report).toContain(
      "exact Finding evidence: `return eval(expression);`",
    );
    expect(result.report).not.toContain("no behavioral inference made");
    expect(result.report).not.toContain("no executable finding was accepted");
    expect(result.report).toContain("## 6) Final Judgment");
  });

  it("does not discard a valid Finding because the server generated the Evidence Map", () => {
    const envelope: ForensicRecoveryEnvelope = {
      findings: [{
        id: "F-01",
        title: "Dynamic evaluation executes untrusted input",
        files: [sourcePath],
        evidence: "`return eval(expression);`",
        whyItMatters: "Input can execute arbitrary code.",
        rootCause: "The implementation evaluates the caller-provided string directly.",
        fix: "Replace dynamic evaluation with an allow-listed parser.",
      }],
      repairPlan: [{ findingId: "F-01", steps: ["Replace dynamic evaluation."] }],
      validationChecklist: ["Run the focused security test."],
    };

    const result = validateStructuredForensicRecovery(envelope, evidence);

    expect(result.accepted).toBe(true);
    expect(result.violations).not.toContain(
      "Evidence Map was rebuilt deterministically instead of accepting the structured report",
    );
    expect(result.report).toContain("Phase 1 (F-01): Replace dynamic evaluation.");
  });

  it("adds the registered validation profile to an executable ai-orchestrator phase", () => {
    const sourceFile = "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts";
    const result = validateStructuredForensicRecovery(
      {
        verdict: "FINDING_PROVEN",
        findings: [{
          id: "F-01",
          title: "Dynamic evaluation executes untrusted input",
          files: [sourceFile],
          evidence: "`return eval(expression);`",
          whyItMatters: "Input can execute arbitrary code.",
          rootCause: "The implementation evaluates the caller-provided string directly.",
          fix: "Replace dynamic evaluation with an allow-listed parser.",
        }],
        repairPlan: [{
          findingId: "F-01",
          steps: ["Replace dynamic evaluation with an allow-listed parser."],
        }],
        validationChecklist: ["PASS: the focused evaluator security regression test rejects hostile expressions."],
      },
      {
        ...evidence,
        toolSources: [sourceFile],
        fileContents: new Map([[sourceFile, source]]),
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.report).toContain(`File(s): \`${sourceFile}\``);
    expect(result.report).toContain("Validation profile: ai-orchestrator-tests");
  });

  it("returns structured execution metadata derived from the Finding and completed reads", () => {
    const sourceFile = "lib/ai-orchestrator/src/forensic-recovery.ts";
    const result = buildExecutableRepairPlan(
      {
        verdict: "FINDING_PROVEN",
        findings: [{
          id: "F-01",
          title: "Unsafe repair handoff",
          files: [sourceFile],
          evidence: "`buildExecutableRepairPlan`",
          whyItMatters: "Unverified paths could become write targets.",
          rootCause: "The plan does not carry verified file metadata.",
          fix: "Attach the verified file and validation profile to the phase.",
        }],
        repairPlan: [{
          findingId: "F-01",
          files: [sourceFile],
          steps: ["Attach the verified file and update the handoff."],
          validationProfile: "ai-orchestrator-tests",
        }],
        validationChecklist: ["PASS: run the focused orchestrator tests."],
      },
      {
        toolSources: [sourceFile],
        fileContents: new Map([[sourceFile, "export function buildExecutableRepairPlan() {}"]]),
      },
    );

    expect(result.violations).toEqual([]);
    expect(result.plans).toEqual([{
      findingId: "F-01",
      files: [sourceFile],
      steps: ["Attach the verified file and update the handoff."],
      validationProfile: "ai-orchestrator-tests",
    }]);
  });

  it("rejects phase files outside the Finding and files without a registered profile", () => {
    const result = buildExecutableRepairPlan(
      {
        verdict: "FINDING_PROVEN",
        findings: [{
          id: "F-01",
          title: "Scoped defect",
          files: ["src/known.ts"],
          evidence: "`unsafe()`",
          whyItMatters: "The behavior is unsafe.",
          rootCause: "The implementation accepts untrusted input.",
          fix: "Replace the unsafe operation.",
        }],
        repairPlan: [
          {
            findingId: "F-01",
            files: ["src/other.ts"],
            steps: ["Replace the unsafe operation."],
            validationProfile: "ai-orchestrator-tests",
          },
          {
            findingId: "F-01",
            files: ["src/known.ts"],
            steps: ["Replace the unsafe operation."],
          },
        ],
        validationChecklist: ["PASS: run the focused test."],
      },
      {
        toolSources: ["src/known.ts", "src/other.ts"],
        fileContents: new Map([
          ["src/known.ts", "unsafe()"],
          ["src/other.ts", "unsafe()"],
        ]),
      },
    );

    expect(result.plans).toEqual([]);
    expect(result.violations).toEqual([
      "Repair phase F-01 names a file outside its Finding",
      "Repair phase F-01 is duplicated; each Finding requires one linked phase",
    ]);
  });

  it("downgrades a proven Finding when its Repair Plan phase is missing", () => {
    const result = validateStructuredForensicRecovery(
      {
        verdict: "FINDING_PROVEN",
        findings: [{
          id: "F-01",
          title: "Dynamic evaluation executes untrusted input",
          files: [sourcePath],
          evidence: "`return eval(expression);`",
          whyItMatters: "Input can execute arbitrary code.",
          rootCause: "The implementation evaluates the caller-provided string directly.",
          fix: "Replace dynamic evaluation with an allow-listed parser.",
        }],
        repairPlan: [],
        validationChecklist: ["The security regression rejects hostile expressions."],
      },
      evidence,
    );

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NOT_PROVEN");
    expect(result.violations.join(" ")).toContain("no linked Repair Plan phase");
    expect(result.report).toContain("NOT PROVEN");
    expect(result.report).toContain("No repair phases are authorized");
  });

  it("rejects a generic validation checklist even when the phase is executable", () => {
    const result = validateStructuredForensicRecovery(
      {
        verdict: "FINDING_PROVEN",
        findings: [{
          id: "F-01",
          title: "Dynamic evaluation executes untrusted input",
          files: [sourcePath],
          evidence: "`return eval(expression);`",
          whyItMatters: "Input can execute arbitrary code.",
          rootCause: "The implementation evaluates the caller-provided string directly.",
          fix: "Replace dynamic evaluation with an allow-listed parser.",
        }],
        repairPlan: [{
          findingId: "F-01",
          steps: ["Replace dynamic evaluation with an allow-listed parser."],
        }],
        validationChecklist: ["Run the focused test."],
      },
      evidence,
    );

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NOT_PROVEN");
    expect(result.violations.join(" ")).toContain("Validation Checklist is generic");
  });

  it("rejects an orphan Repair Plan phase and does not expose it as executable", () => {
    const result = validateStructuredForensicRecovery(
      {
        verdict: "FINDING_PROVEN",
        findings: [{
          id: "F-01",
          title: "Dynamic evaluation executes untrusted input",
          files: [sourcePath],
          evidence: "`return eval(expression);`",
          whyItMatters: "Input can execute arbitrary code.",
          rootCause: "The implementation evaluates the caller-provided string directly.",
          fix: "Replace dynamic evaluation with an allow-listed parser.",
        }],
        repairPlan: [{
          findingId: "F-99",
          files: [sourcePath],
          steps: ["Replace the unsafe behavior."],
          validationProfile: "ai-orchestrator-tests",
        }],
        validationChecklist: ["The orchestrator regression rejects the unsafe behavior."],
      },
      evidence,
    );

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NOT_PROVEN");
    expect(result.violations.join(" ")).toContain("unknown finding F-99");
    expect(result.violations.join(" ")).toContain("F-01 has no linked Repair Plan phase");
    expect(result.report).not.toContain("Phase 1 (F-99)");
  });

  it("renders the repair lifecycle status explicitly", () => {
    const envelope: ForensicRecoveryEnvelope = {
      verdict: "FINDING_PROVEN",
      findings: [{
        id: "F-01",
        title: "Dynamic evaluation executes untrusted input",
        files: [sourcePath],
        evidence: "`return eval(expression);`",
        whyItMatters: "Input can execute arbitrary code.",
        rootCause: "The implementation evaluates the caller-provided string directly.",
        fix: "Replace dynamic evaluation with an allow-listed parser.",
      }],
      repairPlan: [{
        findingId: "F-01",
        steps: ["Replace dynamic evaluation with an allow-listed parser."],
      }],
      validationChecklist: ["The evaluator security regression rejects hostile expressions."],
    };

    expect(buildStructuredForensicReport(envelope, evidence)).toContain("PROPOSED");
    expect(buildStructuredForensicReport(envelope, evidence, { repairStatus: "APPLIED" }))
      .toContain("APPLIED");
    expect(
      buildStructuredForensicReport(envelope, evidence, {
        repairStatus: "BEHAVIORALLY_VALIDATED",
      }),
    ).toContain("BEHAVIORALLY VALIDATED");
  });

  it("rejects phase files outside the declared forensic scope", () => {
    const sourceFile = "lib/ai-orchestrator/src/forensic-recovery.ts";
    const result = buildExecutableRepairPlan(
      {
        verdict: "FINDING_PROVEN",
        findings: [{
          id: "F-01",
          title: "Scoped defect",
          files: [sourceFile],
          evidence: "`buildExecutableRepairPlan`",
          whyItMatters: "The scope must be enforced.",
          rootCause: "The phase could otherwise escape the requested audit scope.",
          fix: "Reject phase files outside the scope.",
        }],
        repairPlan: [{
          findingId: "F-01",
          files: [sourceFile],
          steps: ["Reject files outside the declared scope."],
          validationProfile: "ai-orchestrator-tests",
        }],
        validationChecklist: ["PASS: run the focused test."],
      },
      {
        toolSources: [sourceFile],
        fileContents: new Map([[sourceFile, "export function buildExecutableRepairPlan() {}"]]),
        scope: { files: ["lib/ai-orchestrator/src/agents/chat-agent.ts"] },
      },
    );

    expect(result.plans).toEqual([]);
    expect(result.violations).toEqual([
      "Repair phase F-01 names a file outside the forensic scope",
    ]);
  });

  it("rejects a packet Finding during global revalidation when another root is incomplete", () => {
    const globallyIncompleteEvidence = {
      ...evidence,
      sourceCoverage: {
        complete: false,
        roots: [
          {
            root: "src",
            discoveredFiles: 1,
            readFiles: 1,
            unreadFiles: 0,
            status: "COMPLETE" as const,
          },
          {
            root: "lib",
            discoveredFiles: 2,
            readFiles: 1,
            unreadFiles: 1,
            status: "PARTIAL" as const,
          },
        ],
        reason: "The requested forensic scope was only partially read: lib=PARTIAL (1/2)",
      },
    };
    const envelope: ForensicRecoveryEnvelope = {
      verdict: "FINDING_PROVEN",
      findings: [{
        id: "F-01",
        title: "Dynamic evaluation executes untrusted input",
        files: [sourcePath],
        evidence: "`return eval(expression);`",
        whyItMatters: "Input can execute arbitrary code.",
        rootCause: "The implementation evaluates the caller-provided string directly.",
        fix: "Replace dynamic evaluation with an allow-listed parser.",
      }],
      repairPlan: [{ findingId: "F-01", steps: ["Replace dynamic evaluation."] }],
      validationChecklist: ["Run the focused security test."],
    };

    const result = validateStructuredForensicRecovery(envelope, globallyIncompleteEvidence);

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NOT_PROVEN");
    expect(result.violations.join(" ")).toContain("partially read");
    expect(result.report).toContain("ID: F-01 · NOT PROVEN");
    expect(result.report).toContain("[BLOCKED: F-01 is NOT PROVEN");
  });

  it("does not treat an empty envelope as an accepted Recovery report", () => {
    const result = validateStructuredForensicRecovery(
      EMPTY_FORENSIC_RECOVERY_ENVELOPE,
      evidence,
    );

    expect(result.accepted).toBe(false);
    expect(result.violations).toEqual([
      "Structured Recovery produced no directly proven Finding",
    ]);
    expect(result.verdict).toBe("NO_FINDING");
  });

  it("accepts an explicit NO_FINDING verdict without treating it as a provider failure", () => {
    const result = validateStructuredForensicRecovery(
      {
        verdict: "NO_FINDING",
        findings: [],
        repairPlan: [],
        validationChecklist: [],
      },
      evidence,
    );

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NO_FINDING");
    expect(result.report).toContain("NO_VERIFIED_FINDING — no verified defect was established");
    expect(result.report).toContain("graph-empty:");
    expect(result.report).toContain("invalid-relationship:");
    expect(result.report).toContain("missing-provenance:");
    expect(result.report).toContain("nonexistent-node:");
    expect(result.report).toContain("This is an evidence-limited conclusion, not proof that the implementation is correct.");
  });

  it("requires a source-grounded negative basis for objective-aware NO_FINDING", () => {
    const result = validateStructuredForensicRecovery(
      {
        verdict: "NO_FINDING",
        findings: [],
        repairPlan: [],
        validationChecklist: [],
        noFindingBasis: `known-defect.ts was inspected, but the fragment \`return true;\` does not establish the requested behavior.`,
      },
      evidence,
      { requireNoFindingBasis: true },
    );

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NOT_PROVEN");
    expect(result.violations).toEqual([
      "NO_FINDING recovery requires a source-grounded noFindingBasis naming the inspected file and quoting an exact source fragment",
    ]);
  });

  it("accepts an objective-aware NO_FINDING only with an exact negative basis", () => {
    const basis = `known-defect.ts contains \`export function evaluateUserExpression(expression: string): unknown {\`, but this fragment does not establish the requested behavioral defect.`;
    expect(hasSourceGroundedNoFindingBasis(basis, evidence)).toBe(true);

    const result = validateStructuredForensicRecovery(
      {
        verdict: "NO_FINDING",
        findings: [],
        repairPlan: [],
        validationChecklist: [],
        noFindingBasis: basis,
      },
      evidence,
      { requireNoFindingBasis: true },
    );

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NO_FINDING");
    expect(result.report).toContain(
      "This is an evidence-limited conclusion, not proof that the implementation is correct.",
    );
    expect(result.report).toContain(`Basis: ${basis}`);
  });

  it("builds a source-grounded NO_FINDING envelope from complete implementation reads", () => {
    const result = buildSourceGroundedNoFindingEnvelope({
      ...evidence,
      fileContents: new Map([[
        "src/clean.ts",
        "export function inspect(value: string): string {\n  return value.trim();\n}\n",
      ]]),
      toolSources: ["src/clean.ts"],
    });

    expect(result).not.toBeNull();
    expect(result?.verdict).toBe("NO_FINDING");
    expect(result?.findings).toEqual([]);
    expect(result?.repairPlan).toEqual([]);
    expect(result?.noFindingBasis).toContain("src/clean.ts");
    expect(result?.noFindingBasis).toContain("`export function inspect(value: string): string {`");
    expect(
      hasSourceGroundedNoFindingBasis(result?.noFindingBasis, {
        ...evidence,
        fileContents: new Map([[
          "src/clean.ts",
          "export function inspect(value: string): string {\n  return value.trim();\n}\n",
        ]]),
      }),
    ).toBe(true);
  });

  it("does not build a deterministic NO_FINDING envelope from incomplete or test-only reads", () => {
    expect(
      buildSourceGroundedNoFindingEnvelope({
        ...evidence,
        sourceCoverage: {
          complete: false,
          roots: [{
            root: "src",
            discoveredFiles: 2,
            readFiles: 1,
            unreadFiles: 1,
            status: "PARTIAL",
          }],
        },
      }),
    ).toBeNull();

    expect(
      buildSourceGroundedNoFindingEnvelope({
        ...evidence,
        allowTestSources: false,
        fileContents: new Map([[
          "src/__tests__/clean.test.ts",
          "export function inspect(): boolean { return true; }\n",
        ]]),
      }),
    ).toBeNull();
  });

  it("does not accept or expose a no-defect claim based only on purity or absent side effects", () => {
    const basis =
      "known-defect.ts contains `export function evaluateUserExpression(expression: string): unknown {`, " +
      "and the function is pure with no side effects, so the implementation is correct and not a defect.";

    expect(hasSourceGroundedNoFindingBasis(basis, evidence)).toBe(false);

    const result = validateStructuredForensicRecovery(
      {
        verdict: "NO_FINDING",
        findings: [],
        repairPlan: [],
        validationChecklist: [],
        noFindingBasis: basis,
      },
      evidence,
      { requireNoFindingBasis: true },
    );

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NOT_PROVEN");
    expect(result.report).toContain("This is an evidence-limited conclusion, not proof that the implementation is correct.");
    expect(result.report).not.toContain("the function is pure with no side effects");
    expect(result.report).not.toContain("so the implementation is correct and not a defect");
  });

  it("rejects a contradictory NO_FINDING envelope instead of exposing its repair phase", () => {
    const result = validateStructuredForensicRecovery(
      {
        verdict: "NO_FINDING",
        findings: [{
          id: "F-01",
          title: "Contradictory candidate",
          files: [sourcePath],
          evidence: "`return eval(expression);`",
          whyItMatters: "The candidate claims a defect.",
          rootCause: "The envelope contradicts its own verdict.",
          fix: "Do not execute this phase.",
        }],
        repairPlan: [{ findingId: "F-01", steps: ["Do not execute."] }],
        validationChecklist: [],
      },
      evidence,
    );

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NOT_PROVEN");
    expect(result.violations).toContain(
      "NO_FINDING envelope cannot contain Findings or repair phases",
    );
    expect(result.report).toContain("No repair phases identified");
    expect(result.report).not.toContain("Do not execute.");
  });

  it("blocks a candidate whose cited evidence is not present in the completed read", () => {
    const envelope: ForensicRecoveryEnvelope = {
      findings: [{
        id: "F-01",
        title: "Unverified defect",
        files: [sourcePath],
        evidence: "`return definitelyMissing();`",
        whyItMatters: "The alleged behavior could be unsafe.",
        rootCause: "The alleged code path was not found.",
        fix: "Change the alleged code path.",
      }],
      repairPlan: [{
        findingId: "F-01",
        steps: ["Change the alleged code path."],
      }],
      validationChecklist: ["Run a focused regression test."],
    };

    const result = validateStructuredForensicRecovery(envelope, evidence);

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NOT_PROVEN");
    expect(result.violations.join(" ")).toContain("not verified");
    expect(result.report).toContain("F-01");
    expect(result.report).toContain("[BLOCKED: F-01 is NOT PROVEN");
  });

  it("does not invent a phase for an unknown finding id", () => {
    const envelope: ForensicRecoveryEnvelope = {
      ...EMPTY_FORENSIC_RECOVERY_ENVELOPE,
      findings: [{
        id: "F-01",
        title: "Read-only observation",
        files: [sourcePath],
        evidence: "`export function dangerous`",
        whyItMatters: "The function is exposed to callers.",
        rootCause: "No defect is established by this read alone.",
        fix: "No change is proposed without a proven defect.",
      }],
      repairPlan: [{
        findingId: "F-02",
        steps: ["Invented phase must not be emitted."],
      }],
    };

    const report = buildStructuredForensicReport(envelope, evidence);

    expect(report).toContain("## 3) Findings");
    expect(report).toContain("No repair phases identified because no executable Finding was accepted.");
    expect(report).not.toContain("Invented phase must not be emitted.");
  });

  it("merges packet findings with globally unique ids and linked phases", () => {
    const merged = mergeForensicRecoveryEnvelopes([
      {
        verdict: "FINDING_PROVEN",
        findings: [{
          id: "F-01",
          title: "alpha finding",
          files: ["alpha.ts"],
          evidence: "`return alpha;`",
          whyItMatters: "The alpha behavior is unsafe.",
          rootCause: "Alpha root cause.",
          fix: "Fix alpha.",
        }],
        repairPlan: [{ findingId: "F-01", steps: ["Apply alpha fix."] }],
        validationChecklist: ["Validate alpha."],
      },
      {
        verdict: "FINDING_PROVEN",
        findings: [{
          id: "F-01",
          title: "beta finding",
          files: ["beta.ts"],
          evidence: "`return beta;`",
          whyItMatters: "The beta behavior is unsafe.",
          rootCause: "Beta root cause.",
          fix: "Fix beta.",
        }],
        repairPlan: [{ findingId: "F-01", steps: ["Apply beta fix."] }],
        validationChecklist: ["Validate beta."],
      },
    ]);

    expect(merged.verdict).toBe("FINDING_PROVEN");
    expect(merged.findings.map((finding) => finding.id)).toEqual(["F-1", "F-2"]);
    expect(merged.repairPlan.map((phase) => phase.findingId)).toEqual(["F-1", "F-2"]);
    expect(merged.validationChecklist).toEqual(["Validate alpha.", "Validate beta."]);
  });

  it("preserves the surviving packet envelope when one packet throws on findings access", () => {
    const goodEnvelope: ForensicRecoveryEnvelope = {
      verdict: "FINDING_PROVEN",
      findings: [{
        id: "F-01",
        title: "beta finding",
        files: ["beta.ts"],
        evidence: "`return beta;`",
        whyItMatters: "The beta behavior is unsafe.",
        rootCause: "Beta root cause.",
        fix: "Fix beta.",
      }],
      repairPlan: [{ findingId: "F-01", steps: ["Apply beta fix."] }],
      validationChecklist: ["Validate beta."],
    };

    // Simulate an envelope whose findings getter throws a TypeError at
    // runtime — the kind of crash observed with the knowledge-engine
    // evidence packet.  Throw before any mutation so shared state stays clean.
    const crashingEnvelope = {} as ForensicRecoveryEnvelope;
    Object.defineProperty(crashingEnvelope, "findings", {
      get() { throw new TypeError("Cannot read properties of undefined (simulated packet crash)"); },
      enumerable: true,
      configurable: true,
    });

    const merged = mergeForensicRecoveryEnvelopes([crashingEnvelope, goodEnvelope]);

    // The crashing envelope is skipped entirely; the good envelope's Finding
    // must still appear with a globally unique ID.
    expect(merged.verdict).toBe("FINDING_PROVEN");
    expect(merged.findings.map((f) => f.id)).toEqual(["F-1"]);
    expect(merged.findings[0]?.title).toBe("beta finding");
    expect(merged.repairPlan.map((p) => p.findingId)).toEqual(["F-1"]);
    expect(merged.validationChecklist).toEqual(["Validate beta."]);
  });

  it("does not leave partial findings in the merged result when repairPlan iteration throws", () => {
    const goodEnvelope: ForensicRecoveryEnvelope = {
      verdict: "FINDING_PROVEN",
      findings: [{
        id: "F-01",
        title: "alpha finding",
        files: ["alpha.ts"],
        evidence: "`return alpha;`",
        whyItMatters: "The alpha behavior is unsafe.",
        rootCause: "Alpha root cause.",
        fix: "Fix alpha.",
      }],
      repairPlan: [{ findingId: "F-01", steps: ["Apply alpha fix."] }],
      validationChecklist: ["Validate alpha."],
    };

    // Envelope whose findings are valid but repairPlan iteration throws.
    // This exercises the mid-iteration partial-mutation path: findings would
    // already be read before repairPlan throws.
    const crashOnPlanEnvelope = {
      findings: [{
        id: "F-01",
        title: "crashing finding — must not appear",
        files: ["crash.ts"],
        evidence: "`return crash;`",
        whyItMatters: "Must not be merged.",
        rootCause: "Crash root cause.",
        fix: "Fix crash.",
      }],
      validationChecklist: [],
      noFindingBasis: undefined,
    } as unknown as ForensicRecoveryEnvelope;
    Object.defineProperty(crashOnPlanEnvelope, "repairPlan", {
      get() { throw new TypeError("repairPlan access crashed (simulated)"); },
      enumerable: true,
      configurable: true,
    });

    const merged = mergeForensicRecoveryEnvelopes([crashOnPlanEnvelope, goodEnvelope]);

    // The crashing envelope's partial findings must NOT appear in the result.
    expect(merged.findings.map((f) => f.title)).not.toContain("crashing finding — must not appear");
    // The good envelope's Finding must still be present.
    expect(merged.findings.map((f) => f.title)).toContain("alpha finding");
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.id).toBe("F-1");
    expect(merged.repairPlan.map((p) => p.findingId)).toEqual(["F-1"]);
  });

  it("keeps an all-empty packet merge as NO_FINDING with no repair plan", () => {
    const merged = mergeForensicRecoveryEnvelopes([
      {
        verdict: "NO_FINDING",
        findings: [],
        repairPlan: [],
        validationChecklist: [],
        noFindingBasis: "alpha.ts contains `const alpha = true;` and does not prove the requested defect.",
      },
      {
        verdict: "NO_FINDING",
        findings: [],
        repairPlan: [],
        validationChecklist: [],
        noFindingBasis: "beta.ts contains `const beta = true;` and does not prove the requested defect.",
      },
    ]);

    expect(merged.verdict).toBe("NO_FINDING");
    expect(merged.findings).toEqual([]);
    expect(merged.repairPlan).toEqual([]);
    expect(merged.noFindingBasis).toContain("alpha.ts");
    expect(merged.noFindingBasis).toContain("beta.ts");
  });
});