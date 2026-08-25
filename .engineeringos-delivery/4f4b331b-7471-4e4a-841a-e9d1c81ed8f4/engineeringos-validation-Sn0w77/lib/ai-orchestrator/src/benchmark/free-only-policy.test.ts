import { describe, expect, it } from "vitest";
import { selectFreeOnlyBenchmarkModels } from "./free-only-policy.js";

const catalog = [
  {
    id: "free/tool-a",
    label: "Tool A",
    capabilities: ["coding", "tool_calling", "json"],
    context: 16_000,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "free/tool-b",
    label: "Tool B",
    capabilities: ["coding", "tool_calling", "json"],
    context: 16_000,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  {
    id: "free/no-tools",
    label: "No Tools",
    capabilities: ["coding"],
    context: 16_000,
    supportsTools: false,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "paid/tool",
    label: "Paid Tool",
    capabilities: ["coding", "tool_calling", "json"],
    context: 16_000,
    supportsTools: true,
    supportsJson: true,
    free: false,
    quality: "powerful",
  },
] as const;

describe("free-only benchmark model policy", () => {
  it("selects only live free models with tool calling", () => {
    expect(selectFreeOnlyBenchmarkModels({
      catalog,
      liveModelIds: new Set(["free/tool-a", "free/no-tools", "paid/tool"]),
    })).toEqual({
      models: ["free/tool-a"],
      rejectedModels: [],
    });
  });

  it("rejects requested models that are stale, paid, or tool-incompatible", () => {
    expect(selectFreeOnlyBenchmarkModels({
      catalog,
      liveModelIds: new Set(["free/tool-a", "free/tool-b", "paid/tool"]),
      requestedModels: ["paid/tool", "free/no-tools", "stale/model", "free/tool-b"],
    })).toEqual({
      models: ["free/tool-b"],
      rejectedModels: ["paid/tool", "free/no-tools", "stale/model"],
    });
  });

  it("keeps the free model lane bounded", () => {
    expect(selectFreeOnlyBenchmarkModels({
      catalog,
      liveModelIds: new Set(["free/tool-a", "free/tool-b"]),
      maxModels: 1,
    }).models).toEqual(["free/tool-a"]);
  });
});