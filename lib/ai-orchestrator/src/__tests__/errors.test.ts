import { describe, expect, it } from "vitest";
import { GroqClientError, safeErrorTag } from "../errors.js";

describe("safeErrorTag", () => {
  it("returns only a provider code, never provider message text", () => {
    const privateProviderDetail = "synthetic-private-provider-body";
    const error = new GroqClientError("RATE_LIMITED", privateProviderDetail, {
      context: { providerMessage: privateProviderDetail },
    });

    expect(safeErrorTag(error)).toBe("RATE_LIMITED");
    expect(safeErrorTag(error)).not.toContain(privateProviderDetail);
  });

  it("returns a bounded error class tag for ordinary errors", () => {
    const error = new Error("synthetic-private-exception-detail");
    const forgedName = new Error("safe-looking");
    forgedName.name = "synthetic-private-error-name";

    expect(safeErrorTag(error)).toBe("Error");
    expect(safeErrorTag(error)).not.toContain(error.message);
    expect(safeErrorTag(forgedName)).toBe("unknown");
    expect(safeErrorTag({ name: "private detail" })).toBe("unknown");
  });
});
