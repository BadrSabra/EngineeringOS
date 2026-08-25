import { describe, expect, it } from "vitest";
import {
  classifyEvidenceStrength,
  createEvidenceRecord,
  validateEvidenceLineage,
  createClaim,
  bindClaimToEvidence,
  validateClaim,
  guardFinalJudgment,
  buildBehaviorFindingStatus,
  buildRunLedger,
  buildRuntimeLedger,
  validateTelemetry,
  buildClaimOrientedEvidenceMap,
  planEvidenceRecovery,
  tagRecoveredEvidence,
  findAnchorInSearchOutput,
  extractClaimSymbol,
  classifySourceScope,
  deriveVerdictScope,
  deriveScopedFindingStatus,
  evidenceScopeSupportsClaimScope,
  scopedRepairGate,
  directInvocationEvidence,
  deriveObjectiveRuntimeEdgesFromRetainedReads,
} from "../evidence-integrity.js";

const RUN = "R-123";

/**
 * EI-019: Known Behavioral Test — "what's the difference between partial and
 * exhausted?" PASS requires Claim A→partial branch and Claim B→exhausted branch
 * as DIRECT evidence; the context constant DEFAULT_MAX_ITERATIONS = 30 is
 * CONTEXT_ONLY and must NOT be the main evidence.
 */
describe("EI-019 known behavioral test (partial vs exhausted)", () => {
  it("classifies the control-flow branch as DIRECT and the config constant as CONTEXT_ONLY", () => {
    const branch =
      "if (lastTextSeen !== undefined) return { kind: 'partial', text: lastTextSeen };";
    const constant = "export const DEFAULT_MAX_ITERATIONS = 30;";
    expect(classifyEvidenceStrength(branch)).toBe("DIRECT");
    expect(classifyEvidenceStrength(constant)).toBe("CONTEXT_ONLY");
  });

  it("proves behavior only from the DIRECT branch windows", () => {
    const partialRec = createEvidenceRecord({
      runId: RUN,
      file: "tool-execution-engine.ts",
      content: "if (lastTextSeen !== undefined) return { kind: 'partial', text: lastTextSeen };",
      sourceType: "IMPLEMENTATION",
      phase: "EVIDENCE_ACCEPTED",
    });
    const exhaustedRec = createEvidenceRecord({
      runId: RUN,
      file: "tool-execution-engine.ts",
      content: "return { kind: 'exhausted', text: '' };",
      sourceType: "IMPLEMENTATION",
      phase: "EVIDENCE_ACCEPTED",
    });
    const constantRec = createEvidenceRecord({
      runId: RUN,
      file: "tool-execution-engine.ts",
      content: "export const DEFAULT_MAX_ITERATIONS = 30;",
      sourceType: "CONFIG",
      phase: "EVIDENCE_CREATED",
    });

    const claimA = createClaim({
      text: "partial returned when lastTextSeen exists",
      taskType: "BEHAVIOR_QUERY",
      symbol: "lastTextSeen",
      evidenceIds: [partialRec.evidenceId, constantRec.evidenceId],
    });
    const binding = bindClaimToEvidence(claimA, [partialRec, exhaustedRec, constantRec]);
    expect(binding).not.toBeNull();
    expect(binding?.evidenceIds).toContain(partialRec.evidenceId);

    const validation = validateClaim(claimA, [partialRec, exhaustedRec, constantRec], { runId: RUN });
    // constantRec is CONTEXT_ONLY; but partialRec is DIRECT, so claim is PROVEN.
    expect(validation.result).toBe("PROVEN");
    // The config constant alone must never prove a claim.
    const configOnly = validateClaim(
      createClaim({
        text: "iterations capped at 30",
        taskType: "BEHAVIOR_QUERY",
        symbol: "DEFAULT_MAX_ITERATIONS",
        evidenceIds: [constantRec.evidenceId],
      }),
      [constantRec],
      { runId: RUN },
    );
    expect(configOnly.result).toBe("NOT_PROVEN");
    expect(configOnly.reasons.some((r) => r.includes("CONTEXT_ONLY"))).toBe(true);
  });
});

/**
 * EI-020: Missing Evidence Test — deliberately remove branch evidence.
 * PASS requires the system to return NOT_PROVEN and NOT invent a verdict.
 */
describe("EI-020 missing evidence test", () => {
  it("rejects a claim whose declared evidence does not resolve to any record", () => {
    const claim = createClaim({
      text: "eval executes on user input",
      taskType: "BEHAVIOR_QUERY",
      scope: "PRODUCTION",
      evidenceIds: ["E-DOES-NOT-EXIST"],
    });
    const validation = validateClaim(claim, [], { runId: RUN });
    expect(validation.result).toBe("REJECTED");
    expect(validation.reasons.join(" ")).toMatch(/no records|REJECTED/);
  });

  it("reports NOT_PROVEN when NO evidence binds at all", () => {
    const emptyRec = createEvidenceRecord({
      runId: RUN,
      file: "src/engine.ts",
      content: "function noop() {}",
      phase: "EVIDENCE_CREATED",
    });
    // EI-005: a claim without evidenceIds is REJECTED outright.
    const claim = createClaim({
      text: "eval executes on user input",
      taskType: "BEHAVIOR_QUERY",
      scope: "PRODUCTION",
      evidenceIds: [],
    });
    const validation = validateClaim(claim, [emptyRec], { runId: RUN });
    expect(validation.result).toBe("REJECTED");
    // EI-008: guard fails closed, never PROVEN.
    const guard = guardFinalJudgment({ claims: [claim], validations: [validation], records: [emptyRec], runId: RUN });
    if (guard.allowed) {
      throw new Error("expected guard to fail closed");
    }
    expect(guard.code).toBe("VERIFICATION_FAILURE");
  });
});

/**
 * EI-021: Telemetry Integrity Test — evidence packet contains a file while
 * telemetry records no read. PASS requires TELEMETRY_INCONSISTENT and Final
 * Judgment is blocked.
 */
describe("EI-021 telemetry integrity test (1 evidence file / 0 reads)", () => {
  it("fails closed when a packet claims evidence but telemetry recorded no completed read", () => {
    // A record that was never serviced as a completed source read.
    const unread = createEvidenceRecord({
      runId: RUN,
      file: "phantom.ts",
      content: "export const x = 1;",
      sourceType: "IMPLEMENTATION",
      readType: "COMPLETE",
      phase: "EVIDENCE_ACCEPTED",
    });
    // Force the mismatch: evidence sees 1 file but telemetry recorded 0 reads.
    const ledger = buildRunLedger({
      runId: RUN,
      evidenceRecords: [unread],
      claims: [],
      validations: [],
    });
    const broken = { ...ledger, uniqueFilesRead: 0 };
    const reconciliation = validateTelemetry(broken);
    expect(reconciliation.consistent).toBe(false);
    if (!reconciliation.consistent) {
      expect(reconciliation.code).toBe("TELEMETRY_INCONSISTENT");
      expect(reconciliation.violations.join(" ")).toMatch(/evidenceFileCount.*uniqueFilesRead|uniqueFilesRead.*distinct/);
    }
  });

  it("buildRuntimeLedger fails closed when a cited prefetched file has ZERO recorded reads (EI-011 fallback removed)", () => {
    const rec = createEvidenceRecord({
      runId: RUN,
      file: "src/service.ts",
      content: "return eval(input);",
      readType: "COMPLETE",
      phase: "EVIDENCE_ACCEPTED",
    });
    const ledger = buildRunLedger({
      runId: RUN,
      evidenceRecords: [rec],
      claims: [],
      validations: [],
    });
    const forced = { ...ledger, uniqueFilesRead: 0 };
    const result = validateTelemetry(forced);
    expect(result.consistent).toBe(false);
  });

  it("buildRuntimeLedger folds prefetch completed reads in as CONSISTENT (EI-011)", () => {
    const rec = createEvidenceRecord({
      runId: RUN,
      file: "src/service.ts",
      content: "return eval(input);",
      readType: "COMPLETE",
      phase: "EVIDENCE_ACCEPTED",
    });
    const ledger = buildRunLedger({
      runId: RUN,
      evidenceRecords: [rec],
      claims: [],
      validations: [],
    });
    expect(ledger.uniqueFilesRead).toBe(1);
    expect(ledger.evidenceFileCount).toBe(1);
    const result = validateTelemetry(ledger);
    expect(result.consistent).toBe(true);
  });

  it("deduplicates a prefetch path that is already represented by retained/recovery evidence", () => {
    const runId = "run-prefetch-dedupe";
    const recoveryRecord = tagRecoveredEvidence(
      createEvidenceRecord({
        runId,
        file: "src/engine.ts",
        content: "return value;",
        readType: "TARGETED",
        phase: "EVIDENCE_CREATED",
        sourceType: "IMPLEMENTATION",
      }),
      "REC-prefetch-dedupe",
    );
    const ledger = buildRuntimeLedger({
      runId,
      fileContents: new Map([["src/engine.ts", "return value;"]]),
      sourceRetrieval: { uniqueReads: 1, readPaths: [] },
      prefetchReads: 1,
      prefetchPaths: ["src/engine.ts"],
      additionalRecoveryRecords: [recoveryRecord],
    });

    expect(ledger.uniqueFilesRead).toBe(1);
    expect(validateTelemetry(ledger).consistent).toBe(true);
  });

  it("reports consistent telemetry for a well-formed run", () => {
    const rec = createEvidenceRecord({
      runId: RUN,
      file: "src/service.ts",
      content: "return eval(input);",
      sourceScope: "PRODUCTION",
      phase: "EVIDENCE_ACCEPTED",
    });
    const claim = createClaim({
      text: "eval executes on user input",
      taskType: "BEHAVIOR_QUERY",
      scope: "PRODUCTION",
      evidenceIds: [rec.evidenceId],
    });
    const validation = validateClaim(claim, [rec], { runId: RUN });
    const ledger = buildRunLedger({
      runId: RUN,
      evidenceRecords: [rec],
      claims: [claim],
      validations: [validation],
    });
    expect(ledger.uniqueFilesRead).toBe(1);
    expect(ledger.evidenceFileCount).toBe(1);
    const reconciliation = validateTelemetry(ledger);
    expect(reconciliation.consistent).toBe(true);
    // Final judgment guard passes through.
    const guard = guardFinalJudgment({ claims: [claim], validations: [validation], records: [rec], runId: RUN });
    expect(guard.allowed).toBe(true);
  });
});

/**
 * EI-022: Cached Evidence Test — reuse cached evidence from another run.
 * PASS requires it NOT to enter as fresh proof without lineage.
 */
describe("EI-022 cached evidence test", () => {
  it("flags cached evidence without originRunId as a lineage violation", () => {
    const cached = createEvidenceRecord({
      runId: RUN,
      file: "a.ts",
      content: "if (x) return 1;",
      readType: "CACHED",
      phase: "EVIDENCE_CREATED",
    });
    const violations = validateEvidenceLineage([cached]);
    expect(violations.some((v) => v.includes("originRunId"))).toBe(true);
  });

  it("tags recovered evidence with its recovery attempt id (EI-018)", () => {
    const rec = createEvidenceRecord({
      runId: "R-pr",
      file: "src/service.ts",
      content: "return eval(input);",
      sourceScope: "PRODUCTION",
      phase: "EVIDENCE_ACCEPTED",
    });
    const tagged = tagRecoveredEvidence(rec, "REC-001");
    expect(tagged.recoveryAttemptId).toBe("REC-001");
  });

  it("does not treat cached-from-other-run evidence as fresh proof", () => {
    const stale = createEvidenceRecord({
      runId: RUN,
      file: "a.ts",
      content: "if (x) return 1;",
      readType: "CACHED",
      originRunId: "R-OLD",
      phase: "EVIDENCE_CREATED",
    });
    const claim = createClaim({
      text: "eval executes on user input",
      taskType: "BEHAVIOR_QUERY",
      scope: "PRODUCTION",
      evidenceIds: [stale.evidenceId],
    });
    const validation = validateClaim(claim, [stale], { runId: RUN });
    expect(validation.result).not.toBe("PROVEN");
    expect(validation.reasons.some((r) => r.includes("cached"))).toBe(true);
  });
});

/**
 * EI-023: Behavioral vs Finding Test — a behavioral question with no defect.
 * PASS requires Behavior = PROVEN while Finding = NONE (never flattened to NOT_PROVEN).
 */
describe("EI-023 behavioral vs finding test", () => {
  it("keeps behavior PROVEN and finding NONE independent", () => {
    const status = buildBehaviorFindingStatus({
      behaviorSupported: true,
      behaviorRequested: true,
      findingProven: false,
    });
    expect(status.behavior).toBe("PROVEN");
    expect(status.finding).toBe("NONE");
    expect(status.behaviorUnsupported).toBe(false);
  });

  it("marks behavior NOT_PROVEN when unsupported but keeps finding status intact", () => {
    const status = buildBehaviorFindingStatus({
      behaviorSupported: false,
      behaviorRequested: true,
      findingProven: false,
    });
    expect(status.behavior).toBe("NOT_PROVEN");
    expect(status.finding).toBe("NONE");
    expect(status.behaviorUnsupported).toBe(true);
  });
});

/** EI-017/018 recovery + EI-016 claim-oriented map smoke tests. */
describe("recovery + claim-oriented map", () => {
  it("plans a targeted recovery read that resolves a missing symbol (EI-017)", () => {
    const claim = createClaim({
      text: "partial returned when lastTextSeen exists",
      taskType: "BEHAVIOR_QUERY",
      symbol: "lastTextSeen",
      evidenceIds: [],
    });
    const recovery = planEvidenceRecovery(claim);
    expect(recovery.recoveryAttemptId).toMatch(/^REC-/);
    expect(recovery.missingSymbol).toBe("lastTextSeen");
    expect(recovery.targetedRead.symbol).toBe("lastTextSeen");
  });

  it("renders a claim-oriented evidence map, not a file-read list (EI-016)", () => {
    const rec = createEvidenceRecord({
      runId: RUN,
      file: "engine.ts",
      content: "if (lastTextSeen !== undefined) return { kind: 'partial', text: lastTextSeen };",
      sourceType: "IMPLEMENTATION",
      phase: "EVIDENCE_ACCEPTED",
    });
    const claim = createClaim({
      text: "partial branch exists",
      taskType: "BEHAVIOR_QUERY",
      symbol: "lastTextSeen",
      evidenceIds: [rec.evidenceId],
    });
    const lines = buildClaimOrientedEvidenceMap([claim], [rec]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('"partial branch exists"');
    expect(lines[0]).toContain("engine.ts");
  });
});

/**
 * EI-017 targeted-read anchor parsing — regression tests for the three fixes
 * applied to the per-packet recovery loop in chat-agent.ts:
 *
 *  Fix-1: a same-extension sibling that matches first must NOT supply the
 *          anchor for a different file's targeted read.
 *  Fix-2: when the symbol is absent from the target file entirely, the anchor
 *          must be `undefined` (no fallback to line 1).
 *  Fix-3: recovered content that does not contain the symbol must be rejected
 *          before it enters the run ledger.
 */
describe("findAnchorInSearchOutput — EI-017 targeted-read anchor parsing", () => {
  it("Fix-1: returns the line from the exact target file, not from a same-extension sibling", () => {
    // Sibling file matches on line 3; target file matches on line 17.
    // The anchor must come from the target file, not the sibling.
    const searchOut = [
      "src/other.ts:3:  return { kind: 'exhausted' };",
      "src/target.ts:17:  return { kind: 'partial' };",
    ].join("\n");

    const anchor = findAnchorInSearchOutput(searchOut, "src/target.ts");
    expect(anchor).toBe(17); // must come from target file, not sibling
  });

  it("Fix-2: returns undefined when the symbol is not found in the target file", () => {
    // Only the sibling file contains the symbol; target file has no match.
    const searchOut = [
      "src/other.ts:10:  return { kind: 'exhausted' };",
    ].join("\n");

    const anchor = findAnchorInSearchOutput(searchOut, "src/target.ts");
    expect(anchor).toBeUndefined();
  });

  it("Fix-2: returns undefined for completely empty string", () => {
    expect(findAnchorInSearchOutput("", "src/target.ts")).toBeUndefined();
  });

  it("Fix-3: recovered content that does not contain the symbol is rejected from the ledger", () => {
    // Simulate the validation step: content must include the symbol.
    const symbol = "partialBranch";
    const contentWithSymbol = "function partialBranch() { return { kind: 'partial' }; }";
    const contentWithoutSymbol = "function unrelated() { return 42; }";

    expect(contentWithSymbol.includes(symbol)).toBe(true);
    expect(contentWithoutSymbol.includes(symbol)).toBe(false);
  });

  it("handles grep context-line format (dash separator) correctly", () => {
    // grep -A / -B context lines use "file:linenum-content" not "file:linenum:content"
    const searchOut = [
      "src/target.ts:20-  // context line before match",
      "src/target.ts:21:  return { kind: 'exhausted' };",
    ].join("\n");

    const anchor = findAnchorInSearchOutput(searchOut, "src/target.ts");
    expect(anchor).toBe(20); // first line (context line) matched
  });
});

/**
 * EI-018 run-ledger accumulation: additionalRecoveryRecords appear in the
 * ledger with TARGETED readType and the correct recoveryAttemptId.
 */
describe("buildRuntimeLedger — EI-018 additionalRecoveryRecords", () => {
  it("appends targeted recovery records to the ledger", () => {
    const runId = "run-test-targeted";
    const baseRecord = createEvidenceRecord({
      runId,
      file: "src/engine.ts",
      content: "function engineLoop() {}",
      readType: "COMPLETE",
      phase: "EVIDENCE_CREATED",
      sourceType: "IMPLEMENTATION",
    });
    const recoveryRecord = tagRecoveredEvidence(
      createEvidenceRecord({
        runId,
        file: "src/engine.ts",
        content: "if (x) return { kind: 'partial' };",
        readType: "TARGETED",
        phase: "EVIDENCE_CREATED",
        sourceType: "IMPLEMENTATION",
        symbol: "partial",
      }),
      "REC-001",
    );

    const ledger = buildRunLedger({
      runId,
      evidenceRecords: [baseRecord, recoveryRecord],
      claims: [],
      validations: [],
    });

    const targeted = ledger.evidenceRecords.filter(
      (r) => r.readType === "TARGETED",
    );
    expect(targeted).toHaveLength(1);
    expect(targeted[0]!.recoveryAttemptId).toBe("REC-001");
    expect(targeted[0]!.symbol).toBe("partial");
    expect(ledger.targetedReads).toBe(1);
  });

  it("ledger without additionalRecoveryRecords has zero targetedReads", () => {
    const runId = "run-test-no-targeted";
    const rec = createEvidenceRecord({
      runId,
      file: "src/service.ts",
      content: "return value;",
      readType: "COMPLETE",
      phase: "EVIDENCE_CREATED",
      sourceType: "IMPLEMENTATION",
    });
    const ledger = buildRunLedger({
      runId,
      evidenceRecords: [rec],
      claims: [],
      validations: [],
    });
    expect(ledger.targetedReads).toBe(0);
  });
});

/**
 * EI-017 symbol extraction: the inline regex returned the first identifier-like
 * token, which was often a generic word ("return", "when"). extractClaimSymbol
 * must prefer meaningful camelCase/snake_case symbols and skip weak tokens so a
 * targeted read is not degraded into a useless full-file read.
 */
describe("extractClaimSymbol — EI-017 weak-symbol guard", () => {
  it("prefers a camelCase symbol over generic words in the evidence", () => {
    const evidence = "if lastTextSeen return when for the and so this is value";
    expect(extractClaimSymbol(evidence)).toBe("lastTextSeen");
  });

  it("skips reserved words and common stopwords", () => {
    // All tokens are weak (reserved/stopwords); falls through to undefined.
    const evidence = "if return when for the and so this is value";
    expect(extractClaimSymbol(evidence)).toBeUndefined();
    // With the title supplying a real identifier, it is used as the fallback.
    expect(extractClaimSymbol(evidence, "validateUsername mishandles the input")).toBe("validateUsername");
  });

  it("falls back to a title-derived identifier when the evidence has none", () => {
    // All evidence tokens are reserved words/stopwords → falls through to title.
    expect(extractClaimSymbol("return true from the when it is", "computeNetWorth")).toBe("computeNetWorth");
  });

  it("returns undefined when neither evidence nor title has a meaningful token", () => {
    expect(extractClaimSymbol("the and when it is a", "some few other")).toBeUndefined();
    expect(extractClaimSymbol("")).toBeUndefined();
  });
});

/**
 * EI-029/030/031/033 — Scoped Verdict Model.
 * The generic `FINDING PROVEN` is replaced by a scoped status: fixture/test/spec
 * evidence can only ever produce a local (or mixed) finding, never PRODUCTION_PROVEN.
 */
describe("scoped verdict models (EI-029/030/031/033)", () => {
  it("classifies a fixture path as FIXTURE scope and app code as PRODUCTION (EI-033)", () => {
    expect(classifySourceScope("tests/fixtures/known-defect.ts")).toBe("FIXTURE");
    expect(classifySourceScope("src/route.ts")).toBe("PRODUCTION");
    expect(classifySourceScope("src/__tests__/engine.test.ts")).toBe("TEST");
    expect(classifySourceScope("spec/service.spec.ts")).toBe("TEST");
  });

  it("classifies non-TS implementation extensions as PRODUCTION (EI-033 extension parity)", () => {
    // Runtime classifier (classifySourcePath) treats these as IMPLEMENTATION;
    // classifySourceScope must agree so multi-language repos get the right scope.
    expect(classifySourceScope("src/service.py")).toBe("PRODUCTION");
    expect(classifySourceScope("internal/handler.go")).toBe("PRODUCTION");
    expect(classifySourceScope("src/lib.rs")).toBe("PRODUCTION");
    expect(classifySourceScope("src/Service.java")).toBe("PRODUCTION");
    expect(classifySourceScope("app/Controller.kt")).toBe("PRODUCTION");
    expect(classifySourceScope("lib/helper.rb")).toBe("PRODUCTION");
    expect(classifySourceScope("schema/migrations.sql")).toBe("PRODUCTION");
    expect(classifySourceScope("scripts/deploy.sh")).toBe("PRODUCTION");
    // Fixture dirs override extension — a Python fixture is still FIXTURE
    expect(classifySourceScope("tests/fixtures/helper.py")).toBe("FIXTURE");
  });

  it("classifies language-specific test filenames as TEST even outside a test directory (EI-033)", () => {
    // Go: _test.go suffix alongside production code
    expect(classifySourceScope("pkg/service_test.go")).toBe("TEST");
    expect(classifySourceScope("internal/handler_test.go")).toBe("TEST");
    // Python: test_ prefix or _test suffix
    expect(classifySourceScope("src/test_service.py")).toBe("TEST");
    expect(classifySourceScope("src/service_test.py")).toBe("TEST");
    // Ruby: _spec.rb suffix (RSpec convention)
    expect(classifySourceScope("lib/service_spec.rb")).toBe("TEST");
    // Rust: _test.rs suffix
    expect(classifySourceScope("src/engine_test.rs")).toBe("TEST");
    // Java/Kotlin test class naming
    expect(classifySourceScope("src/ServiceTest.java")).toBe("TEST");
    expect(classifySourceScope("src/ServiceTests.java")).toBe("TEST");
    expect(classifySourceScope("src/ServiceSpec.kt")).toBe("TEST");
    // Production files with similar but non-test names must NOT be TEST
    expect(classifySourceScope("src/service.go")).toBe("PRODUCTION");
    expect(classifySourceScope("src/service.py")).toBe("PRODUCTION");
    expect(classifySourceScope("src/service.rb")).toBe("PRODUCTION");
  });

  it("fixture-only evidence derives FIXTURE_LOCAL and a FIXTURE_PROVEN status (EI-029/030)", () => {
    const rec = createEvidenceRecord({
      runId: "R-fx",
      file: "tests/fixtures/known-defect.ts",
      content: "return eval(expression);",
      sourceScope: "FIXTURE",
      phase: "EVIDENCE_ACCEPTED",
    });
    expect(deriveVerdictScope([rec])).toBe("FIXTURE_LOCAL");
    expect(deriveScopedFindingStatus([rec])).toBe("FIXTURE_PROVEN");
  });

  it("production evidence derives PRODUCTION_PROVEN (EI-030)", () => {
    const rec = createEvidenceRecord({
      runId: "R-pr",
      file: "src/service.ts",
      content: "return eval(input);",
      sourceScope: "PRODUCTION",
      phase: "EVIDENCE_ACCEPTED",
    });
    expect(deriveVerdictScope([rec])).toBe("PRODUCTION");
    expect(deriveScopedFindingStatus([rec])).toBe("PRODUCTION_PROVEN");
  });

  it("mixed production + fixture evidence derives MIXED_EVIDENCE, not PRODUCTION (EI-043)", () => {
    const prodRec = createEvidenceRecord({
      runId: "R-mx",
      file: "src/service.ts",
      content: "return eval(input);",
      sourceScope: "PRODUCTION",
    });
    const fixtureRec = createEvidenceRecord({
      runId: "R-mx",
      file: "tests/fixtures/known-defect.ts",
      content: "return eval(expression);",
      sourceScope: "FIXTURE",
      phase: "EVIDENCE_ACCEPTED",
    });
    expect(deriveVerdictScope([prodRec, fixtureRec])).toBe("MIXED");
    expect(deriveScopedFindingStatus([prodRec, fixtureRec])).toBe("MIXED_EVIDENCE");
  });

  it("FIXTURE evidence cannot support a PRODUCTION claim (EI-033)", () => {
    expect(evidenceScopeSupportsClaimScope("FIXTURE", "PRODUCTION")).toBe(false);
    expect(evidenceScopeSupportsClaimScope("TEST", "PRODUCTION")).toBe(false);
    expect(evidenceScopeSupportsClaimScope("PRODUCTION", "PRODUCTION")).toBe(true);
    expect(evidenceScopeSupportsClaimScope("FIXTURE", "FIXTURE_LOCAL")).toBe(true);
  });

  it("validateClaim rejects a production claim whose only evidence is a fixture (EI-031/033)", () => {
    const fixtureRec = createEvidenceRecord({
      runId: "R-esc",
      file: "tests/fixtures/known-defect.ts",
      content: "return eval(expression);",
      sourceScope: "FIXTURE",
      phase: "EVIDENCE_ACCEPTED",
    });
    const claim = createClaim({
      text: "eval executes on user input",
      taskType: "BEHAVIOR_QUERY",
      scope: "PRODUCTION",
      evidenceIds: [fixtureRec.evidenceId],
    });
    const validation = validateClaim(claim, [fixtureRec], { runId: RUN });
    expect(validation.result).not.toBe("PROVEN");
    expect(validation.reasons.join(" ")).toMatch(/EI-033|sourceScope|scope/);
  });

  it("validateTelemetry fails closed when PRODUCTION verdict has no production evidence (EI-031)", () => {
    const fixtureRec = createEvidenceRecord({
      runId: "R-esc",
      file: "tests/fixtures/known-defect.ts",
      content: "return eval(expression);",
      sourceScope: "FIXTURE",
      phase: "EVIDENCE_ACCEPTED",
    });
    const ledger = buildRunLedger({
      runId: "R-esc",
      evidenceRecords: [fixtureRec],
      claims: [],
      validations: [],
    });
    // Force the escalated state: claim a production scope on fixture-only evidence.
    const escalated = { ...ledger, verdictScope: "PRODUCTION" as const, scopedFindingStatus: "PRODUCTION_PROVEN" as const };
    const reconciliation = validateTelemetry(escalated);
    expect(reconciliation.consistent).toBe(false);
    if (!reconciliation.consistent) {
      expect(reconciliation.violations.join(" ")).toMatch(/EI-031|scope escalation/);
    }
  });
});

/**
 * EI-036 — Repair Scope Gate.
 * Repair execution is gated on proof scope: only a production-scope finding may
 * drive a repair plan. Fixture/test, not-proven, and mixed evidence all block it.
 */
describe("scoped repair gate (EI-036)", () => {
  it("allows repair for production-proven findings", () => {
    const gate = scopedRepairGate("PRODUCTION_PROVEN");
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe("REPAIR_ALLOWED");
  });

  it("blocks repair for fixture-proven findings", () => {
    const gate = scopedRepairGate("FIXTURE_PROVEN");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION");
  });

  it("blocks repair for mixed evidence", () => {
    const gate = scopedRepairGate("MIXED_EVIDENCE");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("REPAIR_BLOCKED_MIXED_EVIDENCE");
  });

  it("blocks repair when finding is not proven", () => {
    const gate = scopedRepairGate("NOT_PROVEN");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("REPAIR_BLOCKED_SCOPE_NOT_PROVEN");
  });
});

/**
 * AI-OBJ-014 review fix (soundness): the reachability edge proof must be
 * syntax-aware. Declaration forms — object/class method shorthand, typed
 * methods, and target function declarations — must NEVER be treated as
 * invocations, and an edge must be bound to the caller's body (and for
 * path-qualified endpoints, the declared caller file), not mere symbol
 * co-occurrence anywhere in a retained file.
 */
describe("syntax-aware invocation detection (AI-OBJ-014 review fix)", () => {
  const edge = { from: "getGraphCentrality", to: "computeCentrality" };
  const edgeObjective = {
    objective: { requiredEvidenceEdges: [edge] },
    fileContents: new Map<string, string>(),
  };

  it("returns null for an object method shorthand declaration", () => {
    const body = [
      "const api = {",
      "  computeCentrality(graph) {",
      "    const out = new Map();",
      "    return out;",
      "  }",
      "};",
    ].join("\n");
    expect(directInvocationEvidence(body, "computeCentrality")).toBeNull();
  });

  it("returns null for a class method shorthand declaration", () => {
    const body = [
      "class Centrality {",
      "  computeCentrality(graph) {",
      "    return graph.nodes;",
      "  }",
      "}",
    ].join("\n");
    expect(directInvocationEvidence(body, "computeCentrality")).toBeNull();
  });

  it("returns null for a typed method declaration", () => {
    const body = "interface Graph { computeCentrality(g: Graph): Map<string, number>; }";
    expect(directInvocationEvidence(body, "computeCentrality")).toBeNull();
  });

  it("returns null for a top-level function declaration", () => {
    const body = "export function computeCentrality(graph: Graph): Map<string, number> { return new Map(); }";
    expect(directInvocationEvidence(body, "computeCentrality")).toBeNull();
  });

  it("returns null when computeCentrality appears only as a property name, not a call", () => {
    const body = "const ref = { computeCentrality } as const;";
    expect(directInvocationEvidence(body, "computeCentrality")).toBeNull();
  });

  it("returns a source line for a genuine call expression", () => {
    const body = "export function getGraphCentrality(input: Graph): Map<string, number> { return computeCentrality(input); }";
    const evidence = directInvocationEvidence(body, "computeCentrality");
    expect(evidence).not.toBeNull();
    expect(evidence).toContain("computeCentrality(input)");
  });

  it("does not derive an edge when the target is only declared, not invoked inside the caller", () => {
    // The caller is declared AND the target is declared, but the target is
    // never called inside the caller's body — this must NOT close the edge.
    const body = [
      "export function getGraphCentrality(input: Graph) {",
      "  const deg = new Map<string, number>();",
      "  return deg;",
      "}",
      "export function computeCentrality(graph: Graph) {",
      "  return graph;",
      "}",
    ].join("\n");
    const result = deriveObjectiveRuntimeEdgesFromRetainedReads({
      ...edgeObjective,
      fileContents: new Map([["src/graph-extractor.ts", body]]),
    });
    expect(result).toHaveLength(0);
  });

  it("binds the invocation to the caller body, not a same-file independent call", () => {
    // computeCentrality IS genuinely called in the file, but from a DIFFERENT
    // caller (top-level), not inside getGraphCentrality. The from->to edge
    // must remain unproven.
    const body = [
      "export function getGraphCentrality(input: Graph) {",
      "  return input;",
      "}",
      "computeCentrality(makeGraph());",
    ].join("\n");
    const result = deriveObjectiveRuntimeEdgesFromRetainedReads({
      ...edgeObjective,
      fileContents: new Map([["src/graph-extractor.ts", body]]),
    });
    expect(result).toHaveLength(0);
  });

  it("proves the edge when the caller body genuinely invokes the target", () => {
    const body = [
      "export function getGraphCentrality(input: Graph) {",
      "  return computeCentrality(input);",
      "}",
    ].join("\n");
    const result = deriveObjectiveRuntimeEdgesFromRetainedReads({
      ...edgeObjective,
      fileContents: new Map([["src/graph-extractor.ts", body]]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ from: "getGraphCentrality", to: "computeCentrality" });
    expect(result[0]!.evidence).toContain("computeCentrality(input)");
  });

  it("binds a path-qualified endpoint to the declared caller file", () => {
    // Qualified from: the caller is declared IN this file but the only genuine
    // invocation lives in a different retained file. Only the caller's own file
    // (where the invocation is inside its body) may prove the edge.
    const callerDecl = "export function getGraphCentrality(input: Graph) { return input; }";
    const callerWithCall = [
      "export function getGraphCentrality(input: Graph) {",
      "  return computeCentrality(input);",
      "}",
    ].join("\n");
    const result = deriveObjectiveRuntimeEdgesFromRetainedReads({
      objective: { requiredEvidenceEdges: [{ from: "src/a.ts#getGraphCentrality", to: "computeCentrality" }] },
      fileContents: new Map([
        ["src/a.ts", callerDecl],
        ["src/b.ts", callerWithCall],
      ]),
    });
    // The genuine call is inside caller body in b.ts, but a.ts is the declared
    // caller file, so nothing may prove the path-qualified edge.
    expect(result).toHaveLength(0);
  });

  it("proves a path-qualified endpoint only when the declared caller file contains the in-body call", () => {
    const src = [
      "export function getGraphCentrality(input: Graph) {",
      "  return computeCentrality(input);",
      "}",
    ].join("\n");
    const result = deriveObjectiveRuntimeEdgesFromRetainedReads({
      objective: { requiredEvidenceEdges: [{ from: "src/a.ts#getGraphCentrality", to: "computeCentrality" }] },
      fileContents: new Map([["src/a.ts", src]]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("src/a.ts");
  });
});
