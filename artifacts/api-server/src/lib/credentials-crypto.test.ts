import { describe, expect, it } from "vitest";
import { encryptApiKey, isValidEncryptionKeyHex } from "./credentials-crypto.js";

describe("credential encryption key validation", () => {
  it("accepts exactly 32 bytes represented as hex", () => {
    expect(isValidEncryptionKeyHex("ab".repeat(32))).toBe(true);
    expect(isValidEncryptionKeyHex("CD".repeat(32))).toBe(true);
  });

  it("rejects a 64-character value containing non-hex characters", () => {
    const previous = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = "g".repeat(64);
    try {
      expect(isValidEncryptionKeyHex(process.env.AI_CREDENTIALS_ENCRYPTION_KEY)).toBe(false);
      expect(() => encryptApiKey("test-credential")).toThrow(
        "AI_CREDENTIALS_ENCRYPTION_KEY must be set to a 64-character hex string",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
      } else {
        process.env.AI_CREDENTIALS_ENCRYPTION_KEY = previous;
      }
    }
  });
});
