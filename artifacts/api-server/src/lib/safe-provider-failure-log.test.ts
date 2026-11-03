import { describe, expect, it } from "vitest";
import { GroqClientError } from "@workspace/ai-orchestrator";
import { safeProviderFailureLogFields } from "./safe-provider-failure-log.js";

describe("safeProviderFailureLogFields", () => {
  it("keeps bounded provider metadata and excludes raw response text", () => {
    const marker = "synthetic-provider-body-marker-not-for-logs";
    const error = new GroqClientError("RATE_LIMITED", marker, {
      context: {
        providerStatus: 429,
        providerMessage: marker,
        rateLimitScope: "unknown",
        retryAfterMs: 2_500,
      },
    });

    const fields = safeProviderFailureLogFields(error);
    expect(fields).toMatchObject({
      errorKind: "provider",
      code: "RATE_LIMITED",
      providerStatus: 429,
      rateLimitScope: "unknown",
      retryAfterMs: 2_500,
    });
    expect(JSON.stringify(fields)).not.toContain(marker);
  });

  it("does not serialize unexpected error messages either", () => {
    const marker = "synthetic-unexpected-error-marker";
    const fields = safeProviderFailureLogFields(new Error(marker));

    expect(fields).toEqual({ errorKind: "unexpected" });
    expect(JSON.stringify(fields)).not.toContain(marker);
  });
});
