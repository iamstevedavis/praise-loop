import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
// Authenticated encryption (AES-256-GCM) for provider tokens at rest. The associated
// data binds a ciphertext to its owner/business/provider so it cannot be replayed
// onto another connection. The key comes from runtime config (CREDENTIAL_ENCRYPTION_KEY,
// 32 bytes base64); a version prefix supports rotation: "v1.<iv>.<tag>.<data>".
export function loadKey(raw = process.env.CREDENTIAL_ENCRYPTION_KEY): Buffer {
  const key = Buffer.from(raw ?? "", "base64");
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return key;
}
export function encryptCredential(plain: string, aad: string, key = loadKey()): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}
export function decryptCredential(token: string, aad: string, key = loadKey()): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("unsupported credential format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAAD(Buffer.from(aad)); d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
