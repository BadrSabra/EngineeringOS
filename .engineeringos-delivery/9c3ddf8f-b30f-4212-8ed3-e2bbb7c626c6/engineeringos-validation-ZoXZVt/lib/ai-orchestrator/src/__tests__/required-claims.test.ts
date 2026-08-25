/**
 * Task #53 — FEG-011/012: every claim must be closed before an answer is final.
 *
 * An evidence inventory is NOT an answer. This test locks the Required Claims
 * model (Claim → Evidence → Status) and its claim-closure gate:
 *
 *   - the required claim set is derived from the QUESTION (primary assertion +
 *     one source-scoped claim per explicit source the question names), not from
 *     already-validated evidence — so a source-scoped claim CAN be UNCLOSED in
 *     the live path even when every validator-surfaced reference is grounded;
 *   - a question that names multiple explicit sources requires EACH to be
 *     grounded before the answer can finalize. Grounding one file alone in a
 *     multi-source question must NOT finalize (the regression FEG-011/012
 *     prevents);
 *   - grounding a claim closes it even at READ_CONFIRMED (AI-009) — reaching
 *     BEHAVIOR_PROVEN/Finding is not required to close.
 */

import { describe, expect, it } from "vitest";
import { evaluateBehaviorRequiredClaims } from "../required-claims.js";
import type { EvidenceReference } from "../task-contracts.js";

const QUESTION = "Does the loop run at most 20 iterations?";
// A question that explicitly names ONE source file.
const SINGLE_SOURCE_QUESTION =
  "What happens when src/loop.ts's run() is called? Answer with evidence from the file.";
// A compound question naming TWO explicit source files.
const MULTI_SOURCE_QUESTION =
  "Compare src/loop.ts and src/parser.ts behavior. Answer with evidence.";

function ref(overrides: Partial<EvidenceReference> & { source: string }): EvidenceReference {
  return {
    excerpt: undefined,
    sourceSpan: undefined,
    supportsClaim: false,
    relevance: 0,
    directness: "INDIRECT",
    sourceType: "IMPLEMENTATION",
    productionReachability: "NOT_PROVEN",
    evidenceClass: "READ_CONFIRMED",
    ...overrides,
  };
}

describe("evaluateBehaviorRequiredClaims (task #53)", () => {
  it("CLOSES the primary claim when the answer grounds a cited source excerpt (no explicit source named)", () => {
    const fileContents = new Map([["src/loop.ts", "export const MAX_ITERATIONS = 20; export function run(){}"]]);
    const evidence = [
      ref({
        source: "src/loop.ts",
        excerpt: "export const MAX_ITERATIONS = 20;",
        supportsClaim: false, // READ_CONFIRMED only — AI-009: grounding, not Finding, closes it
        evidenceClass: "READ_CONFIRMED",
      }),
    ];
    const closure = evaluateBehaviorRequiredClaims({ question: QUESTION, evidence, fileContents });
    expect(closure.evidenceAvailable).toBe(true);
    expect(closure.primaryClaim?.status).toBe("CLOSED");
    expect(closure.primaryClaimClosed).toBe(true);
    expect(closure.claimClosureBlocked).toBe(false);
    // No explicit source is named, so no source-scoped claim beyond the primary.
    expect(closure.requiredClaims.some((c) => c.kind === "source")).toBe(false);
    expect(closure.unclosedRequiredClaims).toEqual([]);
  });

  it("CLOSES the source-scoped claim when the question names the file AND the answer grounds it", () => {
    const fileContents = new Map([["src/loop.ts", "export const MAX_ITERATIONS = 20; export function run(){}"]]);
    const evidence = [
      ref({
        source: "src/loop.ts",
        excerpt: "return MAX_ITERATIONS;",
        supportsClaim: true,
        evidenceClass: "BEHAVIOR_PROVEN",
      }),
    ];
    const closure = evaluateBehaviorRequiredClaims({
      question: SINGLE_SOURCE_QUESTION,
      evidence,
      fileContents,
    });
    expect(closure.primaryClaim?.status).toBe("CLOSED");
    const srcClaim = closure.requiredClaims.find((c) => c.claimId === "src:src/loop.ts");
    expect(srcClaim?.status).toBe("CLOSED");
    expect(srcClaim?.evidencePaths).toEqual(["src/loop.ts"]);
    expect(closure.claimClosureBlocked).toBe(false);
  });

  // THE regression FEG-011/012 prevents: a multi-source question in which the
  // answer grounds only ONE of two named files must NOT finalize.
  it("BLOCKS finalization when a multi-source question grounds only ONE of its named files", () => {
    const fileContents = new Map([
      ["src/loop.ts", "export function run(){ return MAX_ITERATIONS; }"],
      ["src/parser.ts", "export function parse(src: string){ return src; }"],
    ]);
    // The answer grounds src/loop.ts only; src/parser.ts (named in the question)
    // gets no grounded excerpt.
    const evidence = [
      ref({
        source: "src/loop.ts",
        excerpt: "return MAX_ITERATIONS;",
        supportsClaim: true,
        evidenceClass: "BEHAVIOR_PROVEN",
      }),
    ];
    const closure = evaluateBehaviorRequiredClaims({
      question: MULTI_SOURCE_QUESTION,
      evidence,
      fileContents,
    });
    // Primary claim grounded, and the loop claim grounded…
    expect(closure.primaryClaim?.status).toBe("CLOSED");
    expect(
      closure.requiredClaims.find((c) => c.claimId === "src:src/loop.ts")?.status,
    ).toBe("CLOSED");
    // …but the parser claim — named by the question — is UNCLOSED.
    const parserClaim = closure.requiredClaims.find((c) => c.claimId === "src:src/parser.ts");
    expect(parserClaim?.status).toBe("UNCLOSED");
    expect(parserClaim?.reason).toMatch(/src\/parser\.ts/);
    expect(closure.unclosedRequiredClaims.map((c) => c.claimId)).toContain("src:src/parser.ts");
    // Because ANY required claim is unclosed, finalization is blocked.
    expect(closure.claimClosureBlocked).toBe(true);
    expect(closure.primaryClaimClosed).toBe(true);
  });

  it("leaves the primary claim UNCLOSED and blocks closure when evidence is retained but nothing is grounded", () => {
    const fileContents = new Map([["src/loop.ts", "export const MAX_ITERATIONS = 20; export function run(){}"]]);
    // The model retained a read but cited NO exact excerpt → no grounded source.
    const closure = evaluateBehaviorRequiredClaims({ question: QUESTION, evidence: [], fileContents });
    expect(closure.evidenceAvailable).toBe(true);
    expect(closure.primaryClaim?.status).toBe("UNCLOSED");
    expect(closure.primaryClaimClosed).toBe(false);
    expect(closure.claimClosureBlocked).toBe(true);
    expect(closure.unclosedRequiredClaims.map((c) => c.claimId)).toContain("primary");
  });

  it("0-evidence run blocks finalization (primary unclosed) but is NOT the evidence-available shape", () => {
    const closure = evaluateBehaviorRequiredClaims({
      question: QUESTION,
      evidence: [],
      fileContents: new Map(),
    });
    expect(closure.evidenceAvailable).toBe(false);
    expect(closure.primaryClaim?.status).toBe("UNCLOSED");
    // No evidence inventory → not the "evidence available but unclosed" shape,
    // so the diagnostics layer must not label it EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED.
    expect(closure.claimClosureBlocked).toBe(true);
  });
});
