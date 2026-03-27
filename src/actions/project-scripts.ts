import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_SECRET_KEY_NAMES } from "./env.js";

const __projectScriptsDir = dirname(fileURLToPath(import.meta.url));

/** Bundled next to dist/cli.js as dist/secret-add.mjs (see tsup onSuccess); dev: src/scaffold-templates. */
export function getSecretAddScript(): string {
  const candidates = [
    join(__projectScriptsDir, "secret-add.mjs"),
    join(__projectScriptsDir, "..", "scaffold-templates", "secret-add.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  throw new Error(
    "secret-add.mjs not found (expected dist/secret-add.mjs after npm run build, or src/scaffold-templates/secret-add.mjs in dev).",
  );
}

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

/** RPC + chain ids for `deploy-*` / `verify-*` (kept in sync with scaffold network names). */
export function getDeployNetworksModuleScript(): string {
  return `/**
 * Shared deploy/verify network resolution (used by deploy-foundry, deploy-hardhat, verify-*).
 * Override RPC for public chains with RPC_URL in .env.
 */
const DEFAULT_RPC = {
  localhost: "http://127.0.0.1:8545",
  sepolia: "https://rpc.sepolia.org",
  base: "https://mainnet.base.org",
  baseSepolia: "https://sepolia.base.org",
  ethereum: "https://eth.llamarpc.com",
  mainnet: "https://eth.llamarpc.com",
  polygon: "https://polygon-rpc.com",
  bnb: "https://bsc-dataseed.binance.org",
  bsc: "https://bsc-dataseed.binance.org",
};

const CHAIN_IDS = {
  localhost: 31337,
  sepolia: 11155111,
  base: 8453,
  baseSepolia: 84532,
  ethereum: 1,
  mainnet: 1,
  polygon: 137,
  bnb: 56,
  bsc: 56,
};

/** \`forge verify-contract --chain <x>\` */
const FORGE_CHAIN = {
  localhost: "31337",
  sepolia: "sepolia",
  base: "base",
  baseSepolia: "base-sepolia",
  ethereum: "mainnet",
  mainnet: "mainnet",
  polygon: "polygon",
  bnb: "bsc",
  bsc: "bsc",
};

const ALIASES = {
  local: "localhost",
  anvil: "localhost",
  "31337": "localhost",
  eth: "ethereum",
  matic: "polygon",
  base_sepolia: "baseSepolia",
  "base-sepolia": "baseSepolia",
  basesepolia: "baseSepolia",
};

export function normalizeNetwork(name) {
  const raw = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  const compact = raw.replace(/-/g, "");
  const n = compact === "basesepolia" ? "baseSepolia" : raw;
  const k = ALIASES[n] || ALIASES[compact] || n;
  if (!DEFAULT_RPC[k]) {
    throw new Error(
      'Unknown network "' +
        name +
        '". Use: localhost, sepolia, base, baseSepolia, ethereum, polygon, bnb',
    );
  }
  return k === "mainnet" ? "ethereum" : k;
}

function scanArgvForNetwork(argv, initial) {
  let network = initial;
  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--network" || a === "-n") {
      network = args[i + 1];
      if (!network) throw new Error("--network requires a value (e.g. base)");
      i++;
      continue;
    }
    if (a.startsWith("--network=")) {
      network = a.slice("--network=".length);
      continue;
    }
    if (!a.startsWith("-") && (network === null || network === undefined || network === "")) {
      network = a;
    }
  }
  return network;
}

/** deploy-foundry / deploy-hardhat (CLI / --network overrides DEPLOY_NETWORK) */
export function parseDeployNetwork(argv) {
  let network = scanArgvForNetwork(argv, null);
  if (!(network || "").trim()) network = (process.env.DEPLOY_NETWORK || "").trim();
  const resolved = (network || "localhost").trim();
  return normalizeNetwork(resolved);
}

/** verify-* ; argv / VERIFY_NETWORK, else default sepolia */
export function parseVerifyNetwork(argv) {
  let network = scanArgvForNetwork(argv, null);
  if (!(network || "").trim()) network = (process.env.VERIFY_NETWORK || "").trim();
  let resolved = (network || "").trim();
  if (!resolved) {
    resolved = "sepolia";
    console.error(
      "verify: no network specified — using sepolia (try: just verify base)",
    );
  }
  return normalizeNetwork(resolved);
}

export function getRpcUrl(networkKey) {
  const k = normalizeNetwork(networkKey);
  if (k === "localhost") return DEFAULT_RPC.localhost;
  const fromEnv = (process.env.RPC_URL || "").trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_RPC[k];
}

export function getChainId(networkKey) {
  return CHAIN_IDS[normalizeNetwork(networkKey)];
}

export function getForgeChain(networkKey) {
  return FORGE_CHAIN[normalizeNetwork(networkKey)];
}

export function isLocalNetwork(networkKey) {
  return normalizeNetwork(networkKey) === "localhost";
}

/** Hardhat \`--network\` name (ethereum mainnet → \`mainnet\`) */
export function getHardhatNetworkName(networkKey) {
  const k = normalizeNetwork(networkKey);
  if (k === "ethereum") return "mainnet";
  return k;
}

/** Which API key env var to prefer for block explorer verification */
export function getExplorerKeyEnv(networkKey) {
  const k = normalizeNetwork(networkKey);
  if (k === "base" || k === "baseSepolia") return "BASESCAN_API_KEY";
  if (k === "polygon") return "POLYGONSCAN_API_KEY";
  if (k === "bnb") return "BSCSCAN_API_KEY";
  return "ETHERSCAN_API_KEY";
}

export function getExplorerApiKey(networkKey) {
  const primary = getExplorerKeyEnv(networkKey);
  const k = normalizeNetwork(networkKey);
  const v =
    (process.env[primary] || "").trim() ||
    (process.env.ETHERSCAN_API_KEY || "").trim();
  if (!v) {
    throw new Error(
      "Set " +
        primary +
        " or ETHERSCAN_API_KEY in .env to verify on " +
        k,
    );
  }
  return v;
}
`;
}

export function getDeployFoundryScript(): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseDeployNetwork, getRpcUrl } from "./deploy-networks.mjs";

const root = process.cwd();
const foundry = join(root, "packages", "foundry");

const network = parseDeployNetwork(process.argv.slice(2));
const rpcUrl = getRpcUrl(network);
console.log("Deploy network:", network, "RPC:", rpcUrl);

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
  rpcUrl,
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
import { parseDeployNetwork, getHardhatNetworkName } from "./deploy-networks.mjs";

const root = process.cwd();
const hh = join(root, "packages", "hardhat");
const network = getHardhatNetworkName(parseDeployNetwork(process.argv.slice(2)));
console.log("Deploy network:", network);

let r = spawnSync("npx", ["hardhat", "deploy", "--network", network], {
  cwd: hh,
  stdio: "inherit",
  env: { ...process.env, HARDHAT_NETWORK: network },
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

export function getVerifyFoundryScript(): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseVerifyNetwork,
  getChainId,
  getForgeChain,
  isLocalNetwork,
  getExplorerApiKey,
} from "./deploy-networks.mjs";

const root = process.cwd();
const foundry = join(root, "packages", "foundry");

const network = parseVerifyNetwork(process.argv.slice(2));

if (isLocalNetwork(network)) {
  console.log("Skipping explorer verification for localhost (chain 31337).");
  process.exit(0);
}

const chainId = getChainId(network);
const broadcastDir = join(
  foundry,
  "broadcast",
  "Deploy.s.sol",
  String(chainId),
);
const runLatest = join(broadcastDir, "run-latest.json");
if (!existsSync(runLatest)) {
  console.error("Missing", runLatest);
  console.error("Deploy first: just deploy " + network);
  process.exit(1);
}

const run = JSON.parse(readFileSync(runLatest, "utf8"));
const txs = run.transactions || [];
const created = txs.find(
  (t) =>
    t.transactionType === "CREATE" &&
    (t.contractName === "AgentWallet" || t.contractName?.includes("AgentWallet")),
);
if (!created?.contractAddress) {
  console.error("Could not find AgentWallet CREATE in run-latest.json");
  process.exit(1);
}

const address = created.contractAddress;
const agentRaw = (process.env.AGENT_ADDRESS || "").trim() || "0x0000000000000000000000000000000000000000";
const agentAddr = agentRaw.startsWith("0x") ? agentRaw : "0x" + agentRaw;

const enc = spawnSync(
  "cast",
  ["abi-encode", "constructor(address)", agentAddr],
  { cwd: foundry, encoding: "utf8" },
);
if (enc.status !== 0) {
  console.error(enc.stderr || "cast abi-encode failed");
  process.exit(1);
}
const constructorArgs = enc.stdout.trim().replace(/^0x/i, "");

const apiKey = getExplorerApiKey(network);
const forgeChain = getForgeChain(network);

console.log("Verifying AgentWallet at", address, "on", network, "(forge --chain", forgeChain + ")");

const r = spawnSync(
  "forge",
  [
    "verify-contract",
    address,
    "src/AgentWallet.sol:AgentWallet",
    "--chain",
    forgeChain,
    "--constructor-args",
    constructorArgs,
    "--etherscan-api-key",
    apiKey,
  ],
  { stdio: "inherit", cwd: foundry, env: process.env },
);
if (r.error) {
  console.error(r.error);
  process.exit(1);
}
process.exit(r.status ?? 1);
`;
}

export function getVerifyHardhatScript(): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseVerifyNetwork,
  isLocalNetwork,
  getHardhatNetworkName,
} from "./deploy-networks.mjs";

const root = process.cwd();
const hh = join(root, "packages", "hardhat");

const logicalNetwork = parseVerifyNetwork(process.argv.slice(2));

if (isLocalNetwork(logicalNetwork)) {
  console.log("Skipping explorer verification for localhost.");
  process.exit(0);
}

const network = getHardhatNetworkName(logicalNetwork);

const artifactPath = join(hh, "deployments", network, "AgentWallet.json");
if (!existsSync(artifactPath)) {
  console.error("Missing", artifactPath);
  console.error("Deploy first: just deploy " + network);
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const addr = artifact.address;
const args = Array.isArray(artifact.args) ? artifact.args : [];

console.log("Verifying AgentWallet at", addr, "on", network);

const verifyArgs = ["hardhat", "verify", "--network", network, addr, ...args.map(String)];
const r = spawnSync("npx", verifyArgs, {
  cwd: hh,
  stdio: "inherit",
  env: process.env,
});
if (r.error) {
  console.error(r.error);
  process.exit(1);
}
process.exit(r.status ?? 1);
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
 *
 * Loads repo-root .env automatically (same keys as \`just list-1claw\` for plain .env).
 * Optional: append --write-env to set ONECLAW_VAULT_ID / ONECLAW_AGENT_ID from the
 * first vault + first agent returned (does not touch ONECLAW_AGENT_API_KEY).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicEnvFile, upsertEnvLine } from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");

const BASE = "https://api.1claw.xyz";

/** Merge repo-root .env into process.env without overriding the shell. */
function mergePublicDotenv() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "" && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

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
  const argv = process.argv.slice(2);
  const writeEnv = argv.includes("--write-env");

  mergePublicDotenv();

  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  if (!apiKey) {
    console.error(
      "Missing ONECLAW_API_KEY (add to .env, .env.secrets.encrypted via just list-1claw, or export in shell)",
    );
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

  if (writeEnv) {
    if (!existsSync(DOTENV)) {
      console.error("Cannot --write-env: missing " + DOTENV);
      process.exit(1);
    }
    let raw = readFileSync(DOTENV, "utf8");
    const v0 = vaults[0];
    const a0 = agents[0];
    const vid = v0 ? v0.id ?? v0.vault_id : "";
    const aid = a0 ? a0.id : "";
    if (vid) {
      raw = upsertEnvLine(raw, "ONECLAW_VAULT_ID", vid);
      console.log("\\n  Wrote ONECLAW_VAULT_ID=" + vid);
    } else {
      console.log("\\n  No vault returned — left ONECLAW_VAULT_ID unchanged");
    }
    if (aid) {
      raw = upsertEnvLine(raw, "ONECLAW_AGENT_ID", aid);
      console.log("  Wrote ONECLAW_AGENT_ID=" + aid);
    } else {
      console.log(
        "  No agent returned — left ONECLAW_AGENT_ID unchanged (create an agent or use scaffold)",
      );
    }
    writeFileSync(DOTENV, raw, "utf8");
    console.log("  Updated " + DOTENV + "\\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
}

/**
 * Re-run 1Claw vault + secrets + agent registration (same shape as initial scaffold).
 * For when scaffold hit org limits, API errors, or keys were deferred.
 */
export function getReset1clawSetupScript(): string {
  return `#!/usr/bin/env node
/**
 * Re-bootstrap 1Claw: new vault, store deployer (+ optional agent) keys, register agent,
 * update repo-root .env (ONECLAW_VAULT_ID, ONECLAW_AGENT_ID). Prints new ONECLAW_AGENT_API_KEY
 * once — add it with \`just enc ONECLAW_AGENT_API_KEY 'ocv_...'\` if you use encrypted secrets.
 *
 *   just reset              # warns, then prompts to type YES
 *   just reset -- --yes     # skip confirmation (automation)
 *
 * Requires: ONECLAW_API_KEY, DEPLOYER_PRIVATE_KEY (via with-secrets / .env).
 * Optional: AGENT_PRIVATE_KEY (on-chain agent path). If absent, registers a Shroud-only agent.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readlinePromises from "node:readline/promises";
import { loadPublicEnvFile, upsertEnvLine } from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");
const ENC = join(ROOT, ".env.secrets.encrypted");
const PKG = join(ROOT, "package.json");
const BASE = "https://api.1claw.xyz";

function mergePublicDotenv() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "" && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

function parseVaultId(json) {
  if (!json || typeof json !== "object") throw new Error("Invalid vault response");
  const o = json;
  if (typeof o.id === "string" && o.id.trim()) return o.id.trim();
  const v = o.vault;
  if (v && typeof v === "object" && typeof v.id === "string") return v.id.trim();
  const d = o.data;
  if (d && typeof d === "object") {
    if (typeof d.id === "string" && d.id.trim()) return d.id.trim();
    const iv = d.vault;
    if (iv && typeof iv === "object" && typeof iv.id === "string") return iv.id.trim();
  }
  throw new Error("Unexpected vault create response");
}

function parseAgentCreated(json) {
  if (!json || typeof json !== "object") throw new Error("Invalid agent response");
  const o = json;
  let id;
  let apiKey;
  const ag = o.agent;
  if (ag && typeof ag === "object" && typeof ag.id === "string") id = ag.id.trim();
  if (!id && typeof o.id === "string") id = o.id.trim();
  if (typeof o.api_key === "string") apiKey = o.api_key.trim();
  const d = o.data;
  if (d && typeof d === "object") {
    const inner = d.agent;
    if (!id && inner && typeof inner === "object" && typeof inner.id === "string") {
      id = inner.id.trim();
    }
    if (!apiKey && typeof d.api_key === "string") apiKey = d.api_key.trim();
  }
  if (!id || !apiKey) throw new Error("Unexpected agent create response (need id + api_key)");
  return { id, apiKey };
}

async function getToken(apiKey) {
  const res = await fetch(BASE + "/v1/auth/api-key-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) throw new Error("1Claw auth failed: " + res.status + " " + (await res.text()));
  return (await res.json()).access_token;
}

async function createVault(token, name) {
  const res = await fetch(BASE + "/v1/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      name,
      description: "Vault from just reset (" + name + ")",
    }),
  });
  if (!res.ok) throw new Error("Create vault failed: " + res.status + " " + (await res.text()));
  return parseVaultId(await res.json());
}

async function storeSecret(token, vaultId, path, value, type = "private_key") {
  const enc = encodeURIComponent(path);
  const res = await fetch(BASE + "/v1/vaults/" + vaultId + "/secrets/" + enc, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ value, type }),
  });
  if (!res.ok) {
    throw new Error("Store secret " + path + " failed: " + res.status + " " + (await res.text()));
  }
}

async function registerAgent(token, name) {
  const res = await fetch(BASE + "/v1/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Register agent failed: " + res.status + " " + (await res.text()));
  return parseAgentCreated(await res.json());
}

function readPkgName() {
  if (!existsSync(PKG)) return "agent-project";
  try {
    const j = JSON.parse(readFileSync(PKG, "utf8"));
    if (typeof j.name === "string" && j.name.trim()) return j.name.trim().replace(/^@[^/]+\\//, "");
  } catch {
    /* fall through */
  }
  return "agent-project";
}

async function main() {
  const argv = process.argv.slice(2);
  const skipConfirm = argv.includes("--yes") || argv.includes("-y");

  mergePublicDotenv();

  console.log(
    "\\n" +
      "╔══════════════════════════════════════════════════════════════════════╗\\n" +
      "║  WARNING: just reset — 1Claw re-bootstrap                             ║\\n" +
      "╠══════════════════════════════════════════════════════════════════════╣\\n" +
      "║  • This creates a **new** vault and **new** Shroud/agent credentials. ║\\n" +
      "║  • Your **old** vault and agents stay on 1claw.xyz (not deleted).    ║\\n" +
      "║  • **Back up** first: copy .env, .env.secrets.encrypted, and export   ║\\n" +
      "║    any keys you need. Old ONECLAW_AGENT_API_KEY will **not** work for   ║\\n" +
      "║    the new agent — you must save the new key printed below.           ║\\n" +
      "║  • Org **tier limits** (vaults/agents) still apply — upgrade or free  ║\\n" +
      "║    slots on 1claw.xyz if create/register fails.                       ║\\n" +
      "╚══════════════════════════════════════════════════════════════════════╝\\n",
  );

  if (!skipConfirm) {
    if (!process.stdin.isTTY) {
      console.error(
        "Non-interactive shell: run: just reset -- --yes   (after backing up), or use a TTY.",
      );
      process.exit(1);
    }
    const rl = readlinePromises.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ans = (await rl.question("Type YES (all caps) to continue: ")).trim();
    await rl.close();
    if (ans !== "YES") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  if (!apiKey) {
    console.error("Missing ONECLAW_API_KEY (add via just enc or .env).");
    process.exit(1);
  }
  const deployerPk = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
  if (!deployerPk) {
    console.error("Missing DEPLOYER_PRIVATE_KEY (unlock secrets: run via just reset, not bare node).");
    process.exit(1);
  }

  const pkgName = readPkgName();
  const suffix = new Date().toISOString().slice(0, 10);
  const vaultName = pkgName + "-reset-" + suffix;

  const token = await getToken(apiKey);
  console.log("\\n  Creating vault: " + vaultName + " ...");
  const vaultId = await createVault(token, vaultName);
  await storeSecret(token, vaultId, "private-keys/deployer", deployerPk, "private_key");

  const agentPk = (process.env.AGENT_PRIVATE_KEY || "").trim();
  let agentInfo;
  if (agentPk) {
    await storeSecret(token, vaultId, "private-keys/agent", agentPk, "private_key");
    agentInfo = await registerAgent(token, pkgName + "-agent");
  } else if ((process.env.RESET_SKIP_SHROUD_AGENT || "").trim() === "1") {
    console.log("  RESET_SKIP_SHROUD_AGENT=1 — skipping agent registration.");
  } else {
    agentInfo = await registerAgent(token, pkgName + "-shroud");
  }

  const llmKey = (process.env.RESET_COPY_LLM_API_KEY || "").trim();
  if (llmKey) {
    await storeSecret(token, vaultId, "llm-api-key", llmKey, "api_key");
    console.log("  Stored llm-api-key in vault (from RESET_COPY_LLM_API_KEY).");
  }

  const shroudPath = (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim();
  const shroudKey = (process.env.SHROUD_PROVIDER_API_KEY || "").trim();
  if (shroudPath && shroudKey) {
    await storeSecret(token, vaultId, shroudPath, shroudKey, "api_key");
    console.log("  Stored Shroud provider key at " + shroudPath + " in vault.");
  }

  if (!existsSync(DOTENV)) {
    console.error("Missing " + DOTENV + " — create .env first.");
    process.exit(1);
  }
  let raw = readFileSync(DOTENV, "utf8");
  raw = upsertEnvLine(raw, "ONECLAW_VAULT_ID", vaultId);
  if (agentInfo) {
    raw = upsertEnvLine(raw, "ONECLAW_AGENT_ID", agentInfo.id);
  }
  writeFileSync(DOTENV, raw, "utf8");

  console.log("\\n  ✓ ONECLAW_VAULT_ID=" + vaultId);
  if (agentInfo) {
    console.log("  ✓ ONECLAW_AGENT_ID=" + agentInfo.id);
    console.log("\\n  New ONECLAW_AGENT_API_KEY (save now — shown once):\\n");
    console.log("    " + agentInfo.apiKey);
    if (existsSync(ENC)) {
      console.log(
        "\\n  Encrypted secrets: add the key with:\\n" +
          "    just enc ONECLAW_AGENT_API_KEY '" +
          agentInfo.apiKey +
          "'\\n",
      );
    } else {
      let r2 = readFileSync(DOTENV, "utf8");
      r2 = upsertEnvLine(r2, "ONECLAW_AGENT_API_KEY", agentInfo.apiKey);
      writeFileSync(DOTENV, r2, "utf8");
      console.log("\\n  Wrote ONECLAW_AGENT_API_KEY to plain .env (no encrypted file).\\n");
    }
  } else {
    console.log(
      "\\n  No agent registered — set ONECLAW_AGENT_ID / API key manually if you use Shroud.\\n",
    );
  }

  console.log(
    "  Old resources remain on 1claw.xyz; you can delete unused vaults/agents in the dashboard.\\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
}

/** Print deployer + agent Ethereum addresses and QR codes (repo-root .env). */
export function getShowAccountsScript(): string {
  return `#!/usr/bin/env node
/**
 * Display QR codes for deployer and agent public addresses.
 * Run: just accounts
 *
 * Reads repo-root .env (same as just fund / generate). Does not require secrets password.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicEnvFile } from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");

function mergePublicDotenv() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "" && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

function pickAddr(...keys) {
  for (const key of keys) {
    const v = (process.env[key] || "").trim();
    if (/^0x[a-fA-F0-9]{40}$/i.test(v)) return v;
  }
  return null;
}

async function main() {
  mergePublicDotenv();
  const deployer = pickAddr("DEPLOYER_ADDRESS");
  const agent = pickAddr(
    "AGENT_ADDRESS",
    "NEXT_PUBLIC_AGENT_ADDRESS",
    "VITE_AGENT_ADDRESS",
  );

  let qrcode;
  try {
    qrcode = (await import("qrcode-terminal")).default;
  } catch {
    qrcode = null;
  }

  console.log("\\n  Monorepo accounts (public addresses)\\n");

  if (deployer) {
    console.log("  Deployer (DEPLOYER_ADDRESS)");
    console.log("  " + deployer + "\\n");
    if (qrcode) {
      qrcode.generate(deployer, { small: true });
      console.log("");
    }
  } else {
    console.log("  Deployer: not set — run just generate\\n");
  }

  if (agent) {
    console.log("  Agent (AGENT_ADDRESS / NEXT_PUBLIC_AGENT_ADDRESS)");
    console.log("  " + agent + "\\n");
    if (qrcode) {
      qrcode.generate(agent, { small: true });
      console.log("");
    }
  } else {
    console.log("  Agent: not set\\n");
  }

  if (!qrcode) {
    console.log(
      "  (Install qrcode-terminal at repo root: npm i -D qrcode-terminal)\\n",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
}

/** Native balance on every chain in network-definitions (repo-root .env; `npx tsx`). */
export function getShowBalancesAllChainsScript(): string {
  return `/**
 * Print native token balances for DEPLOYER_ADDRESS and agent on all networks in network-definitions.
 * Uses rpcOverrides from scaffold.config.ts (same rules as getActiveNetwork).
 * Run from repo root: just balances
 */
import "dotenv/config";
import { createPublicClient, http, formatEther } from "viem";
import type { Chain } from "viem";
import { NETWORKS, type NetworkKey } from "../network-definitions";
import { rpcOverrides } from "../scaffold.config";

function pickAddr(...keys: string[]): string | null {
  for (const key of keys) {
    const v = (process.env[key] || "").trim();
    if (/^0x[a-fA-F0-9]{40}$/i.test(v)) return v;
  }
  return null;
}

function rpcForNetwork(key: NetworkKey): string {
  const net = NETWORKS[key];
  const byChain = rpcOverrides[String(net.chainId)];
  const byKey = rpcOverrides[key];
  const o = (byChain || byKey || "").trim();
  return o || net.rpcUrl;
}

function viemChain(key: NetworkKey, rpcUrl: string): Chain {
  const n = NETWORKS[key];
  return {
    id: n.chainId,
    name: n.name,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

async function readNative(
  client: ReturnType<typeof createPublicClient>,
  addr: string | null,
  symbol: string,
): Promise<string> {
  if (!addr) return "—";
  try {
    const v = await client.getBalance({ address: addr as \`0x\${string}\` });
    return \`\${formatEther(v)} \${symbol}\`;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e))
      .replace(/\\s+/g, " ")
      .trim();
    return \`error (\${msg.slice(0, 48)}\${msg.length > 48 ? "…" : ""})\`;
  }
}

async function main() {
  const deployer = pickAddr("DEPLOYER_ADDRESS");
  const agent = pickAddr(
    "AGENT_ADDRESS",
    "NEXT_PUBLIC_AGENT_ADDRESS",
    "VITE_AGENT_ADDRESS",
  );

  const keys = Object.keys(NETWORKS) as NetworkKey[];

  console.log("\\n  Native balances (all chains in network-definitions)\\n");
  if (!deployer && !agent) {
    console.log(
      "  Set DEPLOYER_ADDRESS and/or AGENT_ADDRESS in repo-root .env (see just accounts).\\n",
    );
  }

  const rows = await Promise.all(
    keys.map(async (key) => {
      const rpcUrl = rpcForNetwork(key);
      const net = NETWORKS[key];
      const chain = viemChain(key, rpcUrl);
      const client = createPublicClient({
        chain,
        transport: http(rpcUrl, { timeout: 15_000 }),
      });
      const sym = net.nativeCurrency.symbol;
      const [d, a] = await Promise.all([
        readNative(client, deployer, sym),
        readNative(client, agent, sym),
      ]);
      return { name: net.name, key, d, a };
    }),
  );

  const wName = Math.max(12, ...rows.map((r) => r.name.length));
  const wKey = Math.max(8, ...rows.map((r) => r.key.length));
  const wBal = Math.max(10, ...rows.map((r) => Math.max(r.d.length, r.a.length)));

  console.log(
    \`  \${"Network".padEnd(wName)}  \${"Key".padEnd(wKey)}  \${"Deployer".padEnd(wBal)}  Agent\`,
  );
  console.log(
    \`  \${"-".repeat(wName)}  \${"-".repeat(wKey)}  \${"-".repeat(wBal)}  \${"-".repeat(wBal)}\`,
  );
  for (const r of rows) {
    console.log(
      \`  \${r.name.padEnd(wName)}  \${r.key.padEnd(wKey)}  \${r.d.padEnd(wBal)}  \${r.a}\`,
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
}

/** On-chain agent registration via Agent0 SDK (runs from repo root with `npx tsx`). */
export function getRegisterAgentScript(projectName: string): string {
  const title = JSON.stringify(`${projectName} agent`);
  const desc = JSON.stringify(
    `Onchain AI agent scaffolded with ${projectName}. ERC-8004 registration via Agent0.`,
  );
  return `/**
 * Register an ERC-8004 agent on-chain using AGENT_PRIVATE_KEY (pays gas).
 * Run: just register-agent
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";
import { getActiveNetwork } from "../network-definitions";

const ROOT = process.cwd();
const PKG = join(ROOT, "package.json");

function readProjectName(): string {
  if (!existsSync(PKG)) return ${JSON.stringify(projectName)};
  try {
    const j = JSON.parse(readFileSync(PKG, "utf8")) as { name?: string };
    return typeof j.name === "string" && j.name ? j.name : ${JSON.stringify(projectName)};
  } catch {
    return ${JSON.stringify(projectName)};
  }
}

async function main() {
  const pk = (process.env.AGENT_PRIVATE_KEY || "").trim();
  const agentAddr = (process.env.AGENT_ADDRESS || "").trim();
  if (!pk) {
    console.error("Missing AGENT_PRIVATE_KEY (set in .env or .env.secrets.encrypted via with-secrets).");
    process.exit(1);
  }
  const net = getActiveNetwork();
  const name = readProjectName();
  const title = ${title};
  const description = ${desc};

  const { SDK } = await import("agent0-sdk");
  const sdk = new SDK({
    chainId: net.chainId,
    rpcUrl: net.rpcUrl,
    privateKey: (pk.startsWith("0x") ? pk : "0x" + pk) as \`0x\${string}\`,
  });

  console.log("Network:", net.name, "chainId:", net.chainId);
  console.log("RPC:", net.rpcUrl);

  const agent = sdk.createAgent(title, description, "");
  if (agentAddr && /^0x[a-fA-F0-9]{40}$/i.test(agentAddr)) {
    agent.setWallet(agentAddr as \`0x\${string}\`);
    console.log("Operational wallet set to AGENT_ADDRESS:", agentAddr);
  }
  agent.setActive(true);

  console.log("Submitting registerOnChain()…");
  const tx = await agent.registerOnChain();
  console.log("Tx submitted:", (tx as { txHash?: string }).txHash ?? tx);
  await tx.waitConfirmed({ timeoutMs: 300_000 });
  console.log("Confirmed.");
  const id = (agent as { agentId?: string }).agentId;
  if (id !== undefined && id !== null) console.log("Agent ID:", id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
}
