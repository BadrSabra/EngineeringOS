import { describe, expect, it } from "vitest";
import {
  buildCapabilityParityObjectiveClaims,
  CAPABILITY_PARITY_BASELINE_V1,
  CapabilityParityBaselineSchema,
} from "../index.js";

describe("capability parity baseline", () => {
  it("is a valid server-owned revision with unique outcomes and explicit unknowns", () => {
    const parsed = CapabilityParityBaselineSchema.safeParse(CAPABILITY_PARITY_BASELINE_V1);

    expect(parsed.success).toBe(true);
    expect(CAPABILITY_PARITY_BASELINE_V1.revision).toBe("capability-parity-v1");
    expect(CAPABILITY_PARITY_BASELINE_V1.items.length).toBeGreaterThanOrEqual(15);
    expect(CAPABILITY_PARITY_BASELINE_V1.unknowns.length).toBeGreaterThan(0);
    expect(CAPABILITY_PARITY_BASELINE_V1.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "token-budget-admission",
          classification: "VERIFIED_GAP",
          priority: "P0",
        }),
      ]),
    );
    expect(new Set(CAPABILITY_PARITY_BASELINE_V1.items.map((item) => item.id)).size)
      .toBe(CAPABILITY_PARITY_BASELINE_V1.items.length);
    expect(CAPABILITY_PARITY_BASELINE_V1.statusVocabulary).toEqual(
      expect.arrayContaining([
        "PARITY",
        "SPECIALIZED_STRONGER",
        "PARTIAL",
        "VERIFIED_GAP",
          "UNVERIFIED_RISK",
        "NOT_A_GAP",
        "UNKNOWN",
      ]),
    );
  });

  it("derives objective claims from the manifest revision and deliverables", () => {
    const claims = buildCapabilityParityObjectiveClaims();
    const claimIds = claims.map((claim) => claim.claimId);
    const manifestClaim = claims.find((claim) => claim.claimId === "gap-manifest-revision");
    const prioritizationClaim = claims.find((claim) => claim.claimId === "gap-prioritization");

    expect(new Set(claimIds).size).toBe(claimIds.length);
    expect(manifestClaim?.text).toContain(CAPABILITY_PARITY_BASELINE_V1.revision);
    expect(manifestClaim?.text).toContain(
      `${CAPABILITY_PARITY_BASELINE_V1.items.length} observable outcomes`,
    );
    expect(prioritizationClaim?.evidenceNeedlesByPath?.["lib/ai-orchestrator/src/parity-baseline.ts"])
      .toEqual(expect.arrayContaining(["priority", "dependencies", "unknowns"]));
    expect(claims.every((claim) =>
      claim.requiredEvidencePaths.includes("lib/ai-orchestrator/src/parity-baseline.ts"),
    )).toBe(true);
  });

  it("rejects duplicate item and unknown identifiers", () => {
    const result = CapabilityParityBaselineSchema.safeParse({
      ...CAPABILITY_PARITY_BASELINE_V1,
      items: [
        CAPABILITY_PARITY_BASELINE_V1.items[0],
        CAPABILITY_PARITY_BASELINE_V1.items[0],
      ],
      unknowns: [],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) =>
      issue.message.includes("capability parity item id must be unique"),
    )).toBe(true);
  });
});