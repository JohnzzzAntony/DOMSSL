import crypto from "crypto";

/**
 * Encryption service for credentials at rest (spec §33).
 * AES-256-GCM with a server-side key from ENCRYPTION_KEY env.
 * Format: base64(iv).base64(authTag).base64(ciphertext)
 */

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw =
    process.env.ENCRYPTION_KEY ||
    "dsm-default-dev-encryption-key-change-me-in-production";
  // Derive a stable 32-byte key from the provided secret
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decrypt(payload: string): string {
  try {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return "";
    const decipher = crypto.createDecipheriv(
      ALGO,
      getKey(),
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

export function encryptJSON(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJSON<T>(payload: string, fallback: T): T {
  const raw = decrypt(payload);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Mask a secret for display: only show last 4 chars */
export function maskSecret(secret: string): string {
  if (!secret || secret.length <= 4) return "••••";
  return "••••••••••••" + secret.slice(-4);
}
