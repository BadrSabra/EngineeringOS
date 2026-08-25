import { describe, expect, it } from "vitest";
import {
  parseApplicationOrigins,
  parseValidationBudget,
  VALIDATION_OVERALL_TIMEOUT_DEFAULT_MS,
  VALIDATION_PROCESS_TIMEOUT_DEFAULT_MS,
} from "./config.js";

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

describe("validation budgets", () => {
  it("uses safe defaults when operators do not configure budgets", () => {
    expect(parseValidationBudget(undefined, {
      name: "VALIDATION_PROCESS_TIMEOUT_MS",
      defaultMs: VALIDATION_PROCESS_TIMEOUT_DEFAULT_MS,
      minMs: 5_000,
      maxMs: 600_000,
    })).toBe(VALIDATION_PROCESS_TIMEOUT_DEFAULT_MS);
    expect(parseValidationBudget("", {
      name: "VALIDATION_OVERALL_TIMEOUT_MS",
      defaultMs: VALIDATION_OVERALL_TIMEOUT_DEFAULT_MS,
      minMs: 10_000,
      maxMs: 900_000,
    })).toBe(VALIDATION_OVERALL_TIMEOUT_DEFAULT_MS);
  });

  it.each(["4999", "600001", "0", "not-a-number"])("rejects unsafe process budget %s", (raw) => {
    expect(() => parseValidationBudget(raw, {
      name: "VALIDATION_PROCESS_TIMEOUT_MS",
      defaultMs: 90_000,
      minMs: 5_000,
      maxMs: 600_000,
    })).toThrow(/VALIDATION_PROCESS_TIMEOUT_MS/);
  });

  it("accepts a bounded overall budget", () => {
    expect(parseValidationBudget("180000", {
      name: "VALIDATION_OVERALL_TIMEOUT_MS",
      defaultMs: 110_000,
      minMs: 10_000,
      maxMs: 900_000,
    })).toBe(180_000);
  });
});