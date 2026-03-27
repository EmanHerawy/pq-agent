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
const TAG_LEN = 16;

/** Keys stored only in `.env.secrets.encrypted` (never plaintext `.env`). */
export const ENV_SECRET_KEY_NAMES = [
  "DEPLOYER_PRIVATE_KEY",
  "AGENT_PRIVATE_KEY",
  /** JSON array of `{ id, privateKey }` for swarm slots after the primary agent. */
  "SWARM_AGENT_KEYS_JSON",
  "ONECLAW_API_KEY",
  "ONECLAW_AGENT_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SHROUD_PROVIDER_API_KEY",
] as const;

const SECRET_KEYS = new Set<string>(ENV_SECRET_KEY_NAMES as unknown as string[]);

/** Avoid writing literal "undefined"/"null" into .env (common template-literal bug). */
export function sanitizeEnvScalar(v: string | undefined | null): string {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s === "undefined" || s === "null") return "";
  return s;
}

export function buildEnvContent(vars: Record<string, string>): string {
  return (
    Object.entries(vars)
      .map(([k, v]) => `${k}=${sanitizeEnvScalar(v)}`)
      .join("\n") + "\n"
  );
}

export function splitEnvBySecrecy(vars: Record<string, string>): {
  publicVars: Record<string, string>;
  secretVars: Record<string, string>;
} {
  const publicVars: Record<string, string> = {};
  const secretVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (SECRET_KEYS.has(k)) secretVars[k] = v;
    else publicVars[k] = v;
  }
  return { publicVars, secretVars };
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
  if (data.length < SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error("Invalid encrypted payload");
  }
  const salt = data.subarray(0, SALT_LEN);
  const iv = data.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = data.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const encrypted = data.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

export type WriteEnvFileOptions = {
  /** Extra comment lines prepended to `.env` (e.g. Shroud vs AGENT_ADDRESS). */
  dotenvComment?: string;
};

/**
 * Plain `.env`: non-sensitive values only (addresses, vault id, model names, …).
 * `.env.secrets.encrypted`: AES-256-GCM JSON blob of secret keys.
 * No plaintext copy of private keys or API keys on disk.
 *
 * Plain secrets mode (no password): single `.env` with everything (dev only).
 */
export function writeEnvFile(
  projectDir: string,
  vars: Record<string, string>,
  password?: string,
  options?: WriteEnvFileOptions,
) {
  const extra =
    options?.dotenvComment && options.dotenvComment.trim() !== ""
      ? options.dotenvComment.endsWith("\n")
        ? options.dotenvComment
        : options.dotenvComment + "\n"
      : "";

  if (!password) {
    writeFileSync(
      join(projectDir, ".env"),
      extra + buildEnvContent(vars),
      { mode: 0o600 },
    );
    return;
  }

  const { publicVars, secretVars } = splitEnvBySecrecy(vars);
  const header =
    "# Non-sensitive configuration. Private keys & API keys are in .env.secrets.encrypted.\n" +
    "# Commands that need secrets (just deploy, just start, …) prompt for your password.\n" +
    "# CI/non-interactive: export SCAFFOLD_ENV_PASSWORD before running.\n\n" +
    extra;
  writeFileSync(
    join(projectDir, ".env"),
    header + buildEnvContent(publicVars),
    { mode: 0o600 },
  );

  const payload = JSON.stringify(secretVars);
  const encryptedBuf = encrypt(payload, password);
  writeFileSync(
    join(projectDir, ".env.secrets.encrypted"),
    encryptedBuf,
    { mode: 0o600 },
  );
}
