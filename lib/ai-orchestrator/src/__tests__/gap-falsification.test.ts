import { describe, expect, it } from "vitest";
import {
  buildGapFalsificationPlan,
  buildGapFalsificationReport,
  classifyGapFalsification,
} from "../gap-falsification.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

function objective(overrides: Partial<ObjectiveContract> = {}): ObjectiveContract {
  return {
    objectiveType: "PROJECT_QUERY_GAP-ANALYSIS",
    goal: "Identify verified project gaps and falsify each candidate.",
    requiredEvidencePaths: ["src/handler.ts"],
    requiredClaims: [{
      claimId: "gap",
      text: "The handler has no fallback for provider errors.",
      requiredEvidencePaths: ["src/handler.ts"],
    }],
    requiredEvidenceEdges: [],
    scopePolicy: {
      primaryPaths: ["src/handler.ts"],
      allowedExpansionPaths: ["src"],
      forbiddenPaths: ["node_modules"],
    },
    ...overrides,
  };
}

function probes(overrides: Partial<Parameters<typeof classifyGapFalsification>[0]> = {}) {
  return [
    {
      probeId: "gap:alternative_adapter_or_recovery",
      coverage: "COMPLETE" as const,
      evidencePaths: [],
      counterEvidence: false,
    },
    {
      probeId: "gap:test_counterevidence",
      coverage: "COMPLETE" as const,
      evidencePaths: [],
      counterEvidence: false,
    },
    {
      probeId: "gap:interface_implementation",
      coverage: "COMPLETE" as const,
      evidencePaths: [],
      counterEvidence: false,
    },
    ...(overrides.probes ?? []),
  ];
}

describe("gap falsification", () => {
  it("derives three bounded server-owned probes per gap claim", () => {
    const plan = buildGapFalsificationPlan({ objective: objective() });
    expect(plan).toHaveLength(3);
    expect(plan.map((probe) => probe.kind)).toEqual([
      "ALTERNATIVE_ADAPTER_OR_RECOVERY",
      "TEST_COUNTEREVIDENCE",
      "INTERFACE_IMPLEMENTATION",
    ]);
    expect(plan.every((probe) => probe.allowedRoots.includes("src"))).toBe(true);
  });

  it("confirms an explicit source gap only after all probes are complete", () => {
    expect(classifyGapFalsification({
      claimId: "gap",
      primaryEvidenceComplete: true,
      explicitNegativeEvidence: true,
      probes: probes(),
    }).classification).toBe("CONFIRMED_GAP");
  });

  it("keeps an incomplete falsification run unproven", () => {
    expect(classifyGapFalsification({
      claimId: "gap",
      primaryEvidenceComplete: true,
      explicitNegativeEvidence: true,
      probes: probes({
        probes: [{
          probeId: "gap:interface_implementation",
          coverage: "MISSING",
          evidencePaths: [],
          counterEvidence: false,
        }],
      }),
    }).classification).toBe("UNPROVEN");
  });

  it("distinguishes test-only coverage from a directly contradictory implementation", () => {
    expect(classifyGapFalsification({
      claimId: "gap",
      primaryEvidenceComplete: true,
      explicitNegativeEvidence: true,
      probes: probes({
        probes: [{
          probeId: "gap:test_counterevidence",
          coverage: "COMPLETE",
          evidencePaths: ["src/handler.test.ts"],
          counterEvidence: true,
        }],
      }),
    }).classification).toBe("PARTIALLY_COVERED");

    expect(classifyGapFalsification({
      claimId: "gap",
      primaryEvidenceComplete: true,
      explicitNegativeEvidence: true,
      probes: probes({
        probes: [{
          probeId: "gap:alternative_adapter_or_recovery",
          coverage: "COMPLETE",
          evidencePaths: ["src/recovery.ts"],
          counterEvidence: true,
        }],
      }),
    }).classification).toBe("CONTRADICTED");
  });

  it("does not infer a gap from complete reads without an explicit negative signal", () => {
    const report = buildGapFalsificationReport({
      objective: objective(),
      fileContents: new Map([
        ["src/handler.ts", "export function handle() { return call(); }"],
      ]),
      toolSources: [
        "search: fallback recovery adapter",
        "search: describe test expect",
        "search: interface implements strategy",
      ],
    });
    expect(report.results).toMatchObject([{
      claimId: "gap",
      classification: "UNPROVEN",
    }]);
  });
});