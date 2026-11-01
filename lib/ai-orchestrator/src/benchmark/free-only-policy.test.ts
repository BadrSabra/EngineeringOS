import { describe, expect, it } from "vitest";
import { selectFreeOnlyBenchmarkModels } from "./free-only-policy.js";
import { FREE_MODELS } from "../openrouter/model-catalog.js";

const catalog = [
  {
    id: "free/tool-a",
    label: "Tool A",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 16_000,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "free/tool-b",
    label: "Tool B",
    capabilities: ["chat", "coding", "tool_calling", "json"],
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
    id: "free/tools-no-chat",
    label: "Tools without Chat",
    capabilities: ["coding", "tool_calling", "json"],
    context: 16_000,
    supportsTools: true,
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
  it("selects only live free models with chat and tool-calling support", () => {
    expect(selectFreeOnlyBenchmarkModels({
      catalog,
      liveModelIds: new Set(["free/tool-a", "free/no-tools", "free/tools-no-chat", "paid/tool"]),
    })).toEqual({
      models: ["free/tool-a"],
      rejectedModels: [],
    });
  });

  it("rejects requested models that are stale, paid, tool-incompatible, or lack chat", () => {
    expect(selectFreeOnlyBenchmarkModels({
      catalog,
      liveModelIds: new Set(["free/tool-a", "free/tool-b", "free/tools-no-chat", "paid/tool"]),
      requestedModels: ["paid/tool", "free/no-tools", "stale/model", "free/tools-no-chat", "free/tool-b"],
    })).toEqual({
      models: ["free/tool-b"],
      rejectedModels: ["paid/tool", "free/no-tools", "stale/model", "free/tools-no-chat"],
    });
  });

  it("rejects the catalog's tool-capable model when it lacks chat-completions support", () => {
    const cohere = FREE_MODELS.find((model) => model.id === "cohere/north-mini-code:free")!;
    expect(cohere.supportsTools).toBe(true);
    expect(cohere.capabilities).toContain("chat");
    const incompatible = {
      ...cohere,
      capabilities: cohere.capabilities.filter((capability) => capability !== "chat"),
    };

    expect(selectFreeOnlyBenchmarkModels({
      catalog: [incompatible],
      liveModelIds: new Set([cohere.id]),
      requestedModels: [cohere.id],
      requiredCapability: "tool_calling",
    })).toEqual({
      models: [],
      rejectedModels: [cohere.id],
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