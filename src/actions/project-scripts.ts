import { ENV_SECRET_KEY_NAMES } from "./env.js";

/** Encrypted secrets + helpers (matches `env.ts` AES-256-GCM layout). */
export function getSecretsCryptoScript(): string {
  const secretKeysJson = JSON.stringify([...ENV_SECRET_KEY_NAMES]);
  return `#!/usr/bin/env node
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const ALGO = "aes-256-gcm";
const SALT_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;

export const SECRET_KEY_NAMES = new Set(${secretKeysJson});

export function encryptSecretsObject(obj, password) {
  const plaintext = JSON.stringify(obj);
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]);
}

export function decryptSecretsFile(path, password) {
  const data = readFileSync(path);
  if (data.length < SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error("Invalid file");
  }
  const salt = data.subarray(0, SALT_LEN);
  const iv = data.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = data.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const encrypted = data.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const json =
    decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  return JSON.parse(json);
}

export function saveSecretsFile(path, obj, password) {
  writeFileSync(path, encryptSecretsObject(obj, password), { mode: 0o600 });
}

export function loadPublicEnvFile(envPath) {
  const out = {};
  if (!existsSync(envPath)) return out;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

export function upsertEnvLine(raw, key, value) {
  const prefix = key + "=";
  const lines = raw.split("\\n");
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(prefix)) {
      found = true;
      return prefix + value;
    }
    return line;
  });
  if (!found) out.push(prefix + value);
  return out.join("\\n").replace(/\\n*$/, "") + "\\n";
}

export function promptSecretsPassword(promptText = "Secrets password: ") {
  return new Promise((resolve, reject) => {
    const pre = process.env.SCAFFOLD_ENV_PASSWORD;
    if (pre !== undefined && pre !== "") {
      resolve(pre);
      return;
    }
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          "No TTY: set SCAFFOLD_ENV_PASSWORD for non-interactive runs",
        ),
      );
      return;
    }
    process.stdout.write(promptText);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let buf = "";
    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    }
    function onData(ch) {
      const c = ch.toString();
      if (c === "\\n" || c === "\\r" || c === "\\u0004") {
        cleanup();
        process.stdout.write("\\n");
        resolve(buf);
      } else if (c === "\\u0003") {
        cleanup();
        process.exit(1);
      } else if (c === "\\u007f" || c === "\\b") {
        buf = buf.slice(0, -1);
      } else {
        buf += c;
      }
    }
    process.stdin.on("data", onData);
  });
}
`;
}

export function getWithSecretsScript(): string {
  return `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  decryptSecretsFile,
  loadPublicEnvFile,
  promptSecretsPassword,
} from "./secrets-crypto.mjs";

const ROOT = process.cwd();
const ENC = join(ROOT, ".env.secrets.encrypted");
const DOTENV = join(ROOT, ".env");

function mergePublicIntoProcess() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "") process.env[k] = v;
  }
}

mergePublicIntoProcess();

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const cmd = split >= 0 ? argv.slice(split + 1) : argv;
if (cmd.length === 0) {
  console.error(
    "Usage: node scripts/with-secrets.mjs -- <command> [args...]",
  );
  process.exit(1);
}

async function main() {
  if (existsSync(ENC)) {
    try {
      const pw = await promptSecretsPassword(
        "Secrets password (.env.secrets.encrypted): ",
      );
      const secrets = decryptSecretsFile(ENC, pw);
      for (const [k, v] of Object.entries(secrets)) {
        if (typeof v === "string" && v !== "") process.env[k] = v;
      }
    } catch {
      console.error(
        "Wrong password or corrupt .env.secrets.encrypted",
      );
      process.exit(1);
    }
  }

  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  child.on("exit", (code, sig) => {
    process.exit(code ?? (sig ? 1 : 0));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
}

export function getDeployFoundryScript(): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const foundry = join(root, "packages", "foundry");

function runForge(args) {
  const r = spawnSync("forge", args, {
    stdio: "inherit",
    cwd: foundry,
    env: process.env,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const forgeStd = join(foundry, "lib", "forge-std", "src", "Script.sol");
if (!existsSync(forgeStd)) {
  console.log("Installing forge-std (first run)...");
  runForge(["install", "foundry-rs/forge-std", "--no-git"]);
}
runForge(["build"]);
runForge([
  "script",
  "script/Deploy.s.sol:Deploy",
  "--broadcast",
  "--rpc-url",
  "http://127.0.0.1:8545",
]);

const gen = spawnSync(process.execPath, ["scripts/generate-abi-types.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (gen.status !== 0) process.exit(gen.status ?? 1);
`;
}

export function getDeployHardhatScript(): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const hh = join(root, "packages", "hardhat");
const network = process.env.HARDHAT_NETWORK || "localhost";

let r = spawnSync("npx", ["hardhat", "deploy", "--network", network], {
  cwd: hh,
  stdio: "inherit",
  env: process.env,
});
if (r.status !== 0) process.exit(r.status ?? 1);

r = spawnSync(process.execPath, ["scripts/generate-abi-types.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (r.status !== 0) process.exit(r.status ?? 1);
`;
}

/**
 * Fund DEPLOYER_ADDRESS + optional AGENT_ADDRESS from Anvil/Hardhat account #0.
 * Exports `fundLocalAddresses` for `generate-deployer.mjs` auto-fund.
 */
export function getFundDeployerScript(): string {
  return `#!/usr/bin/env node
import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const ENV = join(ROOT, ".env");

/** Anvil & Hardhat node default account #0 (same mnemonic-derived key). */
const LOCAL_DEFAULT_ACCT0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function loadDotEnv() {
  const out = {};
  if (!existsSync(ENV)) return out;
  let raw;
  try {
    raw = readFileSync(ENV, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

/**
 * Send 100 ETH from local dev account #0 to each unique address (deployer + agent).
 * @param {string[]} addresses
 * @param {string} [rpcUrl]
 */
export async function fundLocalAddresses(addresses, rpcUrl) {
  const rpc =
    (rpcUrl && String(rpcUrl).trim()) ||
    process.env.RPC_URL?.trim() ||
    process.env.LOCALHOST_RPC_URL?.trim() ||
    "http://127.0.0.1:8545";

  const seen = new Set();
  const list = [];
  for (const a of addresses) {
    const x = typeof a === "string" ? a.trim() : "";
    if (!x.startsWith("0x")) continue;
    const low = x.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    list.push(x);
  }

  if (list.length === 0) {
    return { ok: true, funded: [], rpc };
  }

  const signer = privateKeyToAccount(LOCAL_DEFAULT_ACCT0);
  const client = createWalletClient({
    account: signer,
    chain: hardhat,
    transport: http(rpc),
  });

  const funded = [];
  try {
    for (const to of list) {
      const hash = await client.sendTransaction({
        to,
        value: parseEther("100"),
      });
      funded.push({ to, hash });
    }
    return { ok: true, funded, rpc };
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e);
    let cause = "";
    if (e instanceof Error && e.cause) {
      cause =
        e.cause instanceof Error ? e.cause.message : String(e.cause);
    }
    const combined = message + " " + cause;
    if (
      /fetch failed|ECONNREFUSED|connect ECONNREFUSED|network error/i.test(
        combined,
      )
    ) {
      message +=
        " — nothing is listening at " +
        rpc +
        ". Start the local chain first (e.g. just chain), then run just fund.";
    }
    return {
      ok: false,
      funded,
      rpc,
      message,
    };
  }
}

async function cliMain() {
  const fileEnv = loadDotEnv();
  const deployer =
    process.env.DEPLOYER_ADDRESS?.trim() || fileEnv.DEPLOYER_ADDRESS?.trim();
  const agent =
    process.env.AGENT_ADDRESS?.trim() || fileEnv.AGENT_ADDRESS?.trim();

  if (!deployer?.startsWith("0x")) {
    console.error(
      "DEPLOYER_ADDRESS missing. Set it in .env or run: just generate",
    );
    process.exit(1);
  }

  const rpc =
    process.env.RPC_URL?.trim() ||
    process.env.LOCALHOST_RPC_URL?.trim() ||
    fileEnv.RPC_URL ||
    "http://127.0.0.1:8545";

  const targets = [deployer, agent].filter((a) => a?.startsWith("0x"));
  const unique = [];
  const s = new Set();
  for (const a of targets) {
    const low = a.toLowerCase();
    if (s.has(low)) continue;
    s.add(low);
    unique.push(a);
  }

  console.log("\\n  Funding from local account #0 via " + rpc);
  for (const addr of unique) {
    console.log("    → " + addr);
  }

  const result = await fundLocalAddresses(unique, rpc);
  if (!result.ok) {
    console.error("\\n  Failed:", result.message || "unknown");
    console.error(
      "  Is the chain running? (just chain) Same RPC? Override with RPC_URL in .env\\n",
    );
    process.exit(1);
  }
  for (const f of result.funded) {
    console.log("  Tx " + f.to.slice(0, 10) + "…: " + f.hash);
  }
  console.log("  Done — run: just deploy\\n");
}

const entry = process.argv[1] && resolve(process.argv[1]);
const isMain = entry && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  cliMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
`;
}

export function getGenerateDeployerScript(): string {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  decryptSecretsFile,
  loadPublicEnvFile,
  promptSecretsPassword,
  saveSecretsFile,
  upsertEnvLine,
} from "./secrets-crypto.mjs";

const ROOT = process.cwd();
const ENV_PATH = join(ROOT, ".env");
const ENC_PATH = join(ROOT, ".env.secrets.encrypted");

async function tryAutoFundDeployer(address) {
  const fundPath = join(ROOT, "scripts", "fund-deployer.mjs");
  if (!existsSync(fundPath)) return;
  if (process.env.SCAFFOLD_SKIP_AUTO_FUND === "1") return;
  try {
    const { fundLocalAddresses } = await import("./fund-deployer.mjs");
    const pub = loadPublicEnvFile(ENV_PATH);
    const rpc =
      process.env.RPC_URL?.trim() ||
      process.env.LOCALHOST_RPC_URL?.trim() ||
      (pub.RPC_URL && String(pub.RPC_URL).trim()) ||
      "http://127.0.0.1:8545";
    const result = await fundLocalAddresses([address], rpc);
    if (result.ok && result.funded.length) {
      console.log(
        "  Auto-funded deployer on local devnet (100 ETH from account #0): " +
          address,
      );
    } else if (!result.ok) {
      console.log(
        "  Auto-fund skipped: " +
          (result.message || "chain unreachable") +
          ". Run just chain then just fund when ready.",
      );
    }
  } catch {
    console.log(
      "  Auto-fund skipped. Run just chain then just fund when ready.",
    );
  }
}

async function main() {
  if (existsSync(ENC_PATH)) {
    const pw = await promptSecretsPassword(
      "Secrets password (to update .env.secrets.encrypted): ",
    );
    let secrets;
    try {
      secrets = decryptSecretsFile(ENC_PATH, pw);
    } catch {
      console.error("Invalid password or corrupt .env.secrets.encrypted");
      process.exit(1);
    }
    if (secrets.DEPLOYER_PRIVATE_KEY) {
      const pub = loadPublicEnvFile(ENV_PATH);
      console.log("\\n  Deployer already exists.");
      if (pub.DEPLOYER_ADDRESS) console.log("  Address: " + pub.DEPLOYER_ADDRESS);
      console.log("");
      process.exit(0);
    }
    const { generatePrivateKey, privateKeyToAccount } = await import(
      "viem/accounts"
    );
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    secrets.DEPLOYER_PRIVATE_KEY = privateKey;
    saveSecretsFile(ENC_PATH, secrets, pw);
    let raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
    raw = upsertEnvLine(raw, "DEPLOYER_ADDRESS", account.address);
    writeFileSync(ENV_PATH, raw, { mode: 0o600 });
    console.log("\\n  \\u2714 Generated deployer wallet");
    console.log("  Address: " + account.address);
    console.log("");
    try {
      const qrcode = await import("qrcode-terminal");
      qrcode.default.generate(account.address, { small: true });
    } catch {
      /* optional */
    }
    await tryAutoFundDeployer(account.address);
    return;
  }

  if (existsSync(ENV_PATH)) {
    const env = readFileSync(ENV_PATH, "utf8");
    if (/DEPLOYER_PRIVATE_KEY=0x[0-9a-fA-F]+/.test(env)) {
      const match = env.match(/DEPLOYER_ADDRESS=([^\\n]+)/);
      console.log("\\n  Deployer already exists.");
      if (match) console.log("  Address: " + match[1]);
      console.log("");
      process.exit(0);
    }
  }

  const { generatePrivateKey, privateKeyToAccount } = await import(
    "viem/accounts"
  );
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  let envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  if (envContent.length > 0 && !envContent.endsWith("\\n")) envContent += "\\n";
  envContent += "DEPLOYER_PRIVATE_KEY=" + privateKey + "\\n";
  envContent += "DEPLOYER_ADDRESS=" + account.address + "\\n";
  writeFileSync(ENV_PATH, envContent, { mode: 0o600 });
  console.log("\\n  \\u2714 Generated deployer wallet");
  console.log("  Address: " + account.address);
  console.log("");
  try {
    const qrcode = await import("qrcode-terminal");
    qrcode.default.generate(account.address, { small: true });
  } catch {
    /* optional */
  }
  await tryAutoFundDeployer(account.address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
}

/**
 * List agents + vault IDs via 1Claw REST API (user ONECLAW_API_KEY only — fetch, no extra deps).
 */
export function getList1clawIdsScript(): string {
  return `#!/usr/bin/env node
/**
 * Lists agents (UUIDs for ONECLAW_AGENT_ID) and vaults (ONECLAW_VAULT_ID).
 * Auth: your *user* ONECLAW_API_KEY (same as scaffold CLI).
 *
 * Agent API keys are only returned on create or rotate — never listed.
 *
 *   just list-1claw
 *   ONECLAW_API_KEY=1ck_... node scripts/list-1claw-ids.mjs
 */
const BASE = "https://api.1claw.xyz";

async function getToken(apiKey) {
  const res = await fetch(BASE + "/v1/auth/api-key-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) {
    throw new Error(
      "1Claw auth failed: " + res.status + " " + (await res.text()),
    );
  }
  const j = await res.json();
  return j.access_token;
}

async function main() {
  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  if (!apiKey) {
    console.error("Missing ONECLAW_API_KEY (set in .env or use just list-1claw)");
    process.exit(1);
  }

  const t = await getToken(apiKey);
  const auth = { Authorization: "Bearer " + t };

  const [agentsRes, vaultsRes] = await Promise.all([
    fetch(BASE + "/v1/agents", { headers: auth }),
    fetch(BASE + "/v1/vaults", { headers: auth }),
  ]);

  const agentsJson = await agentsRes.json().catch(() => ({}));
  const vaultsJson = await vaultsRes.json().catch(() => ({}));

  if (!agentsRes.ok) {
    console.error("GET /v1/agents", agentsRes.status, agentsJson);
    process.exit(1);
  }
  if (!vaultsRes.ok) {
    console.error("GET /v1/vaults", vaultsRes.status, vaultsJson);
    process.exit(1);
  }

  const agents = agentsJson.agents ?? agentsJson.data?.agents ?? [];
  const vaults = vaultsJson.vaults ?? vaultsJson.data?.vaults ?? [];

  console.log("\\n  1Claw IDs for .env:\\n");
  console.log("  Vaults → ONECLAW_VAULT_ID");
  if (!vaults.length) console.log("    (none)");
  else for (const v of vaults) {
    const id = v.id ?? v.vault_id;
    const name = v.name ? " (" + v.name + ")" : "";
    console.log("    " + id + name);
  }
  console.log("\\n  Agents → ONECLAW_AGENT_ID (UUID from 1Claw, not an ETH address)");
  if (!agents.length) console.log("    (none)");
  else for (const a of agents) {
    const name = a.name ? " (" + a.name + ")" : "";
    console.log("    " + a.id + name);
  }
  console.log(
    "\\n  ONECLAW_AGENT_API_KEY is only shown when you create or rotate an agent;\\n" +
      "  use the dashboard or @1claw/sdk: client.agents.rotateKey(agentId).\\n",
  );
  console.log(
    "  Programmatic listing: @1claw/sdk createClient({ apiKey }).agents.list()\\n" +
      "  and .vault.list() — see https://github.com/1clawAI/1claw-sdk\\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
}
