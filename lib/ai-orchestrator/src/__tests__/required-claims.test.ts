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
import {
  closeObjectiveClaimsFromEvidence,
  evaluateBehaviorRequiredClaims,
  materializeObjectiveClaimEvidence,
} from "../required-claims.js";
import type { EvidenceReference } from "../task-contracts.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

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

  it("materializes every objective claim from retained bodies without provider paths", () => {
    const objective: ObjectiveContract = {
      objectiveType: "PROJECT_QUERY_GAP-ANALYSIS",
      requiredEvidencePaths: ["src/turn-intent.ts", "src/planner.ts"],
      requiredClaims: [
        {
          claimId: "routing",
          text: "resolveTurnIntent",
          requiredEvidencePaths: ["src/turn-intent.ts"],
        },
        {
          claimId: "planning",
          text: "inferCompoundParts",
          requiredEvidencePaths: ["src/planner.ts"],
        },
      ],
      requiredEvidenceEdges: [],
      scopePolicy: {
        primaryPaths: ["src/turn-intent.ts", "src/planner.ts"],
        allowedExpansionPaths: [],
        forbiddenPaths: ["node_modules"],
      },
    };
    const retained = new Map([
      [
        "src/turn-intent.ts",
        [
          "export function resolveTurnIntent(message: string) {",
          "  if (message.length === 0) return undefined;",
          "  return classify(message);",
          "}",
        ].join("\n"),
      ],
      [
        "src/planner.ts",
        [
          "export function inferCompoundParts(query: string) {",
          "  return query.split(' and ');",
          "}",
        ].join("\n"),
      ],
    ]);

    const materialized = materializeObjectiveClaimEvidence({
      objective,
      fileContents: retained,
    });
    expect(materialized).toHaveLength(2);
    expect(materialized.map((item) => item.source)).toEqual([
      "src/turn-intent.ts",
      "src/planner.ts",
    ]);
    expect(materialized.every((item) => item.excerpt.length > 0)).toBe(true);

    const response = materialized.map((item) => item.excerpt).join("\n");
    const closure = closeObjectiveClaimsFromEvidence({
      objective,
      response,
      evidence: materialized.map((item) => ({
        source: item.source,
        excerpt: item.excerpt,
        sourceSpan: item.sourceSpan,
        supportsClaim: true,
        relevance: 1,
        directness: "DIRECT",
        sourceType: "IMPLEMENTATION",
        productionReachability: "NOT_PROVEN",
        evidenceClass: "BEHAVIOR_PROVEN",
      })),
      fileContents: retained,
    });
    expect(closure.filter((claim) => claim.status === "CLOSED")).toHaveLength(2);
  });

  it("requires behavioral assertions while using source needles for project evidence", () => {
    const objective: ObjectiveContract = {
      objectiveType: "PROJECT_QUERY_EMBEDDED-AI",
      requiredEvidencePaths: ["src/chat.ts", "src/agent.ts"],
      requiredClaims: [
        {
          claimId: "routing",
          text: "The route resolves intent before selecting the execution path.",
          evidenceNeedles: ["resolveTurnIntent", "turnIntent"],
          requiredEvidencePaths: ["src/chat.ts"],
        },
        {
          claimId: "loop",
          text: "The agent enters executeToolLoop and retains results before synthesis.",
          evidenceNeedles: ["executeToolLoop", "loopResult"],
          requiredEvidencePaths: ["src/agent.ts"],
        },
      ],
      requiredEvidenceEdges: [],
      scopePolicy: {
        primaryPaths: ["src/chat.ts", "src/agent.ts"],
        allowedExpansionPaths: [],
        forbiddenPaths: ["node_modules"],
      },
    };
    const retained = new Map([
      ["src/chat.ts", "const intent = resolveTurnIntent(message);\nreturn route(intent);"],
      ["src/agent.ts", "const loopResult = await executeToolLoop(context);\nreturn synthesize(loopResult);"],
    ]);
    const materialized = materializeObjectiveClaimEvidence({
      objective,
      fileContents: retained,
    });
    expect(materialized).toHaveLength(2);
    expect(materialized.map((item) => item.source)).toEqual(["src/chat.ts", "src/agent.ts"]);

    const evidence = materialized.map((item) => ({
      source: item.source,
      excerpt: item.excerpt,
      sourceSpan: item.sourceSpan,
      supportsClaim: true,
      relevance: 1,
      directness: "DIRECT" as const,
      sourceType: "IMPLEMENTATION" as const,
      productionReachability: "NOT_PROVEN" as const,
      evidenceClass: "BEHAVIOR_PROVEN" as const,
    }));
    const behavioralResponse = [
      "The route resolves intent before selecting the execution path.",
      "The agent enters executeToolLoop and retains results before synthesis.",
    ].join("\n");
    const behavioralClosure = closeObjectiveClaimsFromEvidence({
      objective,
      response: behavioralResponse,
      evidence,
      fileContents: retained,
      requireAcceptedEvidence: true,
    });
    expect(behavioralClosure.filter((claim) => claim.status === "CLOSED")).toHaveLength(2);

    const inventoryOnlyClosure = closeObjectiveClaimsFromEvidence({
      objective,
      response: materialized.map((item) => item.excerpt).join("\n"),
      evidence,
      fileContents: retained,
      requireAcceptedEvidence: true,
    });
    expect(inventoryOnlyClosure.every((claim) => claim.status === "UNCLOSED")).toBe(true);
  });

  it("uses source-specific needles for a cross-file objective claim", () => {
    const objective: ObjectiveContract = {
      objectiveType: "PROJECT_QUERY_EMBEDDED-AI",
      requiredEvidencePaths: ["src/provider.ts", "src/loop.ts"],
      requiredClaims: [{
        claimId: "error-boundary",
        text: "The provider error boundary is checked before tool execution.",
        requiredEvidencePaths: ["src/provider.ts", "src/loop.ts"],
        evidenceNeedlesByPath: {
          "src/provider.ts": ["finishReason"],
          "src/loop.ts": ["executeToolLoop"],
        },
      }],
      requiredEvidenceEdges: [],
      scopePolicy: {
        primaryPaths: ["src/provider.ts", "src/loop.ts"],
        allowedExpansionPaths: [],
        forbiddenPaths: ["node_modules"],
      },
    };

    const materialized = materializeObjectiveClaimEvidence({
      objective,
      fileContents: new Map([
        ["src/provider.ts", "const finishReason = choice.finish_reason;"],
        ["src/loop.ts", "const result = await executeToolLoop(context);"],
      ]),
    });

    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.source).toBe("src/provider.ts");
    expect(materialized[0]?.excerpt).toContain("finishReason");
  });

  it("does not close an objective from retained bodies when accepted evidence is absent", () => {
    const objective: ObjectiveContract = {
      objectiveType: "PROJECT_QUERY_EMBEDDED-AI",
      requiredEvidencePaths: ["src/agent.ts"],
      requiredClaims: [
        {
          claimId: "agent-loop",
          text: "executeToolLoop",
          requiredEvidencePaths: ["src/agent.ts"],
        },
      ],
      requiredEvidenceEdges: [],
      scopePolicy: {
        primaryPaths: ["src/agent.ts"],
        allowedExpansionPaths: [],
        forbiddenPaths: ["node_modules"],
      },
    };
    const closure = closeObjectiveClaimsFromEvidence({
      objective,
      response: "The agent calls executeToolLoop.",
      evidence: [],
      fileContents: new Map([[
        "src/agent.ts",
        "export function executeToolLoop() { return; }",
      ]]),
      requireAcceptedEvidence: true,
    });
    expect(closure[0]?.status).toBe("UNCLOSED");
  });

  it("preserves absolute line spans for targeted source windows", () => {
    const objective: ObjectiveContract = {
      objectiveType: "PROJECT_QUERY_EMBEDDED-AI",
      requiredEvidencePaths: ["src/agent.ts"],
      requiredClaims: [
        {
          claimId: "loop",
          text: "The agent enters the tool loop before synthesis.",
          evidenceNeedles: ["executeToolLoop"],
          requiredEvidencePaths: ["src/agent.ts"],
        },
      ],
      requiredEvidenceEdges: [],
      scopePolicy: {
        primaryPaths: ["src/agent.ts"],
        allowedExpansionPaths: [],
        forbiddenPaths: ["node_modules"],
      },
    };

    const materialized = materializeObjectiveClaimEvidence({
      objective,
      fileContents: new Map([
        ["src/agent.ts", "const loopResult = await executeToolLoop(context);"],
      ]),
      sourceWindows: [
        {
          file: "src/agent.ts",
          content: "before\nconst loopResult = await executeToolLoop(context);\nafter",
          startLine: 340,
          endLine: 342,
        },
      ],
    });

    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.sourceSpan).toEqual({ startLine: 340, endLine: 342 });
    expect(materialized[0]?.excerpt).toContain("executeToolLoop");
  });

  it("falls back to the retained body when a bounded window omits a required needle", () => {
    const objective: ObjectiveContract = {
      objectiveType: "PROJECT_QUERY_EMBEDDED-AI",
      requiredEvidencePaths: ["src/chat.ts"],
      requiredClaims: [
        {
          claimId: "routing",
          text: "The route resolves intent before selecting the execution path.",
          evidenceNeedles: ["resolveTurnIntent"],
          requiredEvidencePaths: ["src/chat.ts"],
        },
      ],
      requiredEvidenceEdges: [],
      scopePolicy: {
        primaryPaths: ["src/chat.ts"],
        allowedExpansionPaths: [],
        forbiddenPaths: ["node_modules"],
      },
    };

    const materialized = materializeObjectiveClaimEvidence({
      objective,
      fileContents: new Map([
        [
          "src/chat.ts",
          [
            "import { resolveTurnIntent } from './turn-intent';",
            "export function route(message: string) {",
            "  return resolveTurnIntent(message);",
            "}",
          ].join("\n"),
        ],
      ]),
      sourceWindows: [
        {
          file: "src/chat.ts",
          content: "export function unrelatedHelper() { return true; }",
          startLine: 90,
          endLine: 90,
        },
      ],
    });

    expect(materialized).toHaveLength(1);
    expect(materialized[0]).toMatchObject({
      claimId: "routing",
      source: "src/chat.ts",
      sourceSpan: { startLine: 1, endLine: 4 },
    });
    expect(materialized[0]?.excerpt).toContain("resolveTurnIntent");
  });
});
