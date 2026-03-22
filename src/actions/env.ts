import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ALGORITHM = "aes-256-gcm";
const SALT_LEN = 32;
const IV_LEN = 16;

export function buildEnvContent(vars: Record<string, string>): string {
  return (
    Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

export function encrypt(plaintext: string, password: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]);
}

export function decrypt(data: Buffer, password: string): string {
  const salt = data.subarray(0, SALT_LEN);
  const iv = data.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = data.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + 16);
  const encrypted = data.subarray(SALT_LEN + IV_LEN + 16);
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

export function writeEnvFile(
  projectDir: string,
  vars: Record<string, string>,
  password?: string,
) {
  const content = buildEnvContent(vars);

  writeFileSync(join(projectDir, ".env"), content, { mode: 0o600 });

  if (password) {
    const encryptedBuf = encrypt(content, password);
    writeFileSync(join(projectDir, ".env.encrypted"), encryptedBuf, {
      mode: 0o600,
    });
  }
}
