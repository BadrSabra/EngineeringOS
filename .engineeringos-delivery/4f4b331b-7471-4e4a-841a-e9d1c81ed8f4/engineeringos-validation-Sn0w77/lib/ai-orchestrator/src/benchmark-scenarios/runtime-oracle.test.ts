import { describe, expect, it } from "vitest";

const value = "broken";

describe("runtime oracle", () => {
  it("proves the pending behavior", () => expect(value).toBe("fixed"));
});
