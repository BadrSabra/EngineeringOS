import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openrouterCompleteWithFallback: vi.fn(),
  refreshDynamicCatalog: vi.fn(),
  resolveExecutionModel: vi.fn(),
}));

vi.mock("../openai-compatible-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openai-compatible-client.js")>();
  return {
    ...actual,
    openrouterCompleteWithFallback: mocks.openrouterCompleteWithFallback,
  };
});

vi.mock("../openrouter/dynamic-catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openrouter/dynamic-catalog.js")>();
  return {
    ...actual,
    refreshDynamicCatalog: mocks.refreshDynamicCatalog,
  };
});

vi.mock("../model-selection/model-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model-selection/model-resolver.js")>();
  return {
    ...actual,
    resolveExecutionModel: mocks.resolveExecutionModel,
  };
});

import { agentComplete } from "../agent-complete.js";

describe("agentComplete pinned OpenRouter model selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveExecutionModel.mockReturnValue({
      model: "liquid/lfm-2.5-2.6b:free",
      capability: "coding",
      quality: "powerful",
    });
    mocks.openrouterCompleteWithFallback.mockResolvedValue({
      content: "review result",
      model: "liquid/lfm-2.5-2.6b:free",
    });
  });

  it("disables the shared model lane for a measured single-model attempt", async () => {
    await agentComplete(
      [{ role: "user", content: "Review this synthetic fixture." }],
      {
        provider: "openrouter",
        apiKey: "test-key",
        qualityProfile: "code_review",
        stopAfterFirstModelAttempt: true,
        maxFallbackModels: 1,
      },
    );

    expect(mocks.refreshDynamicCatalog).toHaveBeenCalledWith("test-key");
    expect(mocks.openrouterCompleteWithFallback).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        model: "liquid/lfm-2.5-2.6b:free",
        useSharedLaneCursor: false,
        maxFallbackModels: 1,
      }),
    );
  });

  it("keeps ordinary OpenRouter requests on the shared free-model lane", async () => {
    await agentComplete(
      [{ role: "user", content: "A normal chat request." }],
      {
        provider: "openrouter",
        apiKey: "test-key",
      },
    );

    expect(mocks.openrouterCompleteWithFallback).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        useSharedLaneCursor: true,
      }),
    );
  });

  it("forwards isolated cooldown and lane-cursor stores to the OpenRouter client", async () => {
    const modelCooldownPersistence = {
      readActive: vi.fn().mockResolvedValue([]),
      write: vi.fn(),
      clear: vi.fn(),
    };
    const credentialCooldownPersistence = {
      readActive: vi.fn().mockResolvedValue(null),
      write: vi.fn(),
    };
    const modelLaneCursorPersistence = {
      reserveSlot: vi.fn().mockResolvedValue(0),
    };

    await agentComplete(
      [{ role: "user", content: "Review this disposable fixture." }],
      {
        provider: "openrouter",
        apiKey: "test-key",
        modelCooldownPersistence,
        credentialCooldownPersistence,
        modelLaneCursorPersistence,
      },
    );

    expect(mocks.openrouterCompleteWithFallback).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        modelCooldownPersistence,
        credentialCooldownPersistence,
        modelLaneCursorPersistence,
      }),
    );
  });
});
