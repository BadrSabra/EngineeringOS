/**
 * AES-256-GCM encrypt/decrypt for API key storage.
 * The encryption key is 64 hex chars (32 bytes) stored in AI_CREDENTIALS_ENCRYPTION_KEY.
 *
 * Wire format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_BYTES = 16 as const; // GCM auth tag length — consumed by decipher.setAuthTag

function getEncryptionKey(): Buffer {
  const raw = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw || raw.length !== 64) {
    throw new Error(
      "AI_CREDENTIALS_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)",
    );
  }
  return Buffer.from(raw, "hex");
}

export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptApiKey(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted key format");
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  if (authTag.length !== AUTH_TAG_BYTES) throw new Error("Invalid auth tag length");
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
