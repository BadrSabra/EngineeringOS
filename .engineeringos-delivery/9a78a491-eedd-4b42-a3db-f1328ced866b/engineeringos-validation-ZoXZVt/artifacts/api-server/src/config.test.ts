import { describe, expect, it } from "vitest";
import { parseApplicationOrigins } from "./config.js";

describe("APP_ORIGINS", () => {
  it("normalizes and preserves multiple approved dashboard origins", () => {
    expect(
      parseApplicationOrigins(
        " https://dashboard.example.com/ , https://admin.example.com ",
        true,
      ),
    ).toEqual(["https://dashboard.example.com", "https://admin.example.com"]);
  });

  it("rejects missing production origins", () => {
    expect(() => parseApplicationOrigins("", true)).toThrow(/at least one/i);
  });

  it.each([
    "dashboard.example.com",
    "https://dashboard.example.com/app",
    "https://user:password@dashboard.example.com",
    "ftp://dashboard.example.com",
  ])("rejects malformed origin %s", (origin) => {
    expect(() => parseApplicationOrigins(origin, true)).toThrow(/APP_ORIGINS/i);
  });

  it("rejects duplicate normalized origins", () => {
    expect(() =>
      parseApplicationOrigins(
        "https://dashboard.example.com, https://dashboard.example.com/",
        true,
      ),
    ).toThrow(/Duplicate/i);
  });

  it("accepts deployment-provided origins as a comma-separated list", () => {
    expect(
      parseApplicationOrigins(
        "https://dashboard.example.com,https://admin.example.com",
        true,
      ),
    ).toHaveLength(2);
  });
});