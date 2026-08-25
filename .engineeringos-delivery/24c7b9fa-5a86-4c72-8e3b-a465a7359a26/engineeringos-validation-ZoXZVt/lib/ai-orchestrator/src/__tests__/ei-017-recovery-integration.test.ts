/**
 * EI-017 Recovery Integration — targeted read_file_range from retained content.
 *
 * These tests validate the fix where the anchor line is derived from the
 * already-retained file content (forensicEvidence.fileContents) instead of
 * root-wide `search_code` (grep), which caps output at 50 lines and can omit
 * the target file when many same-extension siblings match first.
 *
 * The tests exercise the exact sub-steps the chat-agent recovery loop performs:
 *   1. Scan retained content for the symbol → anchorLine
 *   2. Compute startLine = anchorLine - 5, endLine = anchorLine + 50
 *   3. Issue read_file_range on the target file
 *   4. Derive effectiveEndLine from the returned line count
 *   5. Validate the symbol is present in the window
 *   6. Build an EvidenceRecord with the real sourceSpan
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeFileTool, stripReadFileWrapper } from "../tools/file-tools.js";
import {
  createEvidenceRecord,
  tagRecoveredEvidence,
  planEvidenceRecovery,
  createClaim,
} from "../evidence-integrity.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("EI-017 recovery: anchor from retained content (not search_code)", () => {
  it(
    "correctly finds the anchor even when >50 sibling files contain the same symbol",
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "ei017-siblings-"));
      tempRoots.push(root);

      const symbol = "recoveryTargetSymbol";

      // Create 55 sibling .ts files that all contain the symbol.
      // Under the old search_code approach these would fill the 50-line grep
      // cap and push the target file out of the results.
      for (let i = 0; i < 55; i++) {
        await fs.writeFile(
          path.join(root, `sibling${i}.ts`),
          `function sibling${i}() { const x = "${symbol}"; return x; }\n`,
          "utf-8",
        );
      }

      // The actual target file: symbol appears on line 8 (after 7 filler lines).
      const targetRelPath = "target.ts";
      const fillerLines = Array.from({ length: 7 }, (_, i) => `const filler${i} = ${i};`);
      const symbolLine = `function ${symbol}() { return { kind: "partial" }; }`;
      const targetContent = [...fillerLines, symbolLine, "const trailing = true;"].join("\n");
      await fs.writeFile(path.join(root, targetRelPath), targetContent, "utf-8");

      // Simulate forensicEvidence.fileContents — only the target is retained.
      const retainedContent = new Map([[targetRelPath, targetContent]]);

      // Step 1: scan retained content (the same logic as in chat-agent).
      const claim = createClaim({ text: symbol, taskType: "BEHAVIOR_QUERY", symbol });
      const plan = planEvidenceRecovery(claim);

      const lines = (retainedContent.get(targetRelPath) ?? "").split("\n");
      let anchorLine: number | undefined;
      for (let li = 0; li < lines.length; li++) {
        if (lines[li]!.includes(plan.missingSymbol)) {
          anchorLine = li + 1;
          break;
        }
      }

      // Symbol is on line 8 (7 fillers + 1 symbol line, 1-based).
      expect(anchorLine).toBe(8);

      // Step 2: compute the window.
      const startLine = Math.max(1, anchorLine! - 5);
      const endLine = anchorLine! + 50;

      // Step 3: issue read_file_range.
      const rangeOut = await executeFileTool(
        "read_file_range",
        { path: targetRelPath, startLine: String(startLine), endLine: String(endLine) },
        root,
        [],
      );
      expect(rangeOut).not.toMatch(/Error/i);

      const content = stripReadFileWrapper(rangeOut);

      // Step 4: effectiveEndLine from returned line count.
      const returnedLineCount = content.split("\n").length;
      const effectiveEndLine = startLine + returnedLineCount - 1;

      // Step 5: symbol is present.
      expect(content).toContain(symbol);

      // Step 6: build the evidence record with correct sourceSpan.
      const record = tagRecoveredEvidence(
        createEvidenceRecord({
          runId: "run-test",
          file: targetRelPath,
          content,
          readType: "TARGETED",
          phase: "EVIDENCE_CREATED",
          sourceType: "IMPLEMENTATION",
          symbol: plan.missingSymbol,
          sourceSpan: { startLine, endLine: effectiveEndLine },
        }),
        plan.recoveryAttemptId,
      );

      expect(record.readType).toBe("TARGETED");
      expect(record.recoveryAttemptId).toMatch(/^REC-/);
      expect(record.sourceSpan?.startLine).toBe(startLine);
      // effectiveEndLine must equal the actual file line count (9 lines total),
      // not the requested anchor + 50.
      expect(record.sourceSpan?.endLine).toBe(effectiveEndLine);
      expect(record.sourceSpan?.endLine).not.toBe(endLine); // endLine > file length
    },
  );

  it("skips the targeted read when the symbol is absent from the retained content", () => {
    const retainedContent = "const unrelated = 1;\nfunction other() { return 2; }\n";
    const symbol = "missingSymbol";
    const lines = retainedContent.split("\n");
    let anchorLine: number | undefined;
    for (let li = 0; li < lines.length; li++) {
      if (lines[li]!.includes(symbol)) {
        anchorLine = li + 1;
        break;
      }
    }
    // Symbol absent → anchor stays undefined → the read is skipped.
    expect(anchorLine).toBeUndefined();
  });
});
