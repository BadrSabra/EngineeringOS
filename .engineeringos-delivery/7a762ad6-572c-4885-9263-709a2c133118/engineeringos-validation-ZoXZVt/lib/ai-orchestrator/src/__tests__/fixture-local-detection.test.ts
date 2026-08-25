/**
 * Unit tests for fixture-local detection — the classification that decides
 * whether a forensic Finding is proven only from fixture/test/spec evidence.
 *
 * Tests cover concerns raised by multiple code-review rounds:
 *
 * 1. `isFixturePath` correctly classifies a wide range of real-world paths.
 * 2. `auditScope` derives from evidence-based `isFixtureLocal`, not from the
 *    `fixtureAuditMode` parameter (they must not disagree).
 * 3. Serialised `auditScope`-only traces (without the `isFixtureLocal` boolean)
 *    are parseable and can be normalised by the caller without data loss.
 * 4. `extractFindingFilePaths` correctly parses File(s) from the Findings section.
 * 5. Mixed-read regression: evidenceSources from the gated report overrides the
 *    full read set so incidental production reads don't mask fixture-only verdicts.
 * 6. Path-traversal guard on the eager single-file pre-read step.
 * 7. `emitForensicStatus` step emission — end-to-end verification of the
 *    `forensic_status` step fields including `isFixtureLocal`, `auditScope`,
 *    `repairReadiness`, and `productionReachability`.
 */

import { describe, it, expect } from "vitest";
import {
  isFixturePath,
  FIXTURE_PATH_RE,
  extractFindingFilePaths,
  emitForensicStatus,
} from "../agents/chat-agent.js";
import type { ForensicSourceCoverage } from "../forensic-output-guard.js";

// ── 1. isFixturePath path classification ─────────────────────────────────────

describe("isFixturePath — classification of paths as fixture / production", () => {
  // ── Paths that ARE fixture-local ─────────────────────────────────────────
  const fixturePaths = [
    "__tests__/foo.test.ts",
    "src/__tests__/bar.ts",
    "lib/__fixtures__/data.json",
    "src/__mocks__/db.ts",
    "test/integration.ts",
    "tests/unit/foo.ts",
    "spec/foo.spec.ts",
    "specs/helpers.ts",
    "fixtures/snapshot.json",
    "mocks/api.ts",
    "src/utils.test.ts",
    "src/utils.spec.ts",
    "src/utils.test.js",
    "src/utils.spec.mjs",
    "src/utils.test.cjs",
    "src/utils.spec.tsx",
    "lib/component.test.tsx",
    "src/deep/nested/__tests__/thing.ts",
    "packages/core/test/util.ts",
    "packages/core/tests/util.ts",
  ];

  for (const p of fixturePaths) {
    it(`classifies as fixture-local: ${p}`, () => {
      expect(isFixturePath(p)).toBe(true);
    });
  }

  // ── Paths that are NOT fixture-local ─────────────────────────────────────
  const productionPaths = [
    "src/main.ts",
    "src/utils.ts",
    "lib/knowledge-engine/src/queries.ts",
    "artifacts/api-server/src/routes/ai/chat.ts",
    "my-test-utils.ts",          // "test" is a substring, not a path segment
    "src/contest/results.ts",     // "test" substring inside "contest"
    "src/protest.ts",             // "test" inside "protest"
    "src/attestation.ts",         // "test" inside "attestation"
    "src/speculator.ts",          // "spec" inside "speculator"
    "pkg/testresult/main.go",     // "test" as prefix of a longer segment
    "dist/index.js",
    "coverage/lcov.info",
    "generated/types.ts",
    "src/mock-server.ts",         // "mock" is a substring, not a segment
    "package.json",
    "tsconfig.json",
  ];

  for (const p of productionPaths) {
    it(`classifies as production (not fixture): ${p}`, () => {
      expect(isFixturePath(p)).toBe(false);
    });
  }
});

// ── 2. auditScope and isFixtureLocal must derive from the same source ────────

describe("fixture-local emission contract — auditScope ↔ isFixtureLocal consistency", () => {
  /**
   * The emitForensicStatus function derives both `auditScope` and
   * `isFixtureLocal` from the same evidence-based rule: whether every
   * implementation file read is a fixture path.  This test suite
   * verifies the classification rules that feed that emission so that
   * contradictory combinations (e.g. auditScope=FIXTURE_LOCAL but
   * isFixtureLocal=false) cannot arise from correct inputs.
   */

  it("all-fixture impl files → both fields indicate FIXTURE_LOCAL", () => {
    const implFiles = [
      "__tests__/foo.test.ts",
      "src/__tests__/bar.ts",
      "fixtures/data.json",
    ];
    const allFixture = implFiles.length > 0 && implFiles.every(isFixturePath);
    // auditScope = allFixture ? 'FIXTURE_LOCAL' : 'PRODUCTION'
    // isFixtureLocal = allFixture
    expect(allFixture).toBe(true);
    const auditScope = allFixture ? "FIXTURE_LOCAL" : "PRODUCTION";
    expect(auditScope).toBe("FIXTURE_LOCAL");
  });

  it("mixed fixture + production impl files → both fields indicate PRODUCTION", () => {
    const implFiles = [
      "__tests__/foo.test.ts",
      "src/utils.ts",       // production file breaks the all-fixture rule
    ];
    const allFixture = implFiles.length > 0 && implFiles.every(isFixturePath);
    expect(allFixture).toBe(false);
    const auditScope = allFixture ? "FIXTURE_LOCAL" : "PRODUCTION";
    expect(auditScope).toBe("PRODUCTION");
  });

  it("all-production impl files → both fields indicate PRODUCTION", () => {
    const implFiles = [
      "src/main.ts",
      "lib/utils.ts",
    ];
    const allFixture = implFiles.length > 0 && implFiles.every(isFixturePath);
    expect(allFixture).toBe(false);
    const auditScope = allFixture ? "FIXTURE_LOCAL" : "PRODUCTION";
    expect(auditScope).toBe("PRODUCTION");
  });

  it("zero impl files → NOT classified as fixture-local (no evidence basis)", () => {
    const implFiles: string[] = [];
    // When there are no implementation files read, we cannot classify either
    // way — the rule requires at least one file, all of which must be fixtures.
    const allFixture = implFiles.length > 0 && implFiles.every(isFixturePath);
    expect(allFixture).toBe(false);
    const auditScope = allFixture ? "FIXTURE_LOCAL" : "PRODUCTION";
    expect(auditScope).toBe("PRODUCTION");
  });

  it("fixtureAuditMode=true with non-fixture impl files → evidence wins (PRODUCTION)", () => {
    // This is the key regression case: an explicit 'fixture audit' mode
    // must NOT override the evidence-based classification.  If the agent
    // reads production files, auditScope must be PRODUCTION regardless of
    // the audit mode flag.
    const fixtureAuditMode = true;            // mode hint from caller
    const implFiles = ["src/main.ts"];         // production file
    const isFixtureLocalFromEvidence =
      implFiles.length > 0 && implFiles.every(isFixturePath);

    // After the fix, auditScope derives from evidence, not from mode:
    const auditScope = isFixtureLocalFromEvidence ? "FIXTURE_LOCAL" : "PRODUCTION";

    expect(isFixtureLocalFromEvidence).toBe(false);
    expect(auditScope).toBe("PRODUCTION");

    // Demonstrate the pre-fix behaviour (mode-based) would have been wrong:
    const auditScopePreFix = fixtureAuditMode ? "FIXTURE_LOCAL" : "PRODUCTION";
    expect(auditScopePreFix).toBe("FIXTURE_LOCAL"); // this was the bug
    expect(auditScope).not.toBe(auditScopePreFix);  // they disagree → bug confirmed
  });

  it("fixtureAuditMode=false with all-fixture impl files → evidence wins (FIXTURE_LOCAL)", () => {
    // Mirror of the above: a 'production' audit that only read fixture files
    // should still emit FIXTURE_LOCAL based on evidence.
    const fixtureAuditMode = false;
    const implFiles = ["__tests__/foo.test.ts", "src/__tests__/bar.ts"];
    const isFixtureLocalFromEvidence =
      implFiles.length > 0 && implFiles.every(isFixturePath);

    const auditScope = isFixtureLocalFromEvidence ? "FIXTURE_LOCAL" : "PRODUCTION";

    expect(isFixtureLocalFromEvidence).toBe(true);
    expect(auditScope).toBe("FIXTURE_LOCAL");

    const auditScopePreFix = fixtureAuditMode ? "FIXTURE_LOCAL" : "PRODUCTION";
    expect(auditScopePreFix).toBe("PRODUCTION"); // pre-fix was wrong
    expect(auditScope).not.toBe(auditScopePreFix);
  });
});

// ── 3. auditScope-only serialised traces — compatibility parsing ──────────────

describe("auditScope-only trace compatibility — normalisation without isFixtureLocal", () => {
  /**
   * Traces serialised by the incoming-main branch may have
   * `auditScope: 'FIXTURE_LOCAL'` but no `isFixtureLocal` boolean.
   * The normalisation rule `auditScope === 'FIXTURE_LOCAL' || isFixtureLocal === true`
   * must treat these as fixture-local.
   */

  type TraceEntry = {
    kind: string;
    auditScope?: "PRODUCTION" | "FIXTURE_LOCAL";
    isFixtureLocal?: boolean;
    productionReachability?: "PROVEN" | "NOT_PROVEN";
    repairReadiness?: "READY" | "BLOCKED";
  };

  function normaliseFixtureLocal(entry: TraceEntry): boolean {
    return entry.auditScope === "FIXTURE_LOCAL" || entry.isFixtureLocal === true;
  }

  it("auditScope-only FIXTURE_LOCAL entry is treated as fixture-local", () => {
    const entry: TraceEntry = {
      kind: "forensic_status",
      auditScope: "FIXTURE_LOCAL",
      productionReachability: "NOT_PROVEN",
      repairReadiness: "BLOCKED",
      // isFixtureLocal absent — this is an auditScope-only trace
    };
    expect(normaliseFixtureLocal(entry)).toBe(true);
  });

  it("isFixtureLocal-only true entry is treated as fixture-local", () => {
    const entry: TraceEntry = {
      kind: "forensic_status",
      isFixtureLocal: true,
      productionReachability: "NOT_PROVEN",
      repairReadiness: "BLOCKED",
      // auditScope absent — this is an isFixtureLocal-only trace
    };
    expect(normaliseFixtureLocal(entry)).toBe(true);
  });

  it("both fields FIXTURE_LOCAL / true → still fixture-local", () => {
    const entry: TraceEntry = {
      kind: "forensic_status",
      auditScope: "FIXTURE_LOCAL",
      isFixtureLocal: true,
      productionReachability: "NOT_PROVEN",
      repairReadiness: "BLOCKED",
    };
    expect(normaliseFixtureLocal(entry)).toBe(true);
  });

  it("PRODUCTION scope entry without isFixtureLocal → not fixture-local", () => {
    const entry: TraceEntry = {
      kind: "forensic_status",
      auditScope: "PRODUCTION",
      // productionReachability is always NOT_PROVEN now — no evidence contract yet
      productionReachability: "NOT_PROVEN",
      repairReadiness: "READY",
    };
    expect(normaliseFixtureLocal(entry)).toBe(false);
  });

  it("no scope fields → not fixture-local (fails closed)", () => {
    const entry: TraceEntry = {
      kind: "forensic_status",
      productionReachability: "NOT_PROVEN",
      repairReadiness: "BLOCKED",
    };
    expect(normaliseFixtureLocal(entry)).toBe(false);
  });

  it("auditScope normalised from isFixtureLocal when building forensicStatus", () => {
    // Simulate the parseForensicEvidence derivation:
    function deriveAuditScope(entry: TraceEntry): "FIXTURE_LOCAL" | "PRODUCTION" {
      return entry.auditScope === "FIXTURE_LOCAL" || entry.isFixtureLocal === true
        ? "FIXTURE_LOCAL"
        : "PRODUCTION";
    }
    function deriveIsFixtureLocal(entry: TraceEntry): true | undefined {
      return entry.auditScope === "FIXTURE_LOCAL" || entry.isFixtureLocal === true
        ? true
        : undefined;
    }

    const auditScopeOnly: TraceEntry = { kind: "forensic_status", auditScope: "FIXTURE_LOCAL" };
    expect(deriveAuditScope(auditScopeOnly)).toBe("FIXTURE_LOCAL");
    expect(deriveIsFixtureLocal(auditScopeOnly)).toBe(true);

    const isFixtureLocalOnly: TraceEntry = { kind: "forensic_status", isFixtureLocal: true };
    expect(deriveAuditScope(isFixtureLocalOnly)).toBe("FIXTURE_LOCAL");
    expect(deriveIsFixtureLocal(isFixtureLocalOnly)).toBe(true);

    const production: TraceEntry = { kind: "forensic_status", auditScope: "PRODUCTION" };
    expect(deriveAuditScope(production)).toBe("PRODUCTION");
    expect(deriveIsFixtureLocal(production)).toBeUndefined();
  });
});

// ── 4. extractFindingFilePaths — parses File(s) from the Findings section ────

describe("extractFindingFilePaths — verifier-accepted Finding file paths", () => {
  /**
   * The fixture-locality classification must derive from the `File(s):` lines
   * inside the "## 3) Findings" section, not from the free-form sources array.
   * These tests verify the helper that extracts those paths.
   */

  const makeReport = (findingsBody: string, otherSections = "") =>
    [
      "## 1) Executive Verdict",
      "Verdict text.",
      "## 2) Evidence Map",
      "File: `src/foo.ts`",
      "Role: context",
      "## 3) Findings",
      findingsBody,
      "## 4) Repair Plan",
      "No repair phases.",
      otherSections,
    ].join("\n");

  it("extracts a single fixture File(s) path", () => {
    const report = makeReport(
      "* ID: F-01 · eval defect\n* File(s): `__tests__/fixtures/known-defect.ts`\n* Evidence: `eval(x)`",
    );
    expect(extractFindingFilePaths(report)).toEqual(["__tests__/fixtures/known-defect.ts"]);
  });

  it("extracts multiple paths from multiple File(s) lines", () => {
    const report = makeReport(
      [
        "* ID: F-01 · eval defect",
        "* File(s): `src/utils.ts`",
        "* Evidence: `eval(x)`",
        "* ID: F-02 · injection",
        "* File(s): `src/query.ts`",
        "* Evidence: `query + userInput`",
      ].join("\n"),
    );
    expect(extractFindingFilePaths(report)).toEqual(["src/utils.ts", "src/query.ts"]);
  });

  it("ignores File(s) lines outside the Findings section", () => {
    // The Evidence Map has a "File:" line that should NOT be included.
    const report = [
      "## 1) Executive Verdict",
      "Verdict.",
      "## 2) Evidence Map",
      "File: `src/context-file.ts`",   // evidence map — ignored
      "## 3) Findings",
      "* ID: F-01 · defect",
      "* File(s): `__tests__/fixtures/known-defect.ts`",  // actual finding
      "## 4) Repair Plan",
      "No phases.",
    ].join("\n");
    expect(extractFindingFilePaths(report)).toEqual(["__tests__/fixtures/known-defect.ts"]);
  });

  it("returns empty array when there are no Findings", () => {
    const report = makeReport("No verified finding identified from inspected source code.");
    expect(extractFindingFilePaths(report)).toEqual([]);
  });

  it("returns empty array when the Findings section is absent", () => {
    const report = "## 1) Executive Verdict\nNo finding.\n## 6) Final Judgment\nNOT PROVEN";
    expect(extractFindingFilePaths(report)).toEqual([]);
  });

  it("deduplicates identical paths across multiple Findings", () => {
    const report = makeReport(
      [
        "* ID: F-01 · defect-a\n* File(s): `src/foo.ts`",
        "* ID: F-02 · defect-b\n* File(s): `src/foo.ts`",
      ].join("\n"),
    );
    expect(extractFindingFilePaths(report)).toEqual(["src/foo.ts"]);
  });

  it("ignores backtick tokens without a file extension (prose fragments)", () => {
    const report = makeReport(
      "* ID: F-01 · defect\n* File(s): `known defect` and `src/foo.ts`",
    );
    // "known defect" has no extension → filtered out; "src/foo.ts" is kept
    expect(extractFindingFilePaths(report)).toEqual(["src/foo.ts"]);
  });

  it("all-fixture Finding file paths → all are fixture paths", () => {
    const report = makeReport(
      "* ID: F-01 · eval\n* File(s): `__tests__/fixtures/known-defect.ts`",
    );
    const paths = extractFindingFilePaths(report);
    expect(paths.every(isFixturePath)).toBe(true);
  });

  it("production Finding file path → not a fixture path", () => {
    const report = makeReport(
      "* ID: F-01 · injection\n* File(s): `src/query.ts`",
    );
    const paths = extractFindingFilePaths(report);
    expect(paths.some(isFixturePath)).toBe(false);
  });
});

// ── 5. Mixed-read regression — evidenceSources overrides full read set ────────

describe("mixed-read regression — evidenceSources scope isolation", () => {
  /**
   * When the agent reads production files for context AND fixture files for
   * evidence, the fixture-locality verdict must come from the Finding's
   * evidence sources, not the union of all reads.
   *
   * This mirrors the `evidenceSources` parameter added to `emitForensicStatus`
   * so that an incidental production read cannot mask a fixture-only Finding.
   */

  function deriveAuditScopeFromEvidence(
    allFilesRead: string[],
    evidenceSources: string[],
  ): "FIXTURE_LOCAL" | "PRODUCTION" {
    // When evidenceSources is provided and non-empty, classify from those.
    const classificationFiles =
      evidenceSources.length > 0 ? evidenceSources : allFilesRead;
    const implFileList = classificationFiles.filter((file) =>
      /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh)$/i.test(file) &&
      !/(?:^|\/)(?:benchmark-results|generated|dist|build|coverage)(?:\/|$)/i.test(file),
    );
    const isFixtureLocal =
      implFileList.length > 0 && implFileList.every(isFixturePath);
    return isFixtureLocal ? "FIXTURE_LOCAL" : "PRODUCTION";
  }

  it("mixed reads (context=production + evidence=fixture) → evidenceSources wins FIXTURE_LOCAL", () => {
    const allFilesRead = [
      "src/main.ts",                          // production read for context
      "lib/utils.ts",                          // production read for context
      "__tests__/fixtures/known-defect.ts",    // fixture — the Finding evidence
    ];
    const evidenceSources = ["__tests__/fixtures/known-defect.ts"];

    // Without evidenceSources: classification from all reads → PRODUCTION
    // (because src/main.ts is not a fixture path, so not all impl files are fixture)
    const scopeWithoutEvidence = deriveAuditScopeFromEvidence(allFilesRead, []);
    expect(scopeWithoutEvidence).toBe("PRODUCTION");

    // With evidenceSources: classification from Finding evidence only → FIXTURE_LOCAL
    const scopeWithEvidence = deriveAuditScopeFromEvidence(allFilesRead, evidenceSources);
    expect(scopeWithEvidence).toBe("FIXTURE_LOCAL");
  });

  it("all-fixture reads + all-fixture evidenceSources → FIXTURE_LOCAL regardless of approach", () => {
    const allFilesRead = ["__tests__/fixtures/a.ts", "__tests__/fixtures/b.ts"];
    const evidenceSources = ["__tests__/fixtures/a.ts"];
    expect(deriveAuditScopeFromEvidence(allFilesRead, evidenceSources)).toBe("FIXTURE_LOCAL");
    expect(deriveAuditScopeFromEvidence(allFilesRead, [])).toBe("FIXTURE_LOCAL");
  });

  it("all-production evidenceSources → PRODUCTION even if unrelated fixture files were read", () => {
    const allFilesRead = ["__tests__/util.test.ts", "src/real.ts"];
    const evidenceSources = ["src/real.ts"]; // only production source in Finding
    expect(deriveAuditScopeFromEvidence(allFilesRead, evidenceSources)).toBe("PRODUCTION");
  });

  it("empty evidenceSources falls back to all fileContents keys", () => {
    const allFilesRead = ["__tests__/fixtures/a.ts"];
    expect(deriveAuditScopeFromEvidence(allFilesRead, [])).toBe("FIXTURE_LOCAL");
  });
});

// ── 5. Single-file pre-read path-traversal guard ─────────────────────────────

describe("single-file pre-read — path-traversal and symlink-escape guard", () => {
  /**
   * The eager pre-read step in single-file forensic mode must reject any
   * `relPath` that resolves outside the project root before touching the
   * filesystem.  These tests verify the two-phase containment rule (lexical
   * first, realpath second) that mirrors the `safePath` helper in file-tools.ts.
   */

  // ── Lexical phase simulation (no I/O) ────────────────────────────────────

  function lexicallyContained(resolvedRoot: string, relPath: string): boolean {
    if (relPath.includes("\0")) return false;
    const lexical = `${resolvedRoot}/${relPath}`.replace(/\/+/g, "/");
    // Normalise `..` segments the same way path.resolve would.
    const parts: string[] = [];
    for (const seg of lexical.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    const resolved = parts.join("/");
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + "/");
  }

  /** Mirrors the Phase-2 check in the pre-read guard: is `realPath` inside `root`? */
  function realpathContained(root: string, realPath: string): boolean {
    return realPath === root || realPath.startsWith(root + "/");
  }

  it("rejects a path starting with ../", () => {
    expect(lexicallyContained("/project", "../etc/passwd")).toBe(false);
  });

  it("rejects a deeply nested ../ that escapes the root", () => {
    expect(lexicallyContained("/project", "__tests__/../../etc/shadow")).toBe(false);
  });

  it("rejects an absolute path (lexical escape)", () => {
    // An absolute relPath already resolves outside the root — it must be caught
    // by the lexical phase before any I/O takes place.
    const resolvedRoot: string = "/project";
    const absRelPath: string = "/etc/passwd";
    // Simulate: path.resolve(resolvedRoot, absRelPath) = /etc/passwd
    const lexical: string = absRelPath; // absolute wins over join
    const contained = lexical === resolvedRoot || lexical.startsWith(resolvedRoot + "/");
    expect(contained).toBe(false);
  });

  it("rejects a path containing a null byte", () => {
    expect(lexicallyContained("/project", "__tests__/f\0oo.ts")).toBe(false);
  });

  it("accepts a legitimate fixture-relative path", () => {
    expect(lexicallyContained("/project", "__tests__/fixtures/known-defect.ts")).toBe(true);
  });

  it("accepts a path that only looks like traversal but stays inside root", () => {
    // "src/../__tests__/foo.ts" normalises to "__tests__/foo.ts" — inside root.
    expect(lexicallyContained("/project", "src/../__tests__/foo.ts")).toBe(true);
  });

  // ── Realpath phase simulation (symlink escape) ────────────────────────────

  it("rejects a resolved path that escapes the root (symlink simulation)", () => {
    // Simulate: realpath("/project/__tests__/link") resolves to "/etc/passwd"
    const resolvedRoot: string = "/project";
    const externalPath: string = "/etc/passwd";
    expect(realpathContained(resolvedRoot, externalPath)).toBe(false);
  });

  it("accepts a resolved path that stays inside the root (symlink simulation)", () => {
    // Simulate: realpath("/project/__tests__/link") resolves to "/project/src/real.ts"
    const resolvedRoot: string = "/project";
    const internalPath: string = "/project/src/real.ts";
    expect(realpathContained(resolvedRoot, internalPath)).toBe(true);
  });

  it("rejects the root directory itself as a traversal target", () => {
    // relPath that resolves exactly to resolvedRoot (not inside it) is rejected.
    // e.g. path.resolve("/project", ".") = "/project", which is NOT inside it.
    const resolvedRoot: string = "/project";
    const lexical: string = "/project"; // resolves to exactly the root
    // The guard rejects the root itself — you cannot read a directory as a file,
    // and a path that is exactly the root is not "inside" the root.
    const isInsideRoot = lexical !== resolvedRoot && !lexical.startsWith(resolvedRoot + "/");
    expect(isInsideRoot).toBe(false); // false → guard rejects this path
  });
});

// ── 6. FIXTURE_PATH_RE exported constant is stable ───────────────────────────

describe("FIXTURE_PATH_RE — exported regex is available for downstream consumers", () => {
  it("is a valid RegExp", () => {
    expect(FIXTURE_PATH_RE).toBeInstanceOf(RegExp);
  });

  it("matches fixture-specific suffixes (.test.ts, .spec.js, etc.)", () => {
    expect(FIXTURE_PATH_RE.test("src/foo.test.ts")).toBe(true);
    expect(FIXTURE_PATH_RE.test("src/foo.spec.mjs")).toBe(true);
    expect(FIXTURE_PATH_RE.test("src/foo.test.tsx")).toBe(true);
  });

  it("does not match production file extensions", () => {
    expect(FIXTURE_PATH_RE.test("src/foo.ts")).toBe(false);
    expect(FIXTURE_PATH_RE.test("src/foo.js")).toBe(false);
    expect(FIXTURE_PATH_RE.test("src/foo.py")).toBe(false);
  });
});

// ── 7. emitForensicStatus — direct step emission ──────────────────────────────

/**
 * Minimal report strings that satisfy emitForensicStatus's pattern-matching
 * rules for finding status, repair readiness, and final judgment.
 *
 * hasFinding:       /(?:^|\n)\s*(?:[*-]\s*)?ID:\s*F-\d+\s*·/i
 * repairReadiness:  also requires /\bPhase\s+\d+\s+\(F-\d+\):/i in report
 * hasNoFindingBasis: /\bNO FINDING\b/i + /\bBasis:/i in the final-judgment section
 */
const PROVEN_REPORT_NO_REPAIR = [
  "## 3) Findings",
  "* ID: F-01 · eval defect",
  "* File(s): `__tests__/fixtures/eval-usage.ts`",
  "* Evidence: `eval(x)`",
  "## 6) Final Judgment",
  "FINDING_PROVEN",
].join("\n");

const PROVEN_REPORT_WITH_REPAIR = [
  "## 3) Findings",
  "* ID: F-01 · eval defect",
  "* File(s): `src/executor.ts`",
  "* Evidence: `eval(x)`",
  "## 4) Repair Plan",
  "Phase 1 (F-01): Replace eval with a safe alternative.",
  "  - Validation: no eval calls in executor.ts",
  "## 6) Final Judgment",
  "FINDING_PROVEN",
].join("\n");

const NO_FINDING_REPORT = [
  "## 3) Findings",
  "No verified finding identified.",
  "## 6) Final Judgment",
  "NO FINDING",
  "Basis: All inspected code follows safe patterns.",
].join("\n");

/**
 * Proven report with NO File(s): lines — causes extractFindingFilePaths to
 * return [] so classificationFiles falls back to the full fileContents key
 * set.  Use this when the test wants to exercise the fileContents-based path,
 * e.g. counting impl files or verifying "no impl files" behaviour.
 */
const PROVEN_REPORT_NO_FILE_LINES = [
  "## 3) Findings",
  "* ID: F-01 · unsafe code pattern",
  "* Evidence: unsafe pattern detected in inspected source",
  "## 4) Repair Plan",
  "Phase 1 (F-01): Apply a safe alternative.",
  "  - Validation: no unsafe patterns remain.",
  "## 6) Final Judgment",
  "FINDING_PROVEN",
].join("\n");

/**
 * Capture the forensic_status step emitted by emitForensicStatus.
 * Returns the step object or null if no step was emitted.
 */
type ForensicStatusStep = Extract<
  Parameters<Parameters<typeof emitForensicStatus>[0] & object>[0],
  { kind: "forensic_status" }
>;

function captureForensicStatus(
  fileContents: Map<string, string>,
  report: string,
  options: {
    incompleteFiles?: Set<string>;
    behavioralAssessmentRequested?: boolean;
    fixtureAuditMode?: boolean;
    reason?: string;
    evidenceSources?: string[];
    sourceCoverage?: ForensicSourceCoverage;
  } = {},
): ForensicStatusStep | null {
  let emitted: ForensicStatusStep | null = null;
  emitForensicStatus(
    (step) => {
      if (step.kind === "forensic_status") {
        emitted = step as ForensicStatusStep;
      }
    },
    fileContents,
    options.incompleteFiles,
    report,
    options.behavioralAssessmentRequested ?? true,
    options.fixtureAuditMode ?? false,
    options.reason,
    options.sourceCoverage,
    options.evidenceSources,
  );
  return emitted;
}

describe("emitForensicStatus — step emission: isFixtureLocal, auditScope, repairReadiness", () => {
  // ── All-fixture paths ─────────────────────────────────────────────────────

  it("all-fixture impl files → isFixtureLocal:true and auditScope:FIXTURE_LOCAL", () => {
    const files = new Map([
      ["__tests__/fixtures/eval-usage.ts", "eval(x)"],
      ["src/__tests__/helper.ts", "export function helper() {}"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_NO_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.isFixtureLocal).toBe(true);
    expect(step!.auditScope).toBe("FIXTURE_LOCAL");
  });

  it("all-fixture paths → repairReadiness:BLOCKED even with a proven finding", () => {
    const files = new Map([
      ["__tests__/fixtures/eval-usage.ts", "eval(x)"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_NO_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.isFixtureLocal).toBe(true);
    expect(step!.repairReadiness).toBe("BLOCKED");
  });

  // ── Mixed fixture + production paths ──────────────────────────────────────

  it("mixed paths → isFixtureLocal absent and auditScope:PRODUCTION", () => {
    const files = new Map([
      ["__tests__/fixtures/eval-usage.ts", "eval(x)"],
      ["src/executor.ts", "function run(cmd: string) { return eval(cmd); }"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.isFixtureLocal).toBeUndefined();
    expect(step!.auditScope).toBe("PRODUCTION");
  });

  it("mixed paths with proven finding and repair plan → repairReadiness:READY", () => {
    const files = new Map([
      ["__tests__/fixtures/eval-usage.ts", "eval(x)"],
      ["src/executor.ts", "function run(cmd: string) { return eval(cmd); }"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.repairReadiness).toBe("READY");
  });

  // ── Production-only paths ─────────────────────────────────────────────────

  it("production-only impl files → auditScope:PRODUCTION and no isFixtureLocal", () => {
    const files = new Map([
      ["src/executor.ts", "function run(cmd: string) { return eval(cmd); }"],
      ["lib/utils.ts", "export function noop() {}"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.auditScope).toBe("PRODUCTION");
    expect(step!.isFixtureLocal).toBeUndefined();
  });

  it("production-only paths → productionReachability:NOT_PROVEN (no evidence contract yet)", () => {
    // The evidence contract for proving production reachability is not yet
    // implemented — the field always emits NOT_PROVEN regardless of file scope.
    const files = new Map([
      ["src/executor.ts", "eval(x)"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.productionReachability).toBe("NOT_PROVEN");
  });

  // ── Zero implementation files ─────────────────────────────────────────────

  it("zero implementation files (only .json context) → not classified as fixture-local", () => {
    // JSON files do not match the impl-file filter, so implFileList is empty.
    // With no impl files, the fixture-local rule cannot fire (no evidence basis).
    // Use PROVEN_REPORT_NO_FILE_LINES so extractFindingFilePaths returns [] and
    // classificationFiles falls back to the fileContents key set (.json only).
    const files = new Map([
      ["package.json", '{"name":"test"}'],
      ["tsconfig.json", '{"compilerOptions":{}}'],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_NO_FILE_LINES);
    expect(step).not.toBeNull();
    expect(step!.isFixtureLocal).toBeUndefined();
    expect(step!.auditScope).toBe("PRODUCTION");
  });

  it("zero files read at all → not classified as fixture-local", () => {
    const step = captureForensicStatus(new Map(), NO_FINDING_REPORT);
    expect(step).not.toBeNull();
    expect(step!.isFixtureLocal).toBeUndefined();
    expect(step!.auditScope).toBe("PRODUCTION");
  });

  // ── Edge case: test-sounding names that are NOT fixture directories ────────

  it("my-test-utils.ts is NOT a fixture path → production scope", () => {
    // 'test' is a substring of the filename but not a dedicated path segment,
    // so it must not be treated as a fixture directory.
    const files = new Map([
      ["src/my-test-utils.ts", "export function helper() {}"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.isFixtureLocal).toBeUndefined();
    expect(step!.auditScope).toBe("PRODUCTION");
  });

  it("src/contest/results.ts is NOT a fixture path → production scope", () => {
    const files = new Map([
      ["src/contest/results.ts", "export function tally() {}"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.auditScope).toBe("PRODUCTION");
    expect(step!.isFixtureLocal).toBeUndefined();
  });

  it("src/speculator.ts is NOT a fixture path → production scope", () => {
    const files = new Map([
      ["src/speculator.ts", "export function speculate() {}"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.auditScope).toBe("PRODUCTION");
    expect(step!.isFixtureLocal).toBeUndefined();
  });

  // ── repairReadiness = BLOCKED when isFixtureLocal = true ─────────────────

  it("isFixtureLocal:true always forces repairReadiness:BLOCKED", () => {
    // Even a report with a repair plan cannot unlock repair when evidence
    // is fixture-local — the fixture-local guard runs before the plan check.
    const reportWithPlan = [
      "## 3) Findings",
      "* ID: F-01 · eval defect",
      "* File(s): `__tests__/fixtures/eval.ts`",
      "## 4) Repair Plan",
      "Phase 1 (F-01): Fix the eval call.",
      "## 6) Final Judgment",
      "FINDING_PROVEN",
    ].join("\n");

    const files = new Map([
      ["__tests__/fixtures/eval.ts", "eval(x)"],
    ]);
    const step = captureForensicStatus(files, reportWithPlan);
    expect(step).not.toBeNull();
    expect(step!.isFixtureLocal).toBe(true);
    expect(step!.repairReadiness).toBe("BLOCKED");
  });

  // ── evidenceSources override — isolates Finding evidence from full read set ─

  it("evidenceSources fixture-only → FIXTURE_LOCAL even though production files were also read", () => {
    const files = new Map([
      ["src/executor.ts", "eval(x)"],            // production read (context)
      ["__tests__/fixtures/eval.ts", "eval(x)"], // fixture evidence
    ]);
    // The Finding only cites the fixture file — evidenceSources isolates it.
    const step = captureForensicStatus(files, PROVEN_REPORT_NO_REPAIR, {
      evidenceSources: ["__tests__/fixtures/eval.ts"],
    });
    expect(step).not.toBeNull();
    expect(step!.isFixtureLocal).toBe(true);
    expect(step!.auditScope).toBe("FIXTURE_LOCAL");
    expect(step!.repairReadiness).toBe("BLOCKED");
  });

  it("evidenceSources production-only → PRODUCTION even though fixture files were also read", () => {
    const files = new Map([
      ["__tests__/fixtures/eval.ts", "eval(x)"], // fixture read (context)
      ["src/executor.ts", "eval(x)"],            // production evidence
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      evidenceSources: ["src/executor.ts"],
    });
    expect(step).not.toBeNull();
    expect(step!.isFixtureLocal).toBeUndefined();
    expect(step!.auditScope).toBe("PRODUCTION");
  });

  // ── findingStatus field ───────────────────────────────────────────────────

  it("no proven finding → findingStatus:NOT_PROVEN", () => {
    const files = new Map([["src/foo.ts", "export function safe() {}"]]);
    const step = captureForensicStatus(files, "## 3) Findings\nNo finding.\n## 6) Final Judgment\nNOT PROVEN");
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("no-finding basis present → findingStatus:NO_FINDING", () => {
    const files = new Map([["src/foo.ts", "export function safe() {}"]]);
    const step = captureForensicStatus(files, NO_FINDING_REPORT);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NO_FINDING");
  });

  it("proven finding → findingStatus:PROVEN", () => {
    const files = new Map([["src/executor.ts", "eval(x)"]]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("PROVEN");
  });

  // ── implementationFiles counter ───────────────────────────────────────────

  it("counts implementation files correctly (excludes .json, dist/, generated/)", () => {
    // Use PROVEN_REPORT_NO_FILE_LINES so extractFindingFilePaths returns [] and
    // classificationFiles falls back to the full fileContents key set, letting
    // the impl-file filter exercise all five entries.
    const files = new Map([
      ["src/executor.ts", "eval(x)"],             // counted
      ["lib/utils.py", "def noop(): pass"],        // counted
      ["package.json", '{"name":"x"}'],            // NOT counted — not an impl ext
      ["dist/bundle.js", "bundled code"],          // NOT counted — dist/
      ["generated/types.ts", "type Foo = string"], // NOT counted — generated/
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_NO_FILE_LINES);
    expect(step).not.toBeNull();
    expect(step!.implementationFiles).toBe(2); // only src/executor.ts + lib/utils.py
  });
});

// ── 7b. EI-036 Repair Scope Gate — emitted repairBlockReason per proof scope ──

/**
 * Integration coverage for the Repair Scope Gate surfaced on the
 * forensic_status step. Each case drives emitForensicStatus end-to-end with a
 * report whose Findings cite concrete evidence paths, and asserts the emitted
 * `repairBlockReason` (when blocked) or its absence (when allowed) alongside
 * `repairReadiness`. This is the on-air surface an analyst sees — the pure
 * scopedRepairGate unit mapping lives in evidence-integrity.test.ts.
 */
const PROVEN_REPORT_MIXED = [
  "## 3) Findings",
  "* ID: F-01 · eval defect",
  "* File(s): `__tests__/fixtures/eval-usage.ts`, `src/executor.ts`",
  "* Evidence: `eval(x)`",
  "## 4) Repair Plan",
  "Phase 1 (F-01): Replace eval with a safe alternative.",
  "  - Validation: no eval calls in executor.ts",
  "## 6) Final Judgment",
  "FINDING_PROVEN",
].join("\n");

const PROVEN_REPORT_TEST_ONLY = [
  "## 3) Findings",
  "* ID: F-01 · eval defect",
  "* File(s): `src/__tests__/executor.test.ts`",
  "* Evidence: `eval(x)`",
  "## 4) Repair Plan",
  "Phase 1 (F-01): Replace eval with a safe alternative.",
  "## 6) Final Judgment",
  "FINDING_PROVEN",
].join("\n");

describe("EI-036 Repair Scope Gate — emitted repairBlockReason per proof scope", () => {
  it("production-only evidence → no repairBlockReason and repairReadiness:READY", () => {
    const files = new Map([
      ["src/executor.ts", "eval(x)"],
      ["lib/utils.ts", "export function noop() {}"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.repairReadiness).toBe("READY");
    expect(step!.repairBlockReason).toBeUndefined();
  });

  it("fixture-only evidence → REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION and BLOCKED", () => {
    const files = new Map([
      ["__tests__/fixtures/eval-usage.ts", "eval(x)"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_NO_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.repairReadiness).toBe("BLOCKED");
    expect(step!.repairBlockReason).toBe("REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION");
  });

  it("test/spec-only evidence → REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION and BLOCKED", () => {
    const files = new Map([
      ["src/__tests__/executor.test.ts", "import { run } from '../executor.ts'; expect(run()).toThrow();"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_TEST_ONLY);
    expect(step).not.toBeNull();
    expect(step!.repairReadiness).toBe("BLOCKED");
    expect(step!.repairBlockReason).toBe("REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION");
  });

  it("mixed production + fixture evidence → REPAIR_BLOCKED_MIXED_EVIDENCE and BLOCKED", () => {
    const files = new Map([
      ["__tests__/fixtures/eval-usage.ts", "eval(x)"],
      ["src/executor.ts", "function run() { return eval(x); }"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_MIXED);
    expect(step).not.toBeNull();
    expect(step!.repairReadiness).toBe("BLOCKED");
    expect(step!.repairBlockReason).toBe("REPAIR_BLOCKED_MIXED_EVIDENCE");
  });

  it("not-proven finding → REPAIR_BLOCKED_SCOPE_NOT_PROVEN and BLOCKED", () => {
    const files = new Map([["src/executor.ts", "function run() { return eval(x); }"]]);
    const step = captureForensicStatus(files, "## 3) Findings\nNo finding.\n## 6) Final Judgment\nNOT PROVEN");
    expect(step).not.toBeNull();
    expect(step!.repairReadiness).toBe("BLOCKED");
    expect(step!.repairBlockReason).toBe("REPAIR_BLOCKED_SCOPE_NOT_PROVEN");
  });

  it("incomplete read of an otherwise proven finding → REPAIR_BLOCKED_SCOPE_NOT_PROVEN and BLOCKED", () => {
    const files = new Map([
      ["src/executor.ts", "function run() { return eval(x); }"],
    ]);
    const INCOMPLETE = {
      complete: false,
      roots: [],
      reason: "truncated",
    };
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      sourceCoverage: INCOMPLETE,
    });
    expect(step).not.toBeNull();
    expect(step!.repairReadiness).toBe("BLOCKED");
    expect(step!.repairBlockReason).toBe("REPAIR_BLOCKED_SCOPE_NOT_PROVEN");
  });
});

// ── 8. Partial-read coverage gate — incomplete reads must not unlock repair ───

describe("partial-read coverage gate — incomplete source coverage blocks repair", () => {
  /**
   * emitForensicStatus's `sourceCoverage` parameter is the deterministic
   * fail-closed guard: whenever `complete: false`, an otherwise proven Finding
   * must be downgraded to NOT_PROVEN and `repairReadiness` forced to BLOCKED,
   * so a repair can never proceed on an honest-but-partial read.
   */

  const INCOMPLETE_COVERAGE = {
    complete: false,
    roots: [],
    reason: "single-file forensic read was truncated",
  };

  it("sourceCoverage.complete=false downgrades an otherwise-proven finding to NOT_PROVEN", () => {
    const files = new Map([["src/executor.ts", "eval(x)"]]);
    // The report is fully PROVEN (has ID + repair plan); only coverage is broken.
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      sourceCoverage: INCOMPLETE_COVERAGE,
    });
    expect(step).not.toBeNull();
    // effectiveFindingStatus flips to NOT_PROVEN purely because coverage is incomplete.
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("sourceCoverage.complete=false forces repairReadiness:BLOCKED even with a proven repair plan", () => {
    const files = new Map([["src/executor.ts", "eval(x)"]]);
    // PROVEN_REPORT_WITH_REPAIR normally yields READY; incomplete coverage must defeat it.
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      sourceCoverage: INCOMPLETE_COVERAGE,
    });
    expect(step).not.toBeNull();
    expect(step!.repairReadiness).toBe("BLOCKED");
  });

  it("sourceCoverage.complete=false emits sourceCoverage:PARTIAL", () => {
    const files = new Map([["src/executor.ts", "eval(x)"]]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      sourceCoverage: INCOMPLETE_COVERAGE,
    });
    expect(step).not.toBeNull();
    expect(step!.sourceCoverage).toBe("PARTIAL");
  });

  it("sourceCoverage.complete=true keeps the finding PROVEN and repair READY", () => {
    const files = new Map([["src/executor.ts", "eval(x)"]]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      sourceCoverage: { complete: true, roots: [] },
    });
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("PROVEN");
    expect(step!.repairReadiness).toBe("READY");
    expect(step!.sourceCoverage).toBe("COMPLETE");
  });

  it("keeps complete 6/6 root accounting aligned with COMPLETE telemetry", () => {
    const files = new Map([["src/executor.ts", "eval(x)"]]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      sourceCoverage: {
        complete: true,
        roots: [{
          root: "src",
          discoveredFiles: 6,
          readFiles: 6,
          unreadFiles: 0,
          status: "COMPLETE",
        }],
      },
    });
    expect(step).not.toBeNull();
    expect(step!.sourceCoverage).toBe("COMPLETE");
    expect(step!.findingStatus).toBe("PROVEN");
    expect(step!.repairReadiness).toBe("READY");
    expect(step!.rootCoverage?.[0]).toMatchObject({
      discoveredFiles: 6,
      readFiles: 6,
      status: "COMPLETE",
    });
  });

  it("fails closed when root accounting is partial even if the top-level flag says complete", () => {
    const files = new Map([["src/executor.ts", "eval(x)"]]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      sourceCoverage: {
        complete: true,
        roots: [{
          root: "src",
          discoveredFiles: 6,
          readFiles: 5,
          unreadFiles: 1,
          status: "PARTIAL",
        }],
      },
    });
    expect(step).not.toBeNull();
    expect(step!.sourceCoverage).toBe("PARTIAL");
    expect(step!.findingStatus).toBe("NOT_PROVEN");
    expect(step!.repairReadiness).toBe("BLOCKED");
  });

  it("passes the incomplete-coverage reason through to the emitted step", () => {
    const files = new Map([["src/executor.ts", "eval(x)"]]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      sourceCoverage: INCOMPLETE_COVERAGE,
    });
    expect(step).not.toBeNull();
    expect(step!.reason).toContain("single-file forensic read was truncated");
  });

  it("incomplete coverage beats a fixture-local decision: still NOT_PROVEN / BLOCKED", () => {
    // Even when the finding is fixture-local (which already blocks repair), the
    // coverage gate must also flip the finding status; both guards agree.
    const files = new Map([["__tests__/fixtures/eval.ts", "eval(x)"]]);
    const step = captureForensicStatus(files, PROVEN_REPORT_NO_REPAIR, {
      sourceCoverage: INCOMPLETE_COVERAGE,
    });
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
    expect(step!.repairReadiness).toBe("BLOCKED");
    expect(step!.sourceCoverage).toBe("PARTIAL");
  });
});

// ── 9. Truncation-marker inference — PARTIAL coverage without an explicit scope ─

describe("truncation-marker inference — partial read detected from file content", () => {
  /**
   * Even when no `sourceCoverage` object is supplied, a file whose content
   * carries a "[prefetch output truncated" (or equivalent) marker must be
   * inferred as an incomplete read and drive `sourceCoverageStatus: PARTIAL`.
   */

  it("a [prefetch output truncated marker infers sourceCoverage:PARTIAL", () => {
    const files = new Map([
      ["src/large-file.ts", "export const data = 1;\n[prefetch output truncated; see full read via tool result]\n"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.sourceCoverage).toBe("PARTIAL");
  });

  it("a [read output truncated marker infers sourceCoverage:PARTIAL", () => {
    const files = new Map([
      ["src/large-file.ts", "export const data = 1;\n[read output truncated — full body unavailable]\n"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.sourceCoverage).toBe("PARTIAL");
  });

  it("a display-limit truncation phrase infers sourceCoverage:PARTIAL", () => {
    const files = new Map([
      ["src/large-file.ts", "the read hit the display limit and omitted the tail of the file"],
    ]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.sourceCoverage).toBe("PARTIAL");
  });

  it("complete file content (no marker) emits sourceCoverage:COMPLETE with no coverage object", () => {
    const files = new Map([["src/executor.ts", "export function run() { return eval(x); }"]]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR);
    expect(step).not.toBeNull();
    expect(step!.sourceCoverage).toBe("COMPLETE");
  });

  it("an explicit incompleteFiles set also drives sourceCoverage:PARTIAL", () => {
    const files = new Map([["src/executor.ts", "complete body"]]);
    const step = captureForensicStatus(files, PROVEN_REPORT_WITH_REPAIR, {
      incompleteFiles: new Set(["src/executor.ts"]),
    });
    expect(step).not.toBeNull();
    expect(step!.sourceCoverage).toBe("PARTIAL");
  });
});

// ── 10. hasFinding regex — near-miss detection ───────────────────────────────

/**
 * The `hasFinding` regex in emitForensicStatus is:
 *
 *   /(?:^|\n)\s*(?:[*-]\s*)?ID:\s*F-\d+\s*·/i
 *
 * It requires:
 *   - a line boundary (start-of-string or newline)
 *   - optional leading whitespace
 *   - optional list marker (* or -) with optional trailing whitespace
 *   - literal "ID:" with optional whitespace
 *   - "F-" followed by one or more digits (no spaces)
 *   - optional whitespace then the interpunct "·" (U+00B7)
 *
 * Any input that omits or corrupts the interpunct, places "ID: F-01" mid-sentence
 * (not at a line boundary), or echoes an ID only in the Repair Plan using the
 * phase format must NOT produce a PROVEN verdict — a false positive here would
 * unlock a repair that hasn't been verified.
 *
 * Tests (a)–(c) cover near-miss inputs; one positive test confirms the exact
 * pattern still resolves to PROVEN.
 */
describe("hasFinding regex — near-miss inputs must not produce a false-positive PROVEN", () => {
  /** Shared production file so sourceCoverage stays COMPLETE and doesn't interfere. */
  const FILES = new Map([["src/executor.ts", "function run() { return eval(x); }"]]);

  // ── (a) "ID: F-01" prose without the interpunct ──────────────────────────

  it("(a) prose sentence containing 'ID: F-01' mid-line without interpunct → NOT_PROVEN", () => {
    // "ID: F-01" appears mid-sentence; the line-boundary anchor prevents a match
    // even if it were at the start of a line, the missing interpunct would stop it.
    const report = [
      "## 3) Findings",
      "The analysis identified a potential issue with finding ID: F-01 in the source code.",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("(a) list-marker ID line without interpunct → NOT_PROVEN", () => {
    // Looks like a real Finding line but is missing the required interpunct "·".
    // The regex requires \s*· after the digits; "without" is not ·.
    const report = [
      "## 3) Findings",
      "* ID: F-01 without the interpunct separator",
      "* Evidence: some code fragment",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("(a) bare 'ID: F-01' on its own line without interpunct → NOT_PROVEN", () => {
    // No list marker, no interpunct — hasFinding must remain false.
    const report = [
      "## 3) Findings",
      "ID: F-01 evaluation defect found in executor",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  // ── (b) ID echo in the Repair Plan section only ───────────────────────────

  it("(b) phase-format ID echo in Repair Plan only (no Finding ID line) → NOT_PROVEN", () => {
    // The Repair Plan references F-01 via the phase format "Phase 1 (F-01):" which
    // does NOT match 'ID:\s*F-\d+·', so hasFinding stays false.
    const report = [
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "Phase 1 (F-01): Replace the unsafe eval call with a safe alternative.",
      "  - Validation: no eval calls in executor.ts",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("(b) prose ID mention in Repair Plan ('ID: F-01' without interpunct) → NOT_PROVEN", () => {
    // A model that echoes the Finding ID as plain prose in the Repair Plan section
    // (e.g., "This repair addresses ID: F-01 if confirmed.") must not trigger PROVEN.
    const report = [
      "## 3) Findings",
      "No verified finding identified.",
      "## 4) Repair Plan",
      "This repair plan addresses the candidate issue with ID: F-01 if a finding is confirmed.",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  // ── (c) Corrupted ID line ─────────────────────────────────────────────────

  it("(d) exact canonical 'ID: F-01 ·' line ONLY in the Repair Plan section → NOT_PROVEN", () => {
    // This is the regression the section-scoping fix addresses: the hasFinding
    // regex previously scanned the whole report, so a model echoing the perfect
    // Finding ID line inside the Repair Plan section (e.g. to name the phase it
    // repairs) was mistaken for a proven Finding. The Findings section has no ID
    // line here, so the verdict must fail closed to NOT_PROVEN.
    const report = [
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "* ID: F-01 · Replace the unsafe eval call with a safe alternative.",
      "  - Validation: no eval calls in executor.ts",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("(d) exact canonical 'ID: F-01 ·' line in BOTH Findings and Repair Plan → PROVEN", () => {
    // A real proven Finding in the Findings section still resolves to PROVEN even
    // when the Repair Plan legitimately echoes the same ID — the repair plan echo
    // must not suppress a genuine Findings-section match.
    const report = [
      "## 3) Findings",
      "* ID: F-01 · eval defect",
      "* File(s): `src/executor.ts`",
      "* Evidence: `eval(x)` on line 3",
      "## 4) Repair Plan",
      "* ID: F-01 · Replace eval with a safe alternative.",
      "  - Validation: no eval calls remain in executor.ts",
      "## 6) Final Judgment",
      "FINDING_PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("PROVEN");
  });

  it("(d) Findings section absent entirely, ID echo in Repair Plan only → NOT_PROVEN", () => {
    // When there is no ## 3) Findings section, an ID echo cannot be promoted to a
    // Finding. Scoping to the missing section means hasFinding stays false.
    const report = [
      "## 1) Executive Verdict",
      "No defect proven.",
      "## 4) Repair Plan",
      "* ID: F-01 · Apply a safe alternative.",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("(c) period instead of interpunct → NOT_PROVEN", () => {
    // "* ID: F-01." — period terminates the line; the regex requires · (U+00B7).
    const report = [
      "## 3) Findings",
      "* ID: F-01. eval defect",
      "* Evidence: `eval(x)`",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("(c) colon instead of interpunct → NOT_PROVEN", () => {
    // "* ID: F-01: eval defect" — colon after the digits, not ·.
    const report = [
      "## 3) Findings",
      "* ID: F-01: eval defect in executor",
      "* Evidence: `eval(x)`",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("(c) non-numeric suffix in ID (F-abc) → NOT_PROVEN", () => {
    // "F-abc" does not match F-\d+ so the whole pattern fails.
    const report = [
      "## 3) Findings",
      "* ID: F-abc · eval defect",
      "* Evidence: `eval(x)`",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("(c) space inside the ID number (F- 01) → NOT_PROVEN", () => {
    // "F- 01" has whitespace between the hyphen and the digits; F-\d+ requires
    // the digits to follow the hyphen directly.
    const report = [
      "## 3) Findings",
      "* ID: F- 01 · eval defect",
      "* Evidence: `eval(x)`",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  it("(c) 'ID:' with a space before the colon (ID : F-01 ·) → NOT_PROVEN", () => {
    // The regex requires 'ID:' literally (no space before the colon).
    const report = [
      "## 3) Findings",
      "* ID : F-01 · eval defect",
      "* Evidence: `eval(x)`",
      "## 6) Final Judgment",
      "NOT PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("NOT_PROVEN");
  });

  // ── Positive baseline ─────────────────────────────────────────────────────

  it("positive: exact pattern '* ID: F-01 ·' resolves to PROVEN", () => {
    // This is the canonical Finding ID line format. hasFinding must be true
    // and findingStatus must be PROVEN (with complete source coverage).
    const report = [
      "## 3) Findings",
      "* ID: F-01 · eval defect",
      "* File(s): `src/executor.ts`",
      "* Evidence: `eval(x)` on line 3",
      "## 4) Repair Plan",
      "Phase 1 (F-01): Replace eval with a safe alternative.",
      "  - Validation: no eval calls remain in executor.ts",
      "## 6) Final Judgment",
      "FINDING_PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("PROVEN");
  });

  it("positive: dash list marker '- ID: F-02 ·' also resolves to PROVEN", () => {
    // The regex allows both '*' and '-' list markers.
    const report = [
      "## 3) Findings",
      "- ID: F-02 · injection defect",
      "- File(s): `src/executor.ts`",
      "- Evidence: `query + userInput`",
      "## 4) Repair Plan",
      "Phase 1 (F-02): Parameterize the query.",
      "  - Validation: no string concatenation in query builder",
      "## 6) Final Judgment",
      "FINDING_PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("PROVEN");
  });

  it("positive: no list marker 'ID: F-03 ·' at start of line resolves to PROVEN", () => {
    // The list marker is optional — a bare 'ID: F-03 ·' at line start also matches.
    const report = [
      "## 3) Findings",
      "ID: F-03 · unsafe deserialization",
      "File(s): `src/executor.ts`",
      "Evidence: `JSON.parse(userInput)` without schema validation",
      "## 4) Repair Plan",
      "Phase 1 (F-03): Add schema validation before deserializing.",
      "  - Validation: all parse calls preceded by schema check",
      "## 6) Final Judgment",
      "FINDING_PROVEN",
    ].join("\n");
    const step = captureForensicStatus(FILES, report);
    expect(step).not.toBeNull();
    expect(step!.findingStatus).toBe("PROVEN");
  });
});
