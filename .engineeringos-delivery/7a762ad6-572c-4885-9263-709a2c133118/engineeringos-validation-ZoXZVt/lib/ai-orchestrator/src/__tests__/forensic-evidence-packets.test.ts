import { describe, expect, it } from "vitest";
import { buildForensicEvidencePackets } from "../forensic-evidence-packets.js";
import { validateStructuredForensicRecovery } from "../forensic-recovery.js";

describe("buildForensicEvidencePackets", () => {
  it("keeps overlapping roots ordered and assigns each file once", () => {
    const evidence = {
      toolSources: ["lib/alpha/src/a.ts", "lib/beta/src/b.ts"],
      fileContents: new Map([
        ["lib/beta/src/b.ts", "export const b = true;"],
        ["lib/alpha/src/a.ts", "export const a = true;"],
      ]),
      scope: { roots: ["lib/alpha", "lib"] },
    };

    const packets = buildForensicEvidencePackets(evidence);

    expect(packets.map((packet) => packet.root)).toEqual(["lib/alpha", "lib"]);
    expect(packets[0]?.files).toEqual(["lib/alpha/src/a.ts"]);
    expect(packets[1]?.files).toEqual(["lib/beta/src/b.ts"]);
    expect(packets.flatMap((packet) => packet.files)).toHaveLength(2);
    expect(packets[0]?.evidence.fileContents.has("lib/beta/src/b.ts")).toBe(false);
  });

  it("keeps implementation, context, generated, and incomplete metadata packet-local", () => {
    const evidence = {
      toolSources: [
        "lib/alpha/src/a.ts",
        "lib/alpha/package.json",
        "lib/alpha/generated/schema.ts",
      ],
      fileContents: new Map([
        ["lib/alpha/src/a.ts", "export const a = true;"],
        ["lib/alpha/package.json", "{}"],
        ["lib/alpha/generated/schema.ts", "export type Generated = {};"],
      ]),
      incompleteFiles: new Set(["lib/alpha/src/a.ts"]),
      scope: { roots: ["lib/alpha"] },
    };

    const [packet] = buildForensicEvidencePackets(evidence);

    expect(packet).toMatchObject({
      root: "lib/alpha",
      implementationFiles: 1,
      contextFiles: 1,
      generatedFiles: 1,
      incompleteFiles: ["lib/alpha/src/a.ts"],
    });
    expect(packet?.evidence.incompleteFiles).toEqual(new Set(["lib/alpha/src/a.ts"]));
  });

  it("classifies each evidence window as FULL/PARTIAL from retained bodies (SR-005)", () => {
    const evidence = {
      toolSources: ["lib/alpha/src/a.ts", "lib/alpha/src/b.ts"],
      fileContents: new Map([
        ["lib/alpha/src/a.ts", "export const a = true;"],
        ["lib/alpha/src/b.ts", "const b = 1;\n[... output truncated at 128 KB by the read tool ...]\n"],
      ]),
      incompleteFiles: new Set(["lib/alpha/src/b.ts"]),
      scope: { roots: ["lib/alpha"] },
    };

    const [packet] = buildForensicEvidencePackets(evidence);

    const windows = packet.evidenceWindows;
    expect(windows).toHaveLength(2);
    const a = windows.find((w) => w.file === "lib/alpha/src/a.ts");
    const b = windows.find((w) => w.file === "lib/alpha/src/b.ts");
    expect(a?.completeness).toBe("FULL");
    // A truncated window must never be FULL — even a stray marker in the body.
    expect(b?.completeness).toBe("PARTIAL");
  });

  it("does not invent a packet for an empty requested root", () => {
    const packets = buildForensicEvidencePackets({
      toolSources: [],
      fileContents: new Map(),
      scope: { roots: ["lib/empty"] },
    });

    expect(packets).toEqual([]);
  });

  it("keeps a packet-local candidate from becoming a cross-packet Finding", () => {
    const evidence = {
      toolSources: ["lib/alpha/src/a.ts", "lib/beta/src/b.ts"],
      fileContents: new Map([
        ["lib/alpha/src/a.ts", "export const safe = true;"],
        ["lib/beta/src/b.ts", "export const safe = true;"],
      ]),
      scope: { roots: ["lib/alpha", "lib/beta"] },
    };
    const [alphaPacket] = buildForensicEvidencePackets(evidence);
    const envelope = {
      verdict: "FINDING_PROVEN" as const,
      findings: [{
        id: "F-01",
        title: "unsupported cross-packet claim",
        files: ["lib/beta/src/b.ts"],
        evidence: "`export const safe = true;`",
        whyItMatters: "The claim is not supported by the active packet.",
        rootCause: "No proven root cause.",
        fix: "No safe fix.",
      }],
      repairPlan: [{ findingId: "F-01", steps: ["Do not execute this unsupported phase."] }],
      validationChecklist: ["The evidence must be checked against the active packet."],
    };

    const result = validateStructuredForensicRecovery(envelope, alphaPacket.evidence);

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe("NOT_PROVEN");
  });
});
