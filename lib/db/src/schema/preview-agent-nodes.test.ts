import assert from "node:assert/strict";
import test from "node:test";
import { insertPreviewAgentNodeSchema } from "./preview-agent-nodes.js";

test("Preview Agent capability reports remain server-owned", () => {
  const shape = insertPreviewAgentNodeSchema.shape;
  assert.equal("capabilityReportToken" in shape, false);
  assert.equal("capabilityExpiresAt" in shape, false);
});
