import { describe, expect, it, vi } from "vitest";
import {
  createPreviewBuilderHandler,
  type PreviewBuilderHandlerDependencies,
} from "./preview-builder-handler.js";

describe("Preview Builder HTTP handler", () => {
  it("accepts only the signed token and rejects caller-supplied transfer URLs", async () => {
    const executeDependencies = {
      ecs: { describeTaskDefinition: vi.fn() },
      fence: { claimOrResume: vi.fn() },
      transferProvider: { createTransfer: vi.fn() },
      envelopeStore: { put: vi.fn() },
      config: {},
    } as unknown as PreviewBuilderHandlerDependencies;
    const handler = createPreviewBuilderHandler(executeDependencies);
    const response = await handler(
      new Request("http://gateway/internal/v1/preview/builds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "signed-job",
          inputDownloadUrl: "https://caller-controlled.example/input",
          outputUploadUrl: "https://caller-controlled.example/output",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid Builder request.",
    });
    expect(
      executeDependencies.ecs.describeTaskDefinition,
    ).not.toHaveBeenCalled();
    expect(executeDependencies.fence.claimOrResume).not.toHaveBeenCalled();
    expect(
      executeDependencies.transferProvider.createTransfer,
    ).not.toHaveBeenCalled();
    expect(executeDependencies.envelopeStore.put).not.toHaveBeenCalled();
  });
});
