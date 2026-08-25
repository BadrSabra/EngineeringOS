/**
 * Task #63 (P0) — Objective / Claim Completion Gate (AI-OBJ-001/002/005).
 *
 *   - AI-OBJ-002: a declared objective decomposes into Required Claims BEFORE the
 *     first read; each claim/edge starts UNCLOSED and an edge claim is never closed
 *     by a bare import/package membership.
 *   - AI-OBJ-005: objectiveCompletionGate returns
 *     PROVEN / PARTIALLY_PROVEN / NOT_PROVEN / BLOCKED and refuses finalization
 *     while any required claim OR required reachability edge lacks direct proof.
 *   - Import-only "proof" must stay NOT_PROVEN/BLOCKED — a static reference can no
 *     more close a required edge than an evidence inventory can close a claim.
 */

import { describe, expect, it } from "vitest";
import {
  decomposeObjectiveClaims,
  closeObjectiveClaimsFromEdges,
} from "../required-claims.js";
import { objectiveCompletionGate } from "../evidence-integrity.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

const OBJECTIVE: ObjectiveContract = {
  objectiveType: "PRODUCTION_REACHABILITY",
  requiredClaims: [
    { claimId: "eval-reached", text: "untrusted input reaches the eval() call" },
  ],
  requiredEvidenceEdges: [
    { from: "client", to: "server", relationship: "calls" },
  ],
};

function emptyLedger() {
  return {
    claims: [],
    evidenceRecords: [],
    uniqueFilesRead: 0,
    evidenceFileCount: 0,
    acceptedEvidenceCount: 0,
    provenClaims: 0,
    readAttempts: 0,
    runId: "run-test",
  } as any;
}

describe("decomposeObjectiveClaims (AI-OBJ-002)", () => {
  it("derives claims+edges from the declared objective before any read", () => {
    const claims = decomposeObjectiveClaims(OBJECTIVE);
    const ids = claims.map((c) => c.claimId);
    expect(ids).toContain("objective:eval-reached");
    expect(ids).toContain("edge:client->server");
    expect(claims.every((c) => c.kind === "objective")).toBe(true);
    expect(claims.every((c) => c.status === "UNCLOSED")).toBe(true);
  });

  it("keeps an edge claim UNCLOSED when no proven edge exists (components are not proof)", () => {
    const claims = closeObjectiveClaimsFromEdges({ objective: OBJECTIVE, provenEdges: [] });
    const edgeClaim = claims.find((c) => c.claimId === "edge:client->server")!;
    expect(edgeClaim.status).toBe("UNCLOSED");
  });

  it("closes an edge claim only when a proven edge with identical endpoints exists", () => {
    const claims = closeObjectiveClaimsFromEdges({
      objective: OBJECTIVE,
      provenEdges: [{ from: "client", to: "server" }],
    });
    expect(claims.find((c) => c.claimId === "edge:client->server")!.status).toBe("CLOSED");
  });
});

describe("objectiveCompletionGate (AI-OBJ-005)", () => {
  it("NOT_PROVEN when the objective has no evidence at all", () => {
    const result = objectiveCompletionGate({ ledger: emptyLedger(), objective: OBJECTIVE });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.complete).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.missingClaims).toContain("eval-reached");
    expect(result.missingEdges).toContain("client->server");
  });

  it("BLOCKED when evidence exists but proves neither the claim nor the edge", () => {
    const ledger = emptyLedger();
    ledger.evidenceRecords = [{ file: "a.ts", readType: "full" }];
    const result = objectiveCompletionGate({
      ledger,
      objective: OBJECTIVE,
      provenEdges: [{ from: "other", to: "other2" }],
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.blocked).toBe(true);
  });

  it("PARTIALLY_PROVEN when at least one required element is proven but not all", () => {
    const result = objectiveCompletionGate({
      ledger: emptyLedger(),
      objective: OBJECTIVE,
      provenEdges: [{ from: "client", to: "server" }],
      closedClaimIds: [],
    });
    // The edge is proven but the required claim is not => partial.
    expect(result.status).toBe("PARTIALLY_PROVEN");
    expect(result.missingEdges).toHaveLength(0);
    expect(result.missingClaims).toContain("eval-reached");
  });

  it("PROVEN only when every required claim and edge is closed with direct proof", () => {
    const ledger = emptyLedger();
    ledger.claims = [{ claimId: "objective:eval-reached", status: "SUPPORTED" }];
    const result = objectiveCompletionGate({
      ledger,
      objective: OBJECTIVE,
      provenEdges: [{ from: "client", to: "server" }],
    });
    expect(result.status).toBe("PROVEN");
    expect(result.complete).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.missingClaims).toHaveLength(0);
    expect(result.missingEdges).toHaveLength(0);
  });

  it("an import membership alone can never close a required edge (endpoint mismatch)", () => {
    const ledger = emptyLedger();
    ledger.claims = [{ claimId: "objective:eval-reached", status: "SUPPORTED" }];
    // A static "import" reference with a DIFFERENT `to` endpoint stays unproven.
    const result = objectiveCompletionGate({
      ledger,
      objective: OBJECTIVE,
      provenEdges: [{ from: "client", to: "transformer" }],
    });
    expect(result.missingEdges).toContain("client->server");
    expect(result.status).toBe("PARTIALLY_PROVEN");
    expect(result.blocked).toBe(true);
  });
});
