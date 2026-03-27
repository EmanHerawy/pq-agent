import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ScaffoldConfig,
  LlmProvider,
  SecretsMode,
  ShroudBillingMode,
  ShroudUpstreamProvider,
} from "../types.js";
import {
  getDeployFoundryScript,
  getDeployHardhatScript,
  getDeployNetworksModuleScript,
  getFundDeployerScript,
  getGenerateDeployerScript,
  getList1clawIdsScript,
  getReset1clawSetupScript,
  getRegisterAgentScript,
  getSecretAddScript,
  getShowAccountsScript,
  getShowBalancesAllChainsScript,
  getSecretsCryptoScript,
  getVerifyFoundryScript,
  getVerifyHardhatScript,
  getWithSecretsScript,
} from "./project-scripts.js";
import { balancesPageSource } from "../scaffold-templates/balances-page.js";
import { ensPageSource } from "../scaffold-templates/ens-page.js";
import { identityPageSource } from "../scaffold-templates/identity-page.js";
import {
  networkDefinitionsSource,
  nextNetworksReexportSource,
  scaffoldConfigSource,
  viteNetworksReexportSource,
} from "../scaffold-templates/network-config.js";
import { nextAppRouteLoadingSource } from "../scaffold-templates/next-loading-page.js";
import { viemChainHelperSource } from "../scaffold-templates/viem-chain.js";
import { vitePageLoadingSource } from "../scaffold-templates/vite-page-loading.js";
import {
  burnerAutoConnectSource,
  connectWalletButtonSource,
  nextAppProvidersSource,
  wagmiConfigSource,
  web3ProvidersSource,
} from "../scaffold-templates/wallet-context.js";

/** Ampersend SDK version pinned for generated Next/Vite apps (see npm). */
const AMPERSEND_SDK_VERSION = "^0.0.2";

/**
 * Default Gemini model for direct Google AI Studio calls (BYOK / `useChat` Gemini-only apps).
 * Override with GOOGLE_GENERATIVE_AI_MODEL.
 */
const GEMINI_GOOGLE_AI_MODEL_DEFAULT = "gemini-2.5-flash";

/**
 * Default Gemini model id sent to Shroud (`/v1/chat/completions`). Must match Shroud + Stripe AI
 * Gateway allowlists — see https://docs.1claw.xyz/docs/guides/shroud (`gemini-2.0-flash` in examples).
 * Using e.g. gemini-2.5-flash here can 404 with Stripe-branded errors under LLM token billing.
 */
const SHROUD_GEMINI_MODEL_DEFAULT = "gemini-2.0-flash";

function ampersendReadmeMarkdown(config: ScaffoldConfig): string {
  const lines = [
    "# Ampersend (x402 / agent payments)",
    "",
    "You chose **Install ampersend SDK** when running `scaffold-agent`.",
    "",
    "[ampersend](https://docs.ampersend.ai/) is a platform for agent payments and operations (Edge & Node), using **x402**, **A2A**, and **MCP**.",
    "",
    "## Links",
    "",
    "- **Documentation:** https://docs.ampersend.ai/",
    "- **npm (`@ampersend_ai/ampersend-sdk`):** https://www.npmjs.com/package/@ampersend_ai/ampersend-sdk",
    "- **GitHub (TypeScript + Python):** https://github.com/edgeandnode/ampersend-sdk",
    "",
    "## In this monorepo",
    "",
  ];
  if (config.framework === "nextjs" || config.framework === "vite") {
    const pkgDir = config.framework === "nextjs" ? "nextjs" : "vite";
    lines.push(
      `The \`@ampersend_ai/ampersend-sdk\` dependency (${AMPERSEND_SDK_VERSION}) is in \`packages/${pkgDir}/package.json\`. Import it in API routes or server code per the [SDK docs](https://docs.ampersend.ai/).`,
    );
  } else {
    lines.push(
      "For **Python**, follow the [Python SDK](https://github.com/edgeandnode/ampersend-sdk/tree/main/python) in the Ampersend repo.",
    );
  }
  lines.push("");
  return lines.join("\n");
}

function dir(base: string, ...segments: string[]) {
  const p = join(base, ...segments);
  mkdirSync(p, { recursive: true });
  return p;
}

function file(base: string, name: string, content: string) {
  writeFileSync(join(base, name), content);
}

function gitkeep(dirPath: string) {
  writeFileSync(join(dirPath, ".gitkeep"), "");
}

// ── LLM provider helpers ────────────────────────────────────────────────────

function llmSdkPackage(llm: LlmProvider): string {
  switch (llm) {
    case "oneclaw":
    case "openai":
      return "@ai-sdk/openai";
    case "gemini":
      return "@ai-sdk/google";
    case "anthropic":
      return "@ai-sdk/anthropic";
  }
}

function llmEnvKey(llm: LlmProvider): string | null {
  switch (llm) {
    case "oneclaw":
      return null;
    case "openai":
      return "OPENAI_API_KEY";
    case "gemini":
      return "GOOGLE_GENERATIVE_AI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
  }
}

type ThirdPartyLlm = Exclude<LlmProvider, "oneclaw">;

// Direct-env helpers (used when secrets are NOT managed by 1Claw; excludes 1Claw LLM — handled separately)
function llmModelImport(llm: ThirdPartyLlm): string {
  switch (llm) {
    case "openai":
      return 'import { openai } from "@ai-sdk/openai";';
    case "gemini":
      return 'import { google } from "@ai-sdk/google";';
    case "anthropic":
      return 'import { anthropic } from "@ai-sdk/anthropic";';
  }
}

function llmModelCall(llm: ThirdPartyLlm): string {
  switch (llm) {
    case "openai":
      return 'openai("gpt-4o")';
    case "gemini":
      return `google("${GEMINI_GOOGLE_AI_MODEL_DEFAULT}")`;
    case "anthropic":
      return 'anthropic("claude-sonnet-4-20250514")';
  }
}

// Vault-backed helpers (Gemini / OpenAI / Anthropic keys in 1Claw vault as llm-api-key)
function llmFactoryImport(llm: ThirdPartyLlm): string {
  switch (llm) {
    case "openai":
      return 'import { createOpenAI } from "@ai-sdk/openai";';
    case "gemini":
      return 'import { createGoogleGenerativeAI } from "@ai-sdk/google";';
    case "anthropic":
      return 'import { createAnthropic } from "@ai-sdk/anthropic";';
  }
}

function llmFactoryCall(llm: ThirdPartyLlm): string {
  switch (llm) {
    case "openai":
      return "createOpenAI({ apiKey: key })";
    case "gemini":
      return "createGoogleGenerativeAI({ apiKey: key })";
    case "anthropic":
      return "createAnthropic({ apiKey: key })";
  }
}

function llmDefaultModel(llm: ThirdPartyLlm): string {
  switch (llm) {
    case "openai":
      return '"gpt-4o"';
    case "gemini":
      return `"${GEMINI_GOOGLE_AI_MODEL_DEFAULT}"`;
    case "anthropic":
      return '"claude-sonnet-4-20250514"';
  }
}

function useVaultForSecrets(secretsMode: SecretsMode): boolean {
  return secretsMode === "oneclaw";
}

function shroudDefaultModel(upstream: ShroudUpstreamProvider): string {
  switch (upstream) {
    case "openai":
      return "gpt-4o";
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "google":
    case "gemini":
      return SHROUD_GEMINI_MODEL_DEFAULT;
    case "mistral":
      return "mistral-large-latest";
    case "cohere":
      return "command-r-plus";
    case "openrouter":
      return "openai/gpt-4o";
  }
}

// ── Root files ──────────────────────────────────────────────────────────────

function writeRootFiles(root: string, config: ScaffoldConfig) {
  const rootDevDeps: Record<string, string> = {
    viem: "^2.21.0",
    "qrcode-terminal": "^0.12.0",
  };
  if (config.framework === "nextjs" || config.framework === "vite") {
    rootDevDeps["agent0-sdk"] = "^1.7.1";
    rootDevDeps["tsx"] = "^4.19.0";
    rootDevDeps["dotenv"] = "^16.4.0";
    if (config.installAmpersendSdk) {
      rootDevDeps["@ampersend_ai/ampersend-sdk"] = AMPERSEND_SDK_VERSION;
    }
  }

  const pkg = {
    name: config.projectName,
    version: "0.1.0",
    private: true,
    type: "module",
    workspaces: ["packages/*"],
    scripts: {} as Record<string, string>,
    devDependencies: rootDevDeps,
  };

  file(root, "package.json", JSON.stringify(pkg, null, 2) + "\n");

  if (config.framework === "nextjs" || config.framework === "vite") {
    file(root, "scaffold.config.ts", scaffoldConfigSource(config.chain));
    file(root, "network-definitions.ts", networkDefinitionsSource());
    file(root, "viem-chain.ts", viemChainHelperSource());
  }

  const gitignoreLines = [
    "node_modules/",
    "dist/",
    "out/",
    "cache/",
    ".env",
    ".env.secrets.encrypted",
    ".env.local",
    ".claude/settings.local.json",
    "private-keys/",
    ".DS_Store",
    "*.log",
    "__pycache__/",
    "*.pyc",
    ".venv/",
    "broadcast/",
    "artifacts/",
    "typechain-types/",
    "deployments/localhost/",
    ".next/",
  ];
  if (config.chain === "foundry") {
    // Installed on first `just compile` / `just deploy` via `forge install --no-git`
    gitignoreLines.push("packages/foundry/lib/");
  }
  file(root, ".gitignore", gitignoreLines.join("\n") + "\n");

  const cursorIgnoreLines = [
    "# Cursor / AI: do not load these paths into LLM context (secrets & keys)",
    ".env",
    ".env.*",
    "!.env.example",
    "!.env.sample",
    ".env.local",
    ".env.secrets.encrypted",
    ".env.secrets",
    "private-keys/",
    "**/*.pem",
    "**/*.p12",
    "**/id_rsa",
    "**/id_rsa.*",
    "**/*.key",
  ];
  file(root, ".cursorignore", cursorIgnoreLines.join("\n") + "\n");

  dir(root, ".claude");
  file(
    join(root, ".claude"),
    "settings.json",
    `${JSON.stringify(
      {
        permissions: {
          deny: [
            "Read(./.env)",
            "Read(./.env.local)",
            "Read(./.env.development)",
            "Read(./.env.development.local)",
            "Read(./.env.production)",
            "Read(./.env.production.local)",
            "Read(./.env.test)",
            "Read(./.env.staging)",
            "Read(./.env.secrets)",
            "Read(./.env.secrets.encrypted)",
            "Read(./private-keys/**)",
            "Read(./**/*.pem)",
            "Read(./**/*.p12)",
            "Read(./**/id_rsa)",
            "Read(./**/id_rsa.*)",
            "Read(./**/*.key)",
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  if (config.installAmpersendSdk) {
    file(root, "AMPERSEND.md", ampersendReadmeMarkdown(config));
  }

  const readme = `# ${config.projectName}

Onchain AI agent monorepo — scaffolded with \`scaffold-agent\`.

## Prerequisites

- [Node.js](https://nodejs.org) >= 18
- [just](https://just.systems/man/en/) command runner
${config.chain === "foundry" ? "- [Foundry](https://book.getfoundry.sh/getting-started/installation)\n- First `just compile` or `just deploy` runs `forge install` for **forge-std** into `packages/foundry/lib/` (gitignored).\n" : ""}${config.chain === "hardhat" ? "- [Hardhat](https://hardhat.org)\n" : ""}
## Quick Start

\`scaffold-agent\` runs **\`npm install\`** in the repo root when you create the project (unless **\`SCAFFOLD_SKIP_NPM_INSTALL=1\`**). Then:

\`\`\`bash
${config.chain !== "none" ? "just chain        # start local blockchain (in a separate terminal)\njust fund         # 100 ETH each: local account #0 → DEPLOYER (+ AGENT if set)\njust deploy       # deploy contracts + generate ABI types (add e.g. \\`base\\` or \\`--network sepolia\\` for public chains)\njust verify       # verify AgentWallet on an explorer (default sepolia; e.g. \\`just verify base\\`)\n" : ""}just start        # start the app
\`\`\`

If install was skipped or failed: \`npm install\` from the repo root.
${config.chain !== "none" ? "\n**Local deploy:** **\`just generate\`** tries to auto-fund when the RPC answers. The **scaffold CLI** runs funding **immediately** after creating the project — that only works if **\`just chain\`** (or another node) is **already** on \`http://127.0.0.1:8545\` (or \`RPC_URL\`). Otherwise run **\`just fund\`** after starting the chain, then **\`just deploy\`**. Set **\`SCAFFOLD_SKIP_AUTO_FUND=1\`** to skip. You will be prompted for your secrets password if you use 1Claw / encrypted mode.\n" : ""}${config.chain === "foundry" ? "\n**Foundry:** \`just deploy\` uses **\`DEPLOYER_PRIVATE_KEY\`**. Public chains: \`just deploy base\`, \`just deploy --network sepolia\`, or \`DEPLOY_NETWORK=base just deploy\`. Set **\`RPC_URL\`** to override default RPCs. **\`just verify\`** submits **\`AgentWallet\`** to the explorer (defaults to sepolia; set **\`ETHERSCAN_API_KEY\`**, **\`BASESCAN_API_KEY\`**, etc.).\n" : ""}${config.chain === "hardhat" ? "\n**Hardhat:** Same deploy/verify patterns as Foundry; networks are defined in \`packages/hardhat/hardhat.config.ts\`.\n" : ""}${config.framework === "nextjs" ? "\n**Next.js:** Chat at \`/\`. **RainbowKit + wagmi + viem**. **Burner Wallet** ([burner-connector](https://github.com/scaffold-eth/burner-connector)) — local-dev pattern from **[Scaffold-ETH 2](https://scaffoldeth.io)** ([repo](https://github.com/scaffold-eth/scaffold-eth-2)) and the **[BuidlGuidl](https://BuidlGuidl.com)** ecosystem. When **\`targetNetwork\`** in **\`scaffold.config.ts\`** is **\`localhost\`**, the connect modal includes Burner (listed first) and the app auto-connects it for local dev; for any other **\`targetNetwork\`** it is omitted. **Reown / WalletConnect:** **\`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID\`** in repo-root **\`.env\`** ([WalletConnect Cloud](https://cloud.walletconnect.com)); **\`just reown <id>\`**. **\`/balances\`**, **\`/identity\`**, **\`/debug\`**. **\`next.config.js\`** loads repo-root **\`.env\`**.\n" : ""}${config.framework === "vite" ? "\n**Vite:** Same **RainbowKit + wagmi + viem** stack; set **\`VITE_WALLETCONNECT_PROJECT_ID\`**. **\`scaffold.config.ts\`** sets the active network. **\`packages/vite/server.ts\`** serves **\`POST /api/agent0/lookup\`** and **\`POST /api/balances\`**.\n" : ""}

## Commands

| Command | Description |
|---|---|
${config.chain !== "none" ? "| \`just chain\` | Start local blockchain |\n| \`just fund\` | Fund \`DEPLOYER_ADDRESS\` + optional \`AGENT_ADDRESS\` (100 ETH each from account #0) |\n| \`just deploy\` | Deploy contracts & auto-generate ABI types (optional: \`just deploy base\`, \`just deploy --network sepolia\`) |\n| \`just verify\` | Verify \`AgentWallet\` on an explorer (default network: sepolia; e.g. \`just verify base\`) |\n" : ""}${config.secrets.mode === "oneclaw" || config.llm === "oneclaw" ? "| \`just list-1claw\` | Print vault IDs + agent UUIDs from API (\`ONECLAW_API_KEY\`) |\n| \`just sync-1claw-env\` | List + write first vault + agent UUID into repo-root \`.env\` |\n| \`just reset\` | **Re-bootstrap 1Claw** — new vault + secrets + agent (see warning; use \`just reset -- --yes\` to skip confirm) |\n" : ""}| \`just env KEY VALUE\` | Upsert repo-root \`.env\` (e.g. **Reown** \`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID\`${config.framework === "vite" ? " or \`VITE_WALLETCONNECT_PROJECT_ID\`" : ""}) |\n| \`just enc KEY VALUE\` | Add/update a key in \`.env.secrets.encrypted\` (password prompt) |\n${config.secrets.mode === "oneclaw" || config.llm === "oneclaw" ? "| \`just vault PATH VALUE\` | Store a secret in your **1Claw vault** |\n" : ""}${config.framework === "nextjs" || config.framework === "vite" ? "| \`just reown PROJECT_ID\` | WalletConnect Cloud id → \`.env\` |\n" : ""}${config.framework === "nextjs" || config.framework === "vite" ? "| \`just register-agent\` | Register ERC-8004 agent on-chain (\`AGENT_PRIVATE_KEY\`; uses \`scaffold.config\` network) |\n" : ""}${config.framework === "nextjs" || config.framework === "vite" ? "| \`just balances\` | Native balance on **all** networks in \`network-definitions\` (\`DEPLOYER_ADDRESS\` + agent; \`rpcOverrides\` from \`scaffold.config\`) |\n" : ""}| \`just start\` | Start the frontend / agent (may prompt for secrets password) |
| \`just accounts\` | QR codes for \`DEPLOYER_ADDRESS\` + agent (\`AGENT_ADDRESS\` / \`NEXT_PUBLIC_AGENT_ADDRESS\`; repo-root \`.env\`) |
| \`just generate\` | Generate a deployer wallet (password prompt if \`.env.secrets.encrypted\` exists) |
${config.installAmpersendSdk ? "\n## Ampersend (x402 payments)\n\nSee **[\\`AMPERSEND.md\\`](./AMPERSEND.md)** — [docs](https://docs.ampersend.ai/), [npm](https://www.npmjs.com/package/@ampersend_ai/ampersend-sdk), [GitHub](https://github.com/edgeandnode/ampersend-sdk).\n" : ""}
## Secrets

**\`.cursorignore\`** (Cursor) keeps \`.env\`, encrypted secrets, \`private-keys/\`, and common key files out of LLM context. **\`.claude/settings.json\`** sets **Claude Code** \`permissions.deny\` \`Read(...)\` rules for the same paths (Claude Code does not read \`.cursorignore\`). \`.claude/settings.local.json\` is gitignored for machine-specific overrides. Adjust either file if you add other secret locations.

${
  config.secrets.mode === "oneclaw"
    ? `This project uses [1Claw](https://1claw.xyz) for secrets management.
The vault holds deployer and agent keys for app runtime. **Private keys and API keys** are stored in **\`.env.secrets.encrypted\`** (AES-256-GCM). Plain \`.env\` only has non-sensitive values (addresses, vault id, model names). **\`just deploy\`**, **\`just start\`**, etc. prompt for your password and load secrets into the process environment (nothing sensitive written to disk). CI: set **\`SCAFFOLD_ENV_PASSWORD\`**.

**Programmatic IDs:** With your user **\`ONECLAW_API_KEY\`**, run **\`just list-1claw\`** (or \`node scripts/list-1claw-ids.mjs\`) to call \`GET /v1/vaults\` and \`GET /v1/agents\` — you get **vault UUIDs** and **agent UUIDs** for \`ONECLAW_VAULT_ID\` / \`ONECLAW_AGENT_ID\`. Agent **API keys** are not listable; they are only returned when you **create** an agent (\`POST /v1/agents\`, as in scaffold setup) or **rotate** (\`@1claw/sdk\` \`client.agents.rotateKey(id)\`).

**Hit org limits or deferred vault during \`npx scaffold-agent\`?** After \`npm install\`, run **\`just reset\`** (read the warning first). It creates a **new** vault and agent, copies deployer (and optional agent) keys into it, and updates \`.env\`. Back up \`.env\` / \`.env.secrets.encrypted\` first. See the command table above.`
    : config.secrets.mode === "encrypted"
      ? "Secrets live in **\\`.env.secrets.encrypted\\`** (AES-256-GCM). **\\`.env\\`** holds only non-sensitive values. Use **\\`just deploy\\`**, **\\`just start\\`**, etc. — they prompt for your password (or set **\\`SCAFFOLD_ENV_PASSWORD\\`** in CI)."
      : "Secrets are stored in a plain \\`.env\\` file. **Do not commit it.**"
}
${config.llm === "oneclaw" ? `

## Shroud (1Claw LLM chat)

**ONECLAW_AGENT_ID** must be the **1Claw agent UUID** (from the dashboard or \`just list-1claw\`). It is **not** **AGENT_ADDRESS** (your \`0x…\` on-chain wallet). Using an Ethereum address there causes Shroud to return \`Invalid agent_id format\`. The scaffold CLI prints this reminder when you create the project; your \`.env\` also includes a short comment block.
` : ""}
`;
  file(root, "README.md", readme);
}

// ── justfile ────────────────────────────────────────────────────────────────

function writeJustfile(root: string, config: ScaffoldConfig) {
  const lines: string[] = [
    "set dotenv-load",
    "",
    "# List available commands",
    "default:",
    "    @just --list",
    "",
  ];

  if (config.chain === "foundry") {
    lines.push(
      "# Start local Foundry chain",
      "chain:",
      "    cd packages/foundry && anvil",
      "",
      "# Fund DEPLOYER + optional AGENT (100 ETH each from Anvil default account #0; chain must be running)",
      "fund:",
      "    node scripts/fund-deployer.mjs",
      "",
      "# Compile contracts",
      "compile:",
      "    #!/usr/bin/env bash",
      "    set -euo pipefail",
      "    cd packages/foundry",
      "    if [ ! -f lib/forge-std/src/Script.sol ]; then",
      '      echo "Installing forge-std (first run)..."',
      "      forge install foundry-rs/forge-std --no-git",
      "    fi",
      "    forge build",
      "",
      "# Deploy contracts and generate ABI types (prompts for secrets password if .env.secrets.encrypted exists)",
      "# Examples: just deploy   just deploy base   just deploy --network sepolia",
      "deploy *ARGS:",
      "    node scripts/with-secrets.mjs -- node scripts/deploy-foundry.mjs {{ARGS}}",
      "",
      "# Verify AgentWallet on a block explorer (set ETHERSCAN_API_KEY / BASESCAN_API_KEY / …)",
      "# Examples: just verify base   just verify --network sepolia   VERIFY_NETWORK=base just verify",
      "verify *ARGS:",
      "    node scripts/with-secrets.mjs -- node scripts/verify-foundry.mjs {{ARGS}}",
      "",
      "# Run contract tests",
      "test:",
      "    #!/usr/bin/env bash",
      "    set -euo pipefail",
      "    cd packages/foundry",
      "    if [ ! -f lib/forge-std/src/Script.sol ]; then",
      '      echo "Installing forge-std (first run)..."',
      "      forge install foundry-rs/forge-std --no-git",
      "    fi",
      "    forge test",
      "",
    );
  } else if (config.chain === "hardhat") {
    lines.push(
      "# Start local Hardhat chain",
      "chain:",
      "    cd packages/hardhat && npx hardhat node",
      "",
      "# Fund DEPLOYER + optional AGENT (100 ETH each from Hardhat default account #0; chain must be running)",
      "fund:",
      "    node scripts/fund-deployer.mjs",
      "",
      "# Compile contracts",
      "compile:",
      "    cd packages/hardhat && npx hardhat compile",
      "",
      "# Deploy contracts and generate ABI types (prompts for secrets password if .env.secrets.encrypted exists)",
      "# Examples: just deploy   just deploy base   just deploy --network sepolia",
      "deploy *ARGS:",
      "    node scripts/with-secrets.mjs -- node scripts/deploy-hardhat.mjs {{ARGS}}",
      "",
      "# Verify AgentWallet (set ETHERSCAN_API_KEY / BASESCAN_API_KEY / … in .env)",
      "verify *ARGS:",
      "    node scripts/with-secrets.mjs -- node scripts/verify-hardhat.mjs {{ARGS}}",
      "",
      "# Run contract tests",
      "test:",
      "    cd packages/hardhat && npx hardhat test",
      "",
    );
  }

  if (config.framework === "nextjs") {
    lines.push(
      "# Start NextJS frontend (prompts for secrets password if .env.secrets.encrypted exists)",
      "start:",
      "    node scripts/with-secrets.mjs -- sh -c 'cd packages/nextjs && npm run dev'",
      "",
    );
  } else if (config.framework === "vite") {
    lines.push(
      "# Start Vite frontend + API server (prompts for secrets password if .env.secrets.encrypted exists)",
      "start:",
      "    node scripts/with-secrets.mjs -- sh -c 'cd packages/vite && npm run dev'",
      "",
    );
  } else if (config.framework === "python") {
    lines.push(
      "# Start Python agent (prompts for secrets password if .env.secrets.encrypted exists)",
      "start:",
      "    node scripts/with-secrets.mjs -- sh -c 'cd packages/python && python -m agent'",
      "",
    );
  }

  if (config.secrets.mode === "oneclaw" || config.llm === "oneclaw") {
    lines.push(
      "# List 1Claw vault + agent UUIDs (needs ONECLAW_API_KEY; use with encrypted secrets)",
      "list-1claw:",
      "    node scripts/with-secrets.mjs -- node scripts/list-1claw-ids.mjs",
      "",
      "# List + write first vault + first agent UUID into repo-root .env (ONECLAW_VAULT_ID / ONECLAW_AGENT_ID)",
      "sync-1claw-env:",
      "    node scripts/with-secrets.mjs -- node scripts/list-1claw-ids.mjs --write-env",
      "",
      "# Re-bootstrap 1Claw (new vault + agent) — WARNING: backup secrets; see script banner",
      "reset *ARGS:",
      "    node scripts/with-secrets.mjs -- node scripts/reset-1claw-setup.mjs {{ARGS}}",
      "",
    );
  }

  lines.push(
    "# Plain repo-root .env (NEXT_PUBLIC_* for WalletConnect / Reown client bundle)",
    "#   just env MY_KEY my_value   — or: SECRET_VALUE=x just env MY_KEY",
    "env key value:",
    "    node scripts/secret-add.mjs env {{key}} {{value}}",
    "",
    "# Encrypted .env.secrets.encrypted (password prompt; creates file if missing)",
    "enc key value:",
    "    node scripts/secret-add.mjs encrypted {{key}} {{value}}",
    "",
  );

  if (config.secrets.mode === "oneclaw" || config.llm === "oneclaw") {
    lines.push(
      "# 1Claw vault secret (ONECLAW_VAULT_ID + ONECLAW_API_KEY; recipe runs with-secrets)",
      "vault path value:",
      "    node scripts/with-secrets.mjs -- node scripts/secret-add.mjs vault {{path}} {{value}}",
      "",
    );
  }

  if (config.framework === "nextjs") {
    lines.push(
      "# Reown / WalletConnect Cloud project id → .env",
      "reown project_id:",
      "    node scripts/secret-add.mjs env NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID {{project_id}}",
      "",
    );
  } else if (config.framework === "vite") {
    lines.push(
      "# Reown / WalletConnect Cloud project id → .env",
      "reown project_id:",
      "    node scripts/secret-add.mjs env VITE_WALLETCONNECT_PROJECT_ID {{project_id}}",
      "",
    );
  }

  if (config.framework === "nextjs" || config.framework === "vite") {
    lines.push(
      "# Register ERC-8004 agent on-chain (AGENT_PRIVATE_KEY pays gas; network from scaffold.config)",
      "register-agent:",
      "    node scripts/with-secrets.mjs -- npx tsx scripts/register-agent.ts",
      "",
    );
  }

  lines.push(
    "# Show deployer + agent address QR codes (reads repo-root .env)",
    "accounts:",
    "    node scripts/show-accounts.mjs",
    "",
    "# Generate a deployer wallet (if not already set)",
    "generate:",
    "    node scripts/generate-deployer.mjs",
    "",
  );

  file(root, "justfile", lines.join("\n"));
}

// ── Scripts ─────────────────────────────────────────────────────────────────

function writeScripts(root: string, config: ScaffoldConfig) {
  const scripts = dir(root, "scripts");

  file(scripts, "secrets-crypto.mjs", getSecretsCryptoScript());
  file(scripts, "with-secrets.mjs", getWithSecretsScript());
  file(scripts, "secret-add.mjs", getSecretAddScript());
  if (config.chain === "foundry" || config.chain === "hardhat") {
    file(scripts, "deploy-networks.mjs", getDeployNetworksModuleScript());
  }
  if (config.secrets.mode === "oneclaw" || config.llm === "oneclaw") {
    file(scripts, "list-1claw-ids.mjs", getList1clawIdsScript());
    file(scripts, "reset-1claw-setup.mjs", getReset1clawSetupScript());
  }
  if (config.chain === "foundry") {
    file(scripts, "deploy-foundry.mjs", getDeployFoundryScript());
    file(scripts, "verify-foundry.mjs", getVerifyFoundryScript());
  }
  if (config.chain === "hardhat") {
    file(scripts, "deploy-hardhat.mjs", getDeployHardhatScript());
    file(scripts, "verify-hardhat.mjs", getVerifyHardhatScript());
  }
  if (config.framework === "nextjs" || config.framework === "vite") {
    file(
      scripts,
      "register-agent.ts",
      getRegisterAgentScript(config.projectName),
    );
    file(scripts, "show-balances-all-chains.ts", getShowBalancesAllChainsScript());
  }

  // ── generate-abi-types.mjs ──────────────────────────────────────────────
  const abiScript = `#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = process.cwd();

function findFoundryContracts() {
  const outDir = join(ROOT, "packages/foundry/out");
  const broadcastDir = join(ROOT, "packages/foundry/broadcast");
  if (!existsSync(outDir)) return null;

  const deployments = {};
  if (existsSync(broadcastDir)) {
    for (const scriptDir of readdirSync(broadcastDir)) {
      const scriptPath = join(broadcastDir, scriptDir);
      let entries;
      try { entries = readdirSync(scriptPath); } catch { continue; }
      for (const chainDir of entries) {
        const runFile = join(scriptPath, chainDir, "run-latest.json");
        if (!existsSync(runFile)) continue;
        try {
          const data = JSON.parse(readFileSync(runFile, "utf8"));
          const chainId = parseInt(chainDir);
          if (isNaN(chainId)) continue;
          for (const tx of data.transactions || []) {
            if (tx.transactionType === "CREATE" && tx.contractName && tx.contractAddress) {
              if (!deployments[chainId]) deployments[chainId] = {};
              deployments[chainId][tx.contractName] = tx.contractAddress;
            }
          }
        } catch { /* skip malformed */ }
      }
    }
  }

  const abis = {};
  for (const solDir of readdirSync(outDir)) {
    if (!solDir.endsWith(".sol")) continue;
    const contractName = solDir.replace(".sol", "");
    const jsonFile = join(outDir, solDir, contractName + ".json");
    if (!existsSync(jsonFile)) continue;
    try {
      const data = JSON.parse(readFileSync(jsonFile, "utf8"));
      if (data.abi) abis[contractName] = data.abi;
    } catch { /* skip */ }
  }

  return { deployments, abis };
}

function findHardhatContracts() {
  const deploymentsDir = join(ROOT, "packages/hardhat/deployments");
  if (!existsSync(deploymentsDir)) return null;

  const result = { deployments: {}, abis: {} };
  for (const networkDir of readdirSync(deploymentsDir)) {
    const networkPath = join(deploymentsDir, networkDir);
    const chainIdFile = join(networkPath, ".chainId");
    const chainId = existsSync(chainIdFile)
      ? parseInt(readFileSync(chainIdFile, "utf8").trim())
      : 31337;

    for (const f of readdirSync(networkPath)) {
      if (!f.endsWith(".json")) continue;
      const contractName = f.replace(".json", "");
      try {
        const data = JSON.parse(readFileSync(join(networkPath, f), "utf8"));
        if (data.address && data.abi) {
          if (!result.deployments[chainId]) result.deployments[chainId] = {};
          result.deployments[chainId][contractName] = data.address;
          result.abis[contractName] = data.abi;
        }
      } catch { /* skip */ }
    }
  }
  return result;
}

function generateTS(contracts) {
  const { deployments, abis } = contracts;
  const chains = {};
  for (const [chainId, deployed] of Object.entries(deployments)) {
    chains[chainId] = {};
    for (const [name, address] of Object.entries(deployed)) {
      if (abis[name]) {
        chains[chainId][name] = { address, abi: abis[name] };
      }
    }
  }

  if (Object.keys(chains).length === 0) {
    console.log("  No deployed contracts found. Deploy first with: just deploy");
    return null;
  }

  return \`// Auto-generated by scaffold-agent — do not edit manually
// Re-generate with: just deploy

const deployedContracts = \${JSON.stringify(chains, null, 2)} as const;

export default deployedContracts;
\`;
}

const foundry = findFoundryContracts();
const hardhat = findHardhatContracts();
const contracts = foundry || hardhat;

if (!contracts) {
  console.log("  No contract artifacts found. Make sure contracts are compiled.");
  process.exit(0);
}

const ts = generateTS(contracts);
if (!ts) process.exit(0);

const targets = [
  "packages/nextjs/contracts",
  "packages/vite/src/contracts",
];

let written = false;
for (const rel of targets) {
  const target = join(ROOT, rel);
  const parent = dirname(target);
  if (existsSync(parent)) {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "deployedContracts.ts"), ts);
    console.log("  \\u2714 Generated " + rel + "/deployedContracts.ts");
    written = true;
  }
}

if (!written) {
  mkdirSync(join(ROOT, "contracts"), { recursive: true });
  writeFileSync(join(ROOT, "contracts/deployedContracts.ts"), ts);
  console.log("  \\u2714 Generated contracts/deployedContracts.ts");
}
`;

  file(scripts, "generate-abi-types.mjs", abiScript);

  file(scripts, "generate-deployer.mjs", getGenerateDeployerScript());
  file(scripts, "show-accounts.mjs", getShowAccountsScript());

  // ── fund-deployer.mjs (local account #0 → DEPLOYER + optional AGENT) ─
  if (config.chain !== "none") {
    file(scripts, "fund-deployer.mjs", getFundDeployerScript());
  }
}

// ── Foundry ─────────────────────────────────────────────────────────────────

function scaffoldFoundry(root: string) {
  const pkg = dir(root, "packages", "foundry");
  dir(pkg, "src");
  dir(pkg, "test");
  dir(pkg, "script");
  dir(pkg, "lib");

  file(
    pkg,
    "foundry.toml",
    [
      "[profile.default]",
      'src = "src"',
      'out = "out"',
      'libs = ["lib"]',
      'script = "script"',
      "",
      "[rpc_endpoints]",
      'localhost = "http://127.0.0.1:8545"',
      "",
    ].join("\n"),
  );

  file(
    pkg,
    "src/AgentWallet.sol",
    `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AgentWallet {
    address public owner;
    address public agent;

    event Executed(address indexed target, uint256 value, bytes data);

    modifier onlyAuthorized() {
        _onlyAuthorized();
        _;
    }

    function _onlyAuthorized() internal view {
        require(msg.sender == owner || msg.sender == agent, "unauthorized");
    }

    constructor(address _agent) {
        owner = msg.sender;
        agent = _agent;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyAuthorized returns (bytes memory) {
        (bool ok, bytes memory result) = target.call{value: value}(data);
        require(ok, "call failed");
        emit Executed(target, value, data);
        return result;
    }

    receive() external payable {}
}
`,
  );

  file(
    pkg,
    "script/Deploy.s.sol",
    `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AgentWallet} from "../src/AgentWallet.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agentAddr = vm.envOr("AGENT_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);
        new AgentWallet(agentAddr);
        vm.stopBroadcast();
    }
}
`,
  );

  file(
    pkg,
    "test/AgentWallet.t.sol",
    `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentWallet} from "../src/AgentWallet.sol";

contract AgentWalletTest is Test {
    AgentWallet wallet;
    address agent = address(0xA);

    function setUp() public {
        wallet = new AgentWallet(agent);
    }

    function test_ownerIsDeployer() public view {
        assertEq(wallet.owner(), address(this));
    }

    function test_agentIsSet() public view {
        assertEq(wallet.agent(), agent);
    }

    function test_onlyAuthorizedCanExecute() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert("unauthorized");
        wallet.execute(address(0), 0, "");
    }
}
`,
  );
}

// ── Hardhat ─────────────────────────────────────────────────────────────────

function scaffoldHardhat(root: string) {
  const pkg = dir(root, "packages", "hardhat");
  dir(pkg, "contracts");
  dir(pkg, "deploy");
  dir(pkg, "test");

  file(
    pkg,
    "package.json",
    JSON.stringify(
      {
        name: "hardhat",
        version: "0.1.0",
        private: true,
        scripts: {
          compile: "hardhat compile",
          test: "hardhat test",
          deploy: "hardhat deploy",
        },
        devDependencies: {
          hardhat: "^2.22.0",
          "@nomicfoundation/hardhat-toolbox": "^5.0.0",
          "hardhat-deploy": "^0.12.0",
          "hardhat-deploy-ethers": "^0.4.0",
          dotenv: "^16.4.0",
        },
      },
      null,
      2,
    ) + "\n",
  );

  file(
    pkg,
    "hardhat.config.ts",
    `import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "dotenv/config";

const rpc = (u: string) => (process.env.RPC_URL?.trim() ? process.env.RPC_URL.trim() : u);

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  defaultNetwork: "localhost",
  namedAccounts: {
    deployer: { default: 0 },
  },
  networks: {
    localhost: { url: "http://127.0.0.1:8545" },
    sepolia: { url: rpc("https://rpc.sepolia.org") },
    base: { url: rpc("https://mainnet.base.org") },
    baseSepolia: { url: rpc("https://sepolia.base.org") },
    mainnet: { url: rpc("https://eth.llamarpc.com") },
    polygon: { url: rpc("https://polygon-rpc.com") },
    bnb: { url: rpc("https://bsc-dataseed.binance.org") },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
      baseSepolia:
        process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
      bnb: process.env.BSCSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "bnb",
        chainId: 56,
        urls: {
          apiURL: "https://api.bscscan.com/api",
          browserURL: "https://bscscan.com",
        },
      },
    ],
  },
};

export default config;
`,
  );

  file(
    pkg,
    "contracts/AgentWallet.sol",
    `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AgentWallet {
    address public owner;
    address public agent;

    event Executed(address indexed target, uint256 value, bytes data);

    modifier onlyAuthorized() {
        _onlyAuthorized();
        _;
    }

    function _onlyAuthorized() internal view {
        require(msg.sender == owner || msg.sender == agent, "unauthorized");
    }

    constructor(address _agent) {
        owner = msg.sender;
        agent = _agent;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyAuthorized returns (bytes memory) {
        (bool ok, bytes memory result) = target.call{value: value}(data);
        require(ok, "call failed");
        emit Executed(target, value, data);
        return result;
    }

    receive() external payable {}
}
`,
  );

  file(
    pkg,
    "deploy/00_deploy_agent_wallet.ts",
    `import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployer } = await hre.getNamedAccounts();
  const agentAddress = process.env.AGENT_ADDRESS || deployer;

  await hre.deployments.deploy("AgentWallet", {
    from: deployer,
    args: [agentAddress],
    log: true,
  });
};

func.tags = ["AgentWallet"];
export default func;
`,
  );
}

// ── Shared frontend helpers ─────────────────────────────────────────────────

const SHADCN_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5.9% 10%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
    --card: 240 10% 3.9%;
    --card-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 240 5.9% 10%;
    --secondary: 240 3.7% 15.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
    --accent: 240 3.7% 15.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 240 4.9% 83.9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground antialiased;
  }
  /* Keyboard focus: visible ring without changing mouse click outline behavior */
  :where(a, button, input, textarea, select, summary):focus-visible {
    @apply outline-none ring-2 ring-ring ring-offset-2 ring-offset-background;
  }
}
`;

const TAILWIND_CONFIG = `import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
`;

const POSTCSS_CONFIG = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;

const UTILS_TS = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

const BUTTON_TSX = `import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
`;

const INPUT_TSX = `import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
`;

const COMPONENTS_JSON = JSON.stringify(
  {
    $schema: "https://ui.shadcn.com/schema.json",
    style: "default",
    rsc: false,
    tsx: true,
    tailwind: {
      config: "tailwind.config.ts",
      css: "app/globals.css",
      baseColor: "zinc",
      cssVariables: true,
    },
    aliases: {
      components: "@/components",
      utils: "@/lib/utils",
    },
  },
  null,
  2,
);

/** Express routes: Agent0 lookup + balances (uses repo-root network config). */
function viteAgent0AndBalancesExpressBlock(): string {
  return `
app.post("/api/agent0/lookup", async (req, res) => {
  try {
    const { address, chainId, addresses: rawAddrs } = req.body ?? {};
    const cid = Number(chainId);
    if (!Number.isFinite(cid)) {
      res.status(400).json({ error: "Invalid chainId" });
      return;
    }
    const net = getActiveNetwork();
    if (cid !== net.chainId) {
      res.status(400).json({
        error: "chainId does not match active network in scaffold.config",
      });
      return;
    }
    const single = address;
    const candidates = [];
    if (Array.isArray(rawAddrs)) {
      for (const x of rawAddrs) {
        if (typeof x === "string" && /^0x[a-fA-F0-9]{40}$/i.test(x)) candidates.push(x);
      }
    }
    if (typeof single === "string" && /^0x[a-fA-F0-9]{40}$/i.test(single)) {
      candidates.push(single);
    }
    if (candidates.length === 0) {
      res.status(400).json({
        error: "Provide address or addresses[] (ERC-8004 owner wallets to search)",
      });
      return;
    }
    const seen = new Set();
    const owners = [];
    for (const a of candidates) {
      const k = a.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      owners.push(a);
    }
    const { SDK } = await import("agent0-sdk");
    const sdk = new SDK({
      chainId: net.chainId,
      rpcUrl: net.rpcUrl,
    });
    const agents = await sdk.searchAgents({
      owners,
      chains: [cid],
    });
    res.json({ agents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/agent0/lookup]", msg);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/balances", async (req, res) => {
  try {
    const { address: addr, chainId } = req.body ?? {};
    const cid = Number(chainId);
    if (typeof addr !== "string" || !/^0x[a-fA-F0-9]{40}$/i.test(addr)) {
      res.status(400).json({ error: "Invalid address" });
      return;
    }
    if (!Number.isFinite(cid)) {
      res.status(400).json({ error: "Invalid chainId" });
      return;
    }
    const net = getActiveNetwork();
    if (cid !== net.chainId) {
      res.status(400).json({
        error: "chainId does not match active network in scaffold.config",
      });
      return;
    }
    const chain = viemChainForNetwork(net);
    const client = createPublicClient({
      chain,
      transport: http(net.rpcUrl),
    });
    const wei = await client.getBalance({ address: addr });
    const nativeFormatted = formatUnits(wei, net.nativeCurrency.decimals);
    const contracts = net.tokens.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr],
    }));
    const tokens = [];
    if (contracts.length) {
      const results = await client.multicall({ contracts, allowFailure: true });
      results.forEach((r, i) => {
        const t = net.tokens[i];
        if (r.status === "success") {
          tokens.push({
            symbol: t.symbol,
            balance: formatUnits(r.result, t.decimals),
            decimals: t.decimals,
            address: t.address,
          });
        } else {
          tokens.push({
            symbol: t.symbol,
            balance: "0",
            decimals: t.decimals,
            address: t.address,
          });
        }
      });
    }
    res.json({
      native: {
        symbol: net.nativeCurrency.symbol,
        balance: nativeFormatted,
        decimals: net.nativeCurrency.decimals,
      },
      tokens,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/balances]", msg);
    res.status(500).json({ error: msg });
  }
});
`;
}

function nextApiAgent0LookupRoute(): string {
  return `import { SDK } from "agent0-sdk";
import { getActiveNetwork } from "@/lib/networks";

function normalizeOwnerAddresses(body: unknown): string[] | null {
  const o = body as Record<string, unknown>;
  const arr = o?.addresses;
  const single = o?.address;
  const candidates: string[] = [];
  if (Array.isArray(arr)) {
    for (const x of arr) {
      if (typeof x === "string" && /^0x[a-fA-F0-9]{40}$/i.test(x)) candidates.push(x);
    }
  }
  if (typeof single === "string" && /^0x[a-fA-F0-9]{40}$/i.test(single)) {
    candidates.push(single);
  }
  if (candidates.length === 0) return null;
  const seen = new Set<string>();
  const owners: string[] = [];
  for (const a of candidates) {
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    owners.push(a);
  }
  return owners;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const chainId = body?.chainId;
    const owners = normalizeOwnerAddresses(body);
    if (!owners) {
      return Response.json(
        { error: "Provide address (0x…) or addresses: […] (ERC-8004 owner wallets to search)" },
        { status: 400 },
      );
    }
    const cid = Number(chainId);
    if (!Number.isFinite(cid)) {
      return Response.json({ error: "Invalid chainId" }, { status: 400 });
    }
    const net = getActiveNetwork();
    if (cid !== net.chainId) {
      return Response.json(
        { error: "chainId does not match active network in scaffold.config" },
        { status: 400 },
      );
    }
    const sdk = new SDK({
      chainId: net.chainId,
      rpcUrl: net.rpcUrl,
    });
    const agents = await sdk.searchAgents({
      owners,
      chains: [cid],
    });
    return Response.json({ agents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/agent0/lookup]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
`;
}

function nextApiBalancesRoute(): string {
  return `import {
  createPublicClient,
  http,
  formatUnits,
  erc20Abi,
} from "viem";
import { getActiveNetwork } from "@/lib/networks";
import { viemChainForNetwork } from "@repo/viem-chain";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const addr = body?.address;
    const chainId = Number(body?.chainId);
    if (typeof addr !== "string" || !/^0x[a-fA-F0-9]{40}$/i.test(addr)) {
      return Response.json({ error: "Invalid address" }, { status: 400 });
    }
    if (!Number.isFinite(chainId)) {
      return Response.json({ error: "Invalid chainId" }, { status: 400 });
    }
    const net = getActiveNetwork();
    if (net.chainId !== chainId) {
      return Response.json(
        { error: "chainId does not match active network in scaffold.config" },
        { status: 400 },
      );
    }
    const chain = viemChainForNetwork(net);
    const client = createPublicClient({
      chain,
      transport: http(net.rpcUrl),
    });
    const wei = await client.getBalance({ address: addr as \`0x\${string}\` });
    const nativeFormatted = formatUnits(wei, net.nativeCurrency.decimals);
    const contracts = net.tokens.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [addr as \`0x\${string}\`],
    }));
    const tokens: {
      symbol: string;
      balance: string;
      decimals: number;
      address: string;
    }[] = [];
    if (contracts.length) {
      const results = await client.multicall({ contracts, allowFailure: true });
      results.forEach((r, i) => {
        const t = net.tokens[i];
        if (r.status === "success") {
          tokens.push({
            symbol: t.symbol,
            balance: formatUnits(r.result as bigint, t.decimals),
            decimals: t.decimals,
            address: t.address,
          });
        } else {
          tokens.push({
            symbol: t.symbol,
            balance: "0",
            decimals: t.decimals,
            address: t.address,
          });
        }
      });
    }
    return Response.json({
      native: {
        symbol: net.nativeCurrency.symbol,
        balance: nativeFormatted,
        decimals: net.nativeCurrency.decimals,
      },
      tokens,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/balances]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
`;
}

function nextApiFaucetRoute(): string {
  return `import { createWalletClient, http, parseEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { getActiveNetwork, targetNetwork } from "@/lib/networks";

/** Anvil / Hardhat node default account #0 (public dev key). */
const LOCAL_DEV_ACCT0_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const FAUCET_AMOUNT_ETH = "10";

export async function POST(req: Request) {
  try {
    if (targetNetwork !== "localhost") {
      return Response.json(
        { error: "Faucet is only enabled when targetNetwork is localhost in scaffold.config.ts" },
        { status: 403 },
      );
    }

    const net = getActiveNetwork();
    if (net.chainId !== hardhat.id) {
      return Response.json({ error: "Active network is not local chain 31337" }, { status: 403 });
    }

    const body = await req.json();
    const addr = body?.address;
    const chainId = Number(body?.chainId);

    if (typeof addr !== "string" || !/^0x[a-fA-F0-9]{40}$/i.test(addr)) {
      return Response.json({ error: "Invalid address" }, { status: 400 });
    }
    if (!Number.isFinite(chainId) || chainId !== hardhat.id) {
      return Response.json(
        { error: "chainId must be 31337 (local Hardhat / Anvil)" },
        { status: 400 },
      );
    }

    const chain = defineChain({
      id: net.chainId,
      name: net.name,
      nativeCurrency: net.nativeCurrency,
      rpcUrls: { default: { http: [net.rpcUrl] } },
    });

    const account = privateKeyToAccount(LOCAL_DEV_ACCT0_PK);
    const client = createWalletClient({
      account,
      chain,
      transport: http(net.rpcUrl),
    });

    const hash = await client.sendTransaction({
      to: addr as \`0x\${string}\`,
      value: parseEther(FAUCET_AMOUNT_ETH),
    });

    return Response.json({
      ok: true,
      hash,
      amount: FAUCET_AMOUNT_ETH,
      symbol: net.nativeCurrency.symbol,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/faucet]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
`;
}

function localFaucetButtonSource(): string {
  return `"use client";

import { useEffect, useState } from "react";
import { Droplets, Loader2 } from "lucide-react";
import { useAccount, useChainId } from "wagmi";
import { hardhat } from "wagmi/chains";
import { cn } from "@/lib/utils";
import { targetNetwork } from "@/lib/networks";

/**
 * Localhost-only: send ETH from Anvil account #0 via POST /api/faucet (same dev key as just fund).
 * Wallet state is omitted until mount so SSR + first client paint match (avoids hydration mismatch with wagmi).
 */
export function LocalFaucetButton() {
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.kind === "ok" ? 4500 : 8000;
    const t = window.setTimeout(() => setToast(null), ms);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (targetNetwork !== "localhost") return null;

  if (!mounted) {
    return (
      <div
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/50 animate-pulse"
        aria-hidden
      />
    );
  }

  const wrongChain = isConnected && chainId !== hardhat.id;
  const disabled = !isConnected || !address || wrongChain || busy;

  async function onFaucet() {
    if (!address || disabled) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chainId: hardhat.id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; amount?: string; symbol?: string };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      const amt = data.amount ?? "?";
      const sym = data.symbol ?? "ETH";
      setToast({
        kind: "ok",
        text: "Sent " + amt + " " + sym + " to your wallet (local faucet).",
      });
    } catch (e) {
      setToast({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const title = wrongChain
    ? "Switch your wallet to Localhost (chain 31337)"
    : !isConnected
      ? "Connect a wallet first"
      : "Mint 10 test ETH from local Anvil account #0";

  return (
    <>
      <button
        type="button"
        onClick={() => void onFaucet()}
        disabled={disabled}
        title={title}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
        aria-label="Local faucet"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Droplets className="h-4 w-4" />}
      </button>
      {toast ? (
        <div
          role="status"
          className={cn(
            "fixed bottom-20 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg",
            toast.kind === "ok"
              ? "border-border bg-card text-foreground"
              : "border-destructive/50 bg-destructive/10 text-destructive",
          )}
        >
          {toast.text}
        </div>
      ) : null}
    </>
  );
}
`;
}

function chatPageContent(
  projectName: string,
  options?: {
    debugLink?: boolean;
    identityLink?: boolean;
    linkFramework?: "next" | "react-router";
  },
): string {
  const linkFramework = options?.linkFramework ?? "next";
  const debugLink =
    options?.debugLink !== undefined
      ? options.debugLink
      : linkFramework === "next";
  const identityLink = options?.identityLink !== false;
  const needLink = identityLink || debugLink;
  const linkImports = !needLink
    ? ""
    : linkFramework === "next"
      ? `import Link from "next/link";\n`
      : `import { Link } from "react-router-dom";\n`;
  const cnImport = needLink ? `import { cn } from "@/lib/utils";\n` : "";
  const lucideParts = ["SendHorizontal", "Bot", "User"];
  if (identityLink) lucideParts.push("BadgeCheck", "Info", "Wallet");
  if (debugLink) lucideParts.push("Bug");
  const lucideIcons = `import { ${lucideParts.join(", ")} } from "lucide-react";`;
  const lp = (path: string) =>
    linkFramework === "next" ? `href="${path}"` : `to="${path}"`;
  const iconBtnClass = `cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )`;
  const localFaucetImport = identityLink
    ? `import { LocalFaucetButton } from "@/components/LocalFaucetButton";\n`
    : "";
  const headerFaucet = identityLink
    ? `
        <LocalFaucetButton />`
    : "";
  const headerBalances = identityLink
    ? `
        <Link
          ${lp("/balances")}
          className={${iconBtnClass}}
          title="Balances"
          aria-label="Balances"
        >
          <Wallet className="h-4 w-4" aria-hidden />
        </Link>`
    : "";
  const headerEns = identityLink
    ? `
        <Link
          ${lp("/ens")}
          className={${iconBtnClass}}
          title="ENS name for your agent"
          aria-label="ENS name for your agent"
        >
          <BadgeCheck className="h-4 w-4" aria-hidden />
        </Link>`
    : "";
  const headerIdentity = identityLink
    ? `
        <Link
          ${lp("/identity")}
          className={${iconBtnClass}}
          title="Agent identity (ERC-8004)"
          aria-label="Agent identity (ERC-8004)"
        >
          <Info className="h-4 w-4" aria-hidden />
        </Link>`
    : "";
  const headerBug = debugLink
    ? `
        <Link
          ${lp("/debug")}
          className={${iconBtnClass}}
          title="Debug contracts"
          aria-label="Debug contracts"
        >
          <Bug className="h-4 w-4" aria-hidden />
        </Link>`
    : "";
  const headerIcons = `${headerFaucet}${headerBalances}${headerEns}${headerIdentity}${headerBug}`;
  const headerRight = `
        <div className="flex items-center gap-2 shrink-0">
          ${headerIcons ? `<div className="flex items-center gap-1">${headerIcons}</div>` : ""}
          <ConnectWalletButton />
        </div>`;

  return `"use client";

${linkImports}${localFaucetImport}import { useChat } from "ai/react";
import { useEffect, useRef } from "react";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
${cnImport}${lucideIcons}

export default function Home() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } =
    useChat({
      onError(err) {
        console.error("Chat error:", err);
      },
    });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex flex-col h-screen">
      <header
        className="border-b border-border px-6 py-4 flex items-center gap-3"
        role="banner"
      >
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-primary-foreground" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">${projectName}</h1>
          <p className="text-xs text-muted-foreground">Onchain AI Agent</p>
        </div>${headerRight}
      </header>

      {error &&
        (() => {
          const raw = error.message;
          let display = raw;
          const i = raw.indexOf("{");
          if (i >= 0) {
            try {
              const j = JSON.parse(raw.slice(i)) as { error?: string };
              if (j && typeof j.error === "string") display = j.error;
            } catch {
              /* keep display */
            }
          }
          const t = display.toLowerCase();
          const shroudHttpErr = /^shroud\s+\d{3}/i.test(display.trim());
          const geminiOrQuota =
            /quota|429|resource_exhausted|gemini|google|generativelanguage/.test(t);
          const oneclawish = /oneclaw|shroud|oneclaw_agent|x-shroud/.test(t);
          return (
            <div
              className="px-6 py-3 text-sm text-destructive bg-destructive/10 border-b border-border space-y-2"
              role="alert"
            >
              <p className="whitespace-pre-wrap font-medium">{display}</p>
              {shroudHttpErr &&
              (/unrecognized request url|generatecontent|stripe\.com/.test(t) ||
                /gemini/.test(t)) ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Shroud with <strong className="text-foreground">LLM token billing</strong> routes models
                  through Stripe&apos;s AI gateway; some ids (e.g.{" "}
                  <code className="rounded bg-muted px-1">gemini-2.5-flash</code>) may 404. Try{" "}
                  <code className="rounded bg-muted px-1">SHROUD_DEFAULT_MODEL=gemini-2.0-flash</code>{" "}
                  (see{" "}
                  <a
                    href="https://docs.1claw.xyz/docs/guides/shroud"
                    className="underline hover:text-foreground"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Shroud docs
                  </a>
                  ) and check agent <code className="rounded bg-muted px-1">allowed_models</code> on
                  1claw.xyz.
                </p>
              ) : geminiOrQuota ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  For Google Gemini (direct API / BYOK): check{" "}
                  <a
                    href="https://ai.google.dev/gemini-api/docs/rate-limits"
                    className="underline hover:text-foreground"
                    target="_blank"
                    rel="noreferrer"
                  >
                    rate limits and billing
                  </a>
                  , set <code className="rounded bg-muted px-1">GOOGLE_GENERATIVE_AI_API_KEY</code>, and
                  optionally <code className="rounded bg-muted px-1">GOOGLE_GENERATIVE_AI_MODEL</code>.
                </p>
              ) : oneclawish ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Fix <code className="rounded bg-muted px-1">.env</code> (or encrypted secrets), then restart{" "}
                  <code className="rounded bg-muted px-1">next dev</code>.{" "}
                  <code className="rounded bg-muted px-1">ONECLAW_AGENT_ID</code> is the 1Claw agent UUID — not{" "}
                  <code className="rounded bg-muted px-1">AGENT_ADDRESS</code>.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Check LLM API keys and provider settings in{" "}
                  <code className="rounded bg-muted px-1">.env</code> (or{" "}
                  <code className="rounded bg-muted px-1">.env.secrets.encrypted</code>), then restart{" "}
                  <code className="rounded bg-muted px-1">next dev</code>. Open the Network tab if the chat
                  request returns 4xx/5xx.
                </p>
              )}
            </div>
          );
        })()}

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6"
        aria-label="Chat conversation"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">How can I help you?</p>
              <p className="text-sm text-muted-foreground mt-1">Send a message to start chatting with your agent.</p>
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={\`flex gap-3 \${m.role === "user" ? "justify-end" : "justify-start"}\`}>
            {m.role !== "user" && (
              <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
            <div
              className={\`max-w-[75%] rounded-2xl px-4 py-3 \${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }\`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
            </div>
            {m.role === "user" && (
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
            )}
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-3 justify-start" aria-live="polite" aria-busy="true">
            <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </div>
            <div className="bg-muted rounded-2xl px-4 py-3">
              <div className="flex space-x-1.5" aria-label="Assistant is typing">
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </main>

      <form
        onSubmit={handleSubmit}
        className="border-t border-border p-4 flex gap-3"
        aria-label="Send a message to the agent"
      >
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="Send a message…"
          className="flex-1"
          disabled={isLoading}
          autoFocus
          name="message"
          aria-label="Message text"
        />
        <Button
          type="submit"
          size="icon"
          disabled={isLoading || !input.trim()}
          aria-label="Send message"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
`;
}

/** Next.js /debug — contract addresses + ABI summary (Scaffold-ETH 2–style). */
function debugPageContent(): string {
  return `"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Bug, Copy, Check, Fingerprint } from "lucide-react";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import deployedContracts from "@/contracts/deployedContracts";

type AbiItem = {
  type?: string;
  name?: string;
  stateMutability?: string;
  inputs?: { name?: string; type: string }[];
};

function formatInputs(inputs: { name?: string; type: string }[] | undefined) {
  if (!inputs?.length) return "()";
  return (
    "(" +
    inputs.map((i) => (i.name ? i.name + ": " : "") + i.type).join(", ") +
    ")"
  );
}

function AbiSummary({ abi }: { abi: readonly unknown[] }) {
  const items = abi as AbiItem[];
  const functions = items.filter((x) => x.type === "function");
  const events = items.filter((x) => x.type === "event");
  return (
    <div className="space-y-4 text-sm">
      {functions.length > 0 && (
        <div>
          <h4 className="font-medium text-foreground mb-2">Functions</h4>
          <ul className="font-mono text-xs text-muted-foreground space-y-1">
            {functions.map((f, i) => (
              <li key={i}>
                <span className="text-foreground">{f.name}</span>
                {formatInputs(f.inputs)}
                {f.stateMutability ? (
                  <span className="text-muted-foreground/70">
                    {" "}
                    — {f.stateMutability}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {events.length > 0 && (
        <div>
          <h4 className="font-medium text-foreground mb-2">Events</h4>
          <ul className="font-mono text-xs text-muted-foreground space-y-1">
            {events.map((e, i) => (
              <li key={i}>
                <span className="text-foreground">{e.name}</span>
                {formatInputs(e.inputs)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
      title="Copy address"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      {ok ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export default function DebugPage() {
  const data = deployedContracts as Record<
    string,
    Record<string, { address: string; abi: readonly unknown[] }>
  >;
  const entries = Object.entries(data).filter(
    ([, contracts]) => Object.keys(contracts).length > 0,
  );

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border px-6 py-4 flex items-center gap-4">
        <Link
          href="/"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
          title="Back to chat"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
          <Bug className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">Debug contracts</h1>
          <p className="text-xs text-muted-foreground">
            Deployed addresses &amp; ABI from{" "}
            <code className="text-xs bg-muted px-1 rounded">deployedContracts.ts</code>
          </p>
        </div>
        <Link
          href="/identity"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
          title="Agent identity (ERC-8004)"
        >
          <Fingerprint className="h-4 w-4" />
        </Link>
        <ConnectWalletButton />
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-8">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground space-y-2">
            <p>No deployed contracts in <code className="bg-muted px-1 rounded">deployedContracts.ts</code> yet.</p>
            <p>Run: <code className="bg-muted px-1 rounded">just chain</code> → <code className="bg-muted px-1 rounded">just fund</code> → <code className="bg-muted px-1 rounded">just deploy</code></p>
          </div>
        ) : (
          entries.map(([chainId, contracts]) => (
            <section key={chainId} className="space-y-4">
              <h2 className="text-lg font-semibold">Chain {chainId}</h2>
              {Object.entries(contracts).map(([name, meta]) => (
                <article
                  key={name}
                  className="rounded-lg border border-border bg-card p-5 space-y-3"
                >
                  <h3 className="font-mono text-base font-medium">{name}</h3>
                  <div className="flex items-center gap-2 font-mono text-xs break-all bg-muted/50 rounded-md px-3 py-2">
                    <span className="text-muted-foreground shrink-0">address</span>
                    <span className="flex-1">{meta.address}</span>
                    <CopyBtn text={meta.address} />
                  </div>
                  <AbiSummary abi={meta.abi} />
                </article>
              ))}
            </section>
          ))
        )}
        <p className="text-xs text-muted-foreground border-t border-border pt-6">
          UI pattern inspired by{" "}
          <a
            href="https://github.com/scaffold-eth/scaffold-eth-2"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Scaffold-ETH 2
          </a>
          . This page is read-only; use RainbowKit/wagmi hooks to send txs like the SE-2 Debug tab.
        </p>
      </main>
    </div>
  );
}
`;
}

/**
 * 1Claw Shroud LLM proxy — OpenAI-compatible /v1/chat/completions.
 * @see https://docs.1claw.xyz/docs/guides/shroud
 *
 * SHROUD_BILLING_MODE=token_billing → no X-Shroud-Api-Key (enable billing on 1claw.xyz). Google/Gemini upstream
 *   uses Shroud when no Google key is configured; with a key, direct Generative AI is used (optional BYOK).
 * SHROUD_BILLING_MODE=provider_api_key → vault://… from api-keys/{provider} or SHROUD_PROVIDER_API_KEY; Gemini
 *   requires a Google key for the direct path (503 if missing).
 */
function nextApiRouteOneClawShroud(
  upstream: ShroudUpstreamProvider,
  billingModeDefault: ShroudBillingMode,
): string {
  const modelFallback = shroudDefaultModel(upstream);
  return `import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  convertToCoreMessages,
  createDataStreamResponse,
  formatDataStreamPart,
  streamText,
  type CoreMessage,
} from "ai";

const shroudBaseURL =
  process.env.SHROUD_BASE_URL || "https://shroud.1claw.xyz/v1";

const shroudProvider =
  process.env.SHROUD_LLM_PROVIDER || "${upstream}";

const shroudModelFallback = "${modelFallback}";
/** Body + X-Shroud-Model; Stripe AI Gateway often 404s on gemini-2.5-flash — remap for Shroud only. */
const defaultModel = (() => {
  const raw =
    (process.env.SHROUD_DEFAULT_MODEL || "").trim() || shroudModelFallback;
  const p = shroudProvider.toLowerCase();
  if (
    (p === "google" || p === "gemini") &&
    raw === "gemini-2.5-flash"
  ) {
    return "gemini-2.0-flash";
  }
  return raw;
})();

/** Model ID passed to @ai-sdk/google when calling Gemini directly (overrides SHROUD_DEFAULT_MODEL for that path only). */
const geminiDirectModel =
  (process.env.GOOGLE_GENERATIVE_AI_MODEL || "").trim() || defaultModel;

const billingMode =
  (process.env.SHROUD_BILLING_MODE as "token_billing" | "provider_api_key") ||
  "${billingModeDefault}";

/** Gemini: call Google API directly when a key is available (Shroud /chat/completions → Gemini is broken). */
const CHAT_SYSTEM =
  "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.";

const STREAM_CHUNK =
  Math.max(8, Number(process.env.SHROUD_STREAM_CHUNK_CHARS || "40") || 40);

/** Canonical 8-4-4-4-12 hex (any version/variant 1Claw may return). */
const ONECLAW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeOneclawEnvValue(v) {
  let s = (v || "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (s === "undefined" || s === "null") return "";
  return s;
}

function looksLikeEthereumAddress(s) {
  if (!s.startsWith("0x") && !s.startsWith("0X")) return false;
  const hex = s.slice(2);
  return (
    /^[0-9a-fA-F]+$/.test(hex) && (hex.length === 40 || hex.length === 64)
  );
}

function shroudConfigError(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function validateShroudEnv():
  | { ok: true; agentId: string; agentKey: string }
  | { ok: false; response: Response } {
  const agentId = normalizeOneclawEnvValue(process.env.ONECLAW_AGENT_ID);
  const agentKey = normalizeOneclawEnvValue(process.env.ONECLAW_AGENT_API_KEY);

  if (!agentId || !agentKey) {
    return {
      ok: false,
      response: shroudConfigError(
        "Missing ONECLAW_AGENT_ID or ONECLAW_AGENT_API_KEY. Create an agent in 1claw.xyz and copy its UUID (not a wallet address) + API key into .env / .env.secrets.encrypted, then restart next dev. If you see ONECLAW_AGENT_ID=undefined in .env, remove it — that is invalid; use just list-1claw or the dashboard for the real UUID.",
      ),
    };
  }

  if (!ONECLAW_UUID_RE.test(agentId)) {
    const hint = looksLikeEthereumAddress(agentId)
      ? " You pasted an Ethereum address — that belongs in AGENT_ADDRESS (on-chain wallet), not here. Use the agent UUID from 1claw.xyz (or run just list-1claw with ONECLAW_API_KEY)."
      : agentId.includes("0x") || agentId.includes("0X")
        ? " This value looks like a hex address. Shroud needs the 1Claw agent UUID from the dashboard (just list-1claw), not an Ethereum address."
        : "";
    return {
      ok: false,
      response: shroudConfigError(
        "ONECLAW_AGENT_ID must be a UUID from the 1Claw dashboard (e.g. 550e8400-e29b-41d4-a716-446655440000). Ethereum addresses are rejected with \\"Invalid agent_id format\\"." +
          hint,
      ),
    };
  }

  if (billingMode === "provider_api_key") {
    const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
    const vaultPath = (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim();
    const inlineKey = (process.env.SHROUD_PROVIDER_API_KEY || "").trim();
    if (vaultPath && !inlineKey && !vaultId) {
      return {
        ok: false,
        response: shroudConfigError(
          "ONECLAW_VAULT_ID is empty but SHROUD_PROVIDER_VAULT_PATH is set. Copy your vault ID from 1claw.xyz into ONECLAW_VAULT_ID (needed for vault://… Shroud headers).",
        ),
      };
    }
  }

  return { ok: true, agentId, agentKey };
}

function coreContentToText(content: CoreMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function buildShroudOpenAIMessages(core: CoreMessage[]): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  const out: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: CHAT_SYSTEM }];
  for (const m of core) {
    if (m.role === "system") continue;
    if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: coreContentToText(m.content) });
    }
  }
  return out;
}

async function readVaultSecretPlaintext(vaultId, secretPath, agentId, agentApiKey) {
  const base = (process.env.ONECLAW_API_BASE_URL || "https://api.1claw.xyz").replace(
    /\\/$/,
    "",
  );
  const userApiKey = normalizeOneclawEnvValue(process.env.ONECLAW_API_KEY);
  let token;
  if (userApiKey) {
    const tr = await fetch(base + "/v1/auth/api-key-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: userApiKey }),
    });
    if (!tr.ok) return null;
    token = (await tr.json()).access_token;
  } else {
    const tr = await fetch(base + "/v1/auth/agent-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, api_key: agentApiKey }),
    });
    if (!tr.ok) return null;
    token = (await tr.json()).access_token;
  }
  const encPath = encodeURIComponent(secretPath);
  const res = await fetch(
    base + "/v1/vaults/" + vaultId + "/secrets/" + encPath,
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!res.ok) return null;
  const j = await res.json();
  return typeof j.value === "string" ? j.value.trim() : null;
}

async function resolveGoogleGeminiApiKey(agentId, agentKey) {
  const inline =
    (process.env.SHROUD_PROVIDER_API_KEY || "").trim() ||
    (process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim();
  if (inline) return inline;
  const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
  const vaultPath =
    (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim() || "api-keys/google";
  if (!vaultId) return null;
  return readVaultSecretPlaintext(vaultId, vaultPath, agentId, agentKey);
}

function gemini503() {
  return new Response(
    JSON.stringify({
      error:
        "SHROUD_BILLING_MODE=provider_api_key needs a Google API key for the optional direct Gemini API path. Set SHROUD_PROVIDER_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY, or store the key in the vault (e.g. api-keys/google) with ONECLAW_VAULT_ID. If you use 1Claw token billing only, set SHROUD_BILLING_MODE=token_billing — chat will call Shroud without a Google key in this app.",
    }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );
}

async function shroudChatCompletionNonStream(
  openaiMessages: Array<{ role: string; content: string }>,
  shroudHeaders: Record<string, string>,
): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string }> {
  const base = shroudBaseURL.replace(/\\/$/, "");
  const url = base + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...shroudHeaders,
    },
    body: JSON.stringify({
      model: defaultModel,
      messages: openaiMessages,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: raw };
  }
  try {
    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const c = data.choices?.[0]?.message?.content;
    const text = typeof c === "string" ? c : c == null ? "" : String(c);
    return { ok: true, text };
  } catch {
    return { ok: false, status: 502, body: "Invalid JSON from Shroud" };
  }
}

export async function POST(req: Request) {
  let messages: unknown[];
  try {
    const body = await req.json();
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Missing messages" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const creds = validateShroudEnv();
  if (!creds.ok) return creds.response;
  const { agentId, agentKey } = creds;

  const providerLC = shroudProvider.toLowerCase();
  if (
    (providerLC === "google" || providerLC === "gemini") &&
    process.env.SHROUD_DISABLE_GEMINI_DIRECT !== "1"
  ) {
    const geminiKey = await resolveGoogleGeminiApiKey(agentId, agentKey);
    if (geminiKey) {
      const google = createGoogleGenerativeAI({ apiKey: geminiKey });
      const result = streamText({
        model: google(geminiDirectModel),
        system: CHAT_SYSTEM,
        messages: convertToCoreMessages(messages),
        onError({ error }) {
          const msg = error instanceof Error ? error.message : String(error);
          if (
            /quota|429|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(msg)
          ) {
            console.error(
              "[api/chat] Gemini quota/rate limit — set GOOGLE_GENERATIVE_AI_MODEL (e.g. gemini-2.5-flash) or SHROUD_DEFAULT_MODEL, enable billing: https://ai.google.dev/gemini-api/docs/rate-limits",
            );
          }
          console.error("[api/chat] Gemini (direct) error:", error);
        },
      });
      return result.toDataStreamResponse();
    }
    if (billingMode === "provider_api_key") {
      return gemini503();
    }
    // token_billing: no BYOK Google key — use Shroud (1Claw-billed) for Gemini
  }

  const shroudHeaders: Record<string, string> = {
    "X-Shroud-Agent-Key": agentId + ":" + agentKey,
    "X-Shroud-Provider": shroudProvider,
    "X-Shroud-Model": defaultModel,
  };

  if (billingMode === "provider_api_key") {
    const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
    const vaultPath = (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim();
    const inlineKey = (process.env.SHROUD_PROVIDER_API_KEY || "").trim();
    if (vaultId && vaultPath) {
      shroudHeaders["X-Shroud-Api-Key"] = "vault://" + vaultId + "/" + vaultPath;
    } else if (inlineKey) {
      shroudHeaders["X-Shroud-Api-Key"] = inlineKey;
    }
  }

  const openaiMessages = buildShroudOpenAIMessages(
    convertToCoreMessages(messages),
  );

  return createDataStreamResponse({
    async execute(dataStream) {
      const r = await shroudChatCompletionNonStream(
        openaiMessages,
        shroudHeaders,
      );
      if (!r.ok) {
        let msg = r.body;
        try {
          const j = JSON.parse(r.body) as { error?: { message?: string } };
          if (j?.error?.message) msg = j.error.message;
        } catch {
          /* keep raw */
        }
        throw new Error(
          "Shroud " +
            r.status +
            ": " +
            msg.slice(0, 2000) +
            (r.body.length > 2000 ? "…" : ""),
        );
      }
      const text = r.text;
      for (let i = 0; i < text.length; i += STREAM_CHUNK) {
        dataStream.write(
          formatDataStreamPart("text", text.slice(i, i + STREAM_CHUNK)),
        );
      }
      dataStream.write(
        formatDataStreamPart("finish_message", {
          finishReason: "stop",
          usage: undefined,
        }),
      );
    },
    onError(error) {
      console.error("[api/chat] Shroud stream error:", error);
      return error instanceof Error ? error.message : String(error);
    },
  });
}
`;
}

function nextApiRouteVaultThirdParty(llm: ThirdPartyLlm): string {
  const geminiModelBlock =
    llm === "gemini"
      ? `const geminiModelId =
  (process.env.GOOGLE_GENERATIVE_AI_MODEL || "").trim() || "${GEMINI_GOOGLE_AI_MODEL_DEFAULT}";

`
      : "";
  const modelArg =
    llm === "gemini" ? "geminiModelId" : llmDefaultModel(llm);

  return `import { convertToCoreMessages, streamText, type Message } from "ai";
${llmFactoryImport(llm)}
import { createClient } from "@1claw/sdk";

${geminiModelBlock}const client = createClient({
  baseUrl: "https://api.1claw.xyz",
  apiKey: process.env.ONECLAW_API_KEY!,
});

let cachedKey: string | null = null;

async function getLlmKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error(
      "ONECLAW_API_KEY is missing. Set it in .env so the server can read the vault.",
    );
  }
  if (!vaultId) {
    throw new Error(
      "ONECLAW_VAULT_ID is missing. Copy your vault id from 1claw.xyz into .env.",
    );
  }
  const res = await client.secrets.get(vaultId, "llm-api-key");
  if (res.error) {
    throw new Error(
      "1Claw vault read failed: " +
        res.error.message +
        ". Check ONECLAW_API_KEY and ONECLAW_VAULT_ID.",
    );
  }
  const value = res.data?.value;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      'No secret at vault path "llm-api-key". Add your LLM API key in the 1Claw dashboard (same path the scaffold uses) or set it via the API, then restart next dev.',
    );
  }
  cachedKey = value.trim();
  return cachedKey;
}

export async function POST(req: Request) {
  let messages: Message[];
  try {
    const body = await req.json();
    messages = body.messages as Message[];
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Missing messages" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  let key: string;
  try {
    key = await getLlmKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/chat] getLlmKey:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  const provider = ${llmFactoryCall(llm)};

  const result = streamText({
    model: provider(${modelArg}),
    system:
      "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages: convertToCoreMessages(messages),
    onError({ error }) {
      console.error("[api/chat] streamText error:", error);
    },
  });

  return result.toDataStreamResponse();
}
`;
}

function nextApiRouteDirectThirdParty(llm: ThirdPartyLlm): string {
  const geminiModelBlock =
    llm === "gemini"
      ? `const geminiModelId =
  (process.env.GOOGLE_GENERATIVE_AI_MODEL || "").trim() || "${GEMINI_GOOGLE_AI_MODEL_DEFAULT}";

`
      : "";
  const modelExpr =
    llm === "gemini" ? "google(geminiModelId)" : llmModelCall(llm);

  return `import { convertToCoreMessages, streamText, type Message } from "ai";
${llmModelImport(llm)}
${geminiModelBlock}
export async function POST(req: Request) {
  let messages: Message[];
  try {
    const body = await req.json();
    messages = body.messages as Message[];
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Missing messages" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = streamText({
    model: ${modelExpr},
    system:
      "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages: convertToCoreMessages(messages),
    onError({ error }) {
      console.error("[api/chat] streamText error:", error);
    },
  });

  return result.toDataStreamResponse();
}
`;
}

function nextApiRoute(
  llm: LlmProvider,
  secretsMode: SecretsMode,
  shroudUpstream?: ShroudUpstreamProvider,
  shroudBillingMode?: ShroudBillingMode,
): string {
  if (llm === "oneclaw") {
    return nextApiRouteOneClawShroud(
      shroudUpstream ?? "openai",
      shroudBillingMode ?? "token_billing",
    );
  }
  if (useVaultForSecrets(secretsMode)) {
    return nextApiRouteVaultThirdParty(llm);
  }
  return nextApiRouteDirectThirdParty(llm);
}

// ── NextJS ──────────────────────────────────────────────────────────────────

function scaffoldNextJS(root: string, config: ScaffoldConfig) {
  const pkg = dir(root, "packages", "nextjs");
  dir(pkg, "app", "api", "chat");
  dir(pkg, "app", "api", "agent0", "lookup");
  dir(pkg, "app", "api", "balances");
  dir(pkg, "app", "api", "faucet");
  dir(pkg, "app", "debug");
  dir(pkg, "app", "identity");
  dir(pkg, "app", "ens");
  dir(pkg, "app", "balances");
  dir(pkg, "components", "ui");
  dir(pkg, "lib");
  dir(pkg, "contracts");
  dir(pkg, "public");

  const deps: Record<string, string> = {
    next: "^15.0.0",
    react: "^19.0.0",
    "react-dom": "^19.0.0",
    ai: "^4.0.0",
    [llmSdkPackage(config.llm)]: "^1.0.0",
    "class-variance-authority": "^0.7.0",
    clsx: "^2.1.0",
    "tailwind-merge": "^2.5.0",
    "lucide-react": "^0.460.0",
    "@radix-ui/react-slot": "^1.1.0",
    "agent0-sdk": "^1.7.1",
    viem: "^2.21.0",
    wagmi: "^2.14.0",
    "@tanstack/react-query": "^5.62.0",
    "@rainbow-me/rainbowkit": "^2.2.0",
    "burner-connector": "^0.0.20",
  };

  if (config.llm === "oneclaw" || config.secrets.mode === "oneclaw") {
    deps["@1claw/sdk"] = "latest";
  }
  if (config.llm === "oneclaw") {
    deps["@ai-sdk/google"] = "^1.0.0";
  }
  if (config.installAmpersendSdk) {
    deps["@ampersend_ai/ampersend-sdk"] = AMPERSEND_SDK_VERSION;
  }

  file(
    pkg,
    "package.json",
    JSON.stringify(
      {
        name: "nextjs",
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "next dev --turbo",
          build: "next build",
          start: "next start",
        },
        dependencies: deps,
        devDependencies: {
          typescript: "^5.6.0",
          "@types/react": "^19.0.0",
          "@types/node": "^22.0.0",
          tailwindcss: "^3.4.0",
          postcss: "^8.4.0",
          autoprefixer: "^10.4.0",
        },
      },
      null,
      2,
    ) + "\n",
  );

  file(
    pkg,
    "next.config.js",
    `const path = require("path");
const { loadEnvConfig } = require("@next/env");

// Monorepo app root (…/packages/nextjs → repo root). Avoids wrong inference when a parent folder also has a lockfile.
const projectRoot = path.join(__dirname, "..", "..");

// Load repo-root .env (ONECLAW_VAULT_ID, RPC_URL, …). Next only auto-loads env from packages/nextjs/ otherwise.
loadEnvConfig(projectRoot);

// RainbowKit / wagmi → MetaMask SDK + WalletConnect pull optional deps that break the Next browser bundle.
const stubAsyncStorage = path.join(__dirname, "lib", "stub-async-storage.cjs");
const stubPinoPretty = path.join(__dirname, "lib", "stub-pino-pretty.cjs");
/** Turbopack resolveAlias must be relative to this config file — absolute paths break (./Users/…). */
const nodeBuiltinStubRel = "./lib/node-builtins-browser-stub.cjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Silence "multiple lockfiles" / wrong workspace root when developing inside a nested monorepo.
  outputFileTracingRoot: projectRoot,
  // Hide the Next.js dev indicator / dev tools entry in the browser (build & runtime errors still show).
  devIndicators: false,
  // Tree-shake lucide barrel imports → smaller client chunks (faster subpage loads).
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  transpilePackages: [
    "agent0-sdk",
    "@rainbow-me/rainbowkit",
    "wagmi",
    "@tanstack/react-query"${config.installAmpersendSdk ? ',\n    "@ampersend_ai/ampersend-sdk"' : ""}
  ],
  // agent0-sdk references Node builtins (e.g. fs) for IPFS; browser registration uses wallet + on-chain paths only.
  webpack: (config, { isServer, webpack: webpackApi }) => {
    // MetaMask SDK + WalletConnect: optional deps break resolution from hoisted node_modules — replace at resolve time.
    config.plugins.push(
      new webpackApi.NormalModuleReplacementPlugin(
        /^@react-native-async-storage\\/async-storage$/,
        stubAsyncStorage,
      ),
      new webpackApi.NormalModuleReplacementPlugin(/^pino-pretty$/, stubPinoPretty),
    );
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        path: false,
      };
    }
    const prevAlias = config.resolve.alias;
    const nextAlias =
      prevAlias && typeof prevAlias === "object" && !Array.isArray(prevAlias)
        ? { ...prevAlias }
        : {};
    nextAlias["@react-native-async-storage/async-storage"] = stubAsyncStorage;
    nextAlias["@react-native-async-storage/async-storage$"] = stubAsyncStorage;
    nextAlias["pino-pretty"] = stubPinoPretty;
    nextAlias["pino-pretty$"] = stubPinoPretty;
    config.resolve.alias = nextAlias;
    return config;
  },
  // next dev --turbo: aliases must be paths relative to next.config.js (not path.join absolutes).
  turbopack: {
    resolveAlias: {
      fs: nodeBuiltinStubRel,
      net: nodeBuiltinStubRel,
      tls: nodeBuiltinStubRel,
      dns: nodeBuiltinStubRel,
      child_process: nodeBuiltinStubRel,
      path: nodeBuiltinStubRel,
      "@react-native-async-storage/async-storage": "./lib/stub-async-storage.cjs",
      "pino-pretty": "./lib/stub-pino-pretty.cjs",
    },
  },
  async redirects() {
    return [
      {
        source: "/favicon.ico",
        destination: "/icon.svg",
        permanent: false,
      },
    ];
  },
};
module.exports = nextConfig;
`,
  );

  file(
    pkg,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "es5",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: {
            "@/*": ["./*"],
            "@repo/*": ["../../*"],
          },
        },
        include: [
          "next-env.d.ts",
          "**/*.ts",
          "**/*.tsx",
          ".next/types/**/*.ts",
          "../../network-definitions.ts",
          "../../scaffold.config.ts",
          "../../viem-chain.ts",
        ],
        exclude: ["node_modules"],
      },
      null,
      2,
    ) + "\n",
  );

  file(pkg, "tailwind.config.ts", TAILWIND_CONFIG);
  file(pkg, "postcss.config.mjs", POSTCSS_CONFIG);
  file(pkg, "components.json", COMPONENTS_JSON);
  file(pkg, "lib/utils.ts", UTILS_TS);
  file(pkg, "lib/networks.ts", nextNetworksReexportSource());
  file(pkg, "lib/burner-auto-connect.tsx", burnerAutoConnectSource());
  file(pkg, "lib/wagmi-config.ts", wagmiConfigSource(config.projectName, "next"));
  file(pkg, "lib/web3-providers.tsx", web3ProvidersSource("next"));
  file(pkg, "components/ConnectWalletButton.tsx", connectWalletButtonSource());
  file(pkg, "components/LocalFaucetButton.tsx", localFaucetButtonSource());
  file(
    pkg,
    "lib/node-builtins-browser-stub.cjs",
    `// Stubs Node core modules in the browser bundle (agent0-sdk pulls optional IPFS paths).
module.exports = {};
`,
  );
  file(
    pkg,
    "lib/stub-async-storage.cjs",
    `// MetaMask SDK references RN async-storage; web bundle uses this in-memory stub (see next.config.js).
const mem = new Map();
const api = {
  getItem: async (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
  setItem: async (k, v) => {
    mem.set(String(k), String(v));
  },
  removeItem: async (k) => {
    mem.delete(String(k));
  },
  clear: async () => {
    mem.clear();
  },
  getAllKeys: async () => [...mem.keys()],
  multiGet: async (keys) => keys.map((k) => [k, mem.get(String(k)) ?? null]),
  multiSet: async (pairs) => {
    for (const [k, v] of pairs) mem.set(String(k), String(v));
  },
  multiRemove: async (keys) => {
    for (const k of keys) mem.delete(String(k));
  },
};
module.exports = api;
module.exports.default = api;
`,
  );
  file(
    pkg,
    "lib/stub-pino-pretty.cjs",
    `// Optional pino transport used by WalletConnect logger in dev; not needed in the browser bundle.
module.exports = function stubPinoPretty() {
  return {};
};
`,
  );
  file(pkg, "components/ui/button.tsx", BUTTON_TSX);
  file(pkg, "components/ui/input.tsx", INPUT_TSX);

  file(
    pkg,
    "app/globals.css",
    SHADCN_CSS,
  );

  file(pkg, "app/providers.tsx", nextAppProvidersSource());

  const routeLoading = nextAppRouteLoadingSource();
  file(pkg, "app/loading.tsx", routeLoading);
  file(pkg, "app/identity/loading.tsx", routeLoading);
  file(pkg, "app/balances/loading.tsx", routeLoading);
  file(pkg, "app/debug/loading.tsx", routeLoading);
  file(pkg, "app/ens/loading.tsx", routeLoading);

  file(
    pkg,
    "app/layout.tsx",
    `import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "${config.projectName}",
  description: "Onchain AI Agent",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>
          <a
            href="#site-main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Skip to main content
          </a>
          <div id="site-main" className="min-h-screen">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
`,
  );

  file(
    pkg,
    "public/icon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="App">
  <rect width="32" height="32" rx="8" fill="#6366f1"/>
  <path fill="white" d="M8 20c0-4 3-7 8-7s8 3 8 7v2H8v-2zm4-9a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" opacity=".9"/>
</svg>
`,
  );

  file(pkg, "app/page.tsx", chatPageContent(config.projectName));
  file(pkg, "app/debug/page.tsx", debugPageContent());
  file(
    pkg,
    "app/identity/page.tsx",
    identityPageSource(config.projectName, "next"),
  );
  file(pkg, "app/ens/page.tsx", ensPageSource(config.projectName, "next"));
  file(pkg, "app/balances/page.tsx", balancesPageSource("next"));
  file(pkg, "app/api/agent0/lookup/route.ts", nextApiAgent0LookupRoute());
  file(pkg, "app/api/balances/route.ts", nextApiBalancesRoute());
  file(pkg, "app/api/faucet/route.ts", nextApiFaucetRoute());
  file(
    pkg,
    "app/api/chat/route.ts",
    nextApiRoute(
      config.llm,
      config.secrets.mode,
      config.shroudUpstream,
      config.shroudBillingMode,
    ),
  );

  file(
    pkg,
    "contracts/deployedContracts.ts",
    `// Auto-generated by scaffold-agent — do not edit manually
// Re-generate with: just deploy

const deployedContracts = {} as const;

export default deployedContracts;
`,
  );
}

// ── Vite ────────────────────────────────────────────────────────────────────

function viteApiRouteOneClawShroud(
  upstream: ShroudUpstreamProvider,
  billingModeDefault: ShroudBillingMode,
): string {
  const modelFallback = shroudDefaultModel(upstream);
  return `import { createGoogleGenerativeAI } from "@ai-sdk/google";
import express from "express";
import {
  convertToCoreMessages,
  pipeDataStreamToResponse,
  formatDataStreamPart,
  streamText,
  type CoreMessage,
} from "ai";
import "dotenv/config";
import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import { getActiveNetwork } from "../../network-definitions.js";
import { viemChainForNetwork } from "../../viem-chain.js";

const shroudBaseURL =
  process.env.SHROUD_BASE_URL || "https://shroud.1claw.xyz/v1";

const shroudProvider =
  process.env.SHROUD_LLM_PROVIDER || "${upstream}";

const shroudModelFallback = "${modelFallback}";
const defaultModel = (() => {
  const raw =
    (process.env.SHROUD_DEFAULT_MODEL || "").trim() || shroudModelFallback;
  const p = shroudProvider.toLowerCase();
  if (
    (p === "google" || p === "gemini") &&
    raw === "gemini-2.5-flash"
  ) {
    return "gemini-2.0-flash";
  }
  return raw;
})();

const geminiDirectModel =
  (process.env.GOOGLE_GENERATIVE_AI_MODEL || "").trim() || defaultModel;

const billingMode =
  (process.env.SHROUD_BILLING_MODE as "token_billing" | "provider_api_key") ||
  "${billingModeDefault}";

const CHAT_SYSTEM =
  "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.";

const STREAM_CHUNK =
  Math.max(8, Number(process.env.SHROUD_STREAM_CHUNK_CHARS || "40") || 40);

const ONECLAW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeOneclawEnvValue(v) {
  let s = (v || "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (s === "undefined" || s === "null") return "";
  return s;
}

function looksLikeEthereumAddress(s) {
  if (!s.startsWith("0x") && !s.startsWith("0X")) return false;
  const hex = s.slice(2);
  return (
    /^[0-9a-fA-F]+$/.test(hex) && (hex.length === 40 || hex.length === 64)
  );
}

function validateShroudEnvExpress(res) {
  const agentId = normalizeOneclawEnvValue(process.env.ONECLAW_AGENT_ID);
  const agentKey = normalizeOneclawEnvValue(process.env.ONECLAW_AGENT_API_KEY);

  if (!agentId || !agentKey) {
    res.status(400).json({
      error:
        "Missing ONECLAW_AGENT_ID or ONECLAW_AGENT_API_KEY. Use the agent UUID from 1claw.xyz (not a wallet address). If .env has ONECLAW_AGENT_ID=undefined, remove it — use just list-1claw for the real UUID.",
    });
    return null;
  }

  if (!ONECLAW_UUID_RE.test(agentId)) {
    const hint = looksLikeEthereumAddress(agentId)
      ? " You pasted an Ethereum address — use AGENT_ADDRESS for that; ONECLAW_AGENT_ID is the 1claw.xyz agent UUID (just list-1claw)."
      : agentId.includes("0x") || agentId.includes("0X")
        ? " This value looks like a hex address. Use the 1Claw agent UUID from the dashboard (just list-1claw)."
        : "";
    res.status(400).json({
      error:
        "ONECLAW_AGENT_ID must be a UUID from the 1Claw dashboard. Ethereum addresses cause \\"Invalid agent_id format\\" from Shroud." +
        hint,
    });
    return null;
  }

  if (billingMode === "provider_api_key") {
    const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
    const vaultPath = (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim();
    const inlineKey = (process.env.SHROUD_PROVIDER_API_KEY || "").trim();
    if (vaultPath && !inlineKey && !vaultId) {
      res.status(400).json({
        error:
          "ONECLAW_VAULT_ID is required when SHROUD_PROVIDER_VAULT_PATH is set (vault:// header).",
      });
      return null;
    }
  }

  return { agentId, agentKey };
}

function coreContentToText(content: CoreMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function buildShroudOpenAIMessages(core: CoreMessage[]): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  const out: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: CHAT_SYSTEM }];
  for (const m of core) {
    if (m.role === "system") continue;
    if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: coreContentToText(m.content) });
    }
  }
  return out;
}

async function readVaultSecretPlaintext(vaultId, secretPath, agentId, agentApiKey) {
  const base = (process.env.ONECLAW_API_BASE_URL || "https://api.1claw.xyz").replace(
    /\\/$/,
    "",
  );
  const userApiKey = normalizeOneclawEnvValue(process.env.ONECLAW_API_KEY);
  let token;
  if (userApiKey) {
    const tr = await fetch(base + "/v1/auth/api-key-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: userApiKey }),
    });
    if (!tr.ok) return null;
    token = (await tr.json()).access_token;
  } else {
    const tr = await fetch(base + "/v1/auth/agent-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, api_key: agentApiKey }),
    });
    if (!tr.ok) return null;
    token = (await tr.json()).access_token;
  }
  const encPath = encodeURIComponent(secretPath);
  const res = await fetch(
    base + "/v1/vaults/" + vaultId + "/secrets/" + encPath,
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!res.ok) return null;
  const j = await res.json();
  return typeof j.value === "string" ? j.value.trim() : null;
}

async function resolveGoogleGeminiApiKey(agentId, agentKey) {
  const inline =
    (process.env.SHROUD_PROVIDER_API_KEY || "").trim() ||
    (process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim();
  if (inline) return inline;
  const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
  const vaultPath =
    (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim() || "api-keys/google";
  if (!vaultId) return null;
  return readVaultSecretPlaintext(vaultId, vaultPath, agentId, agentKey);
}

function sendGemini503(res) {
  res.status(503).json({
    error:
      "SHROUD_BILLING_MODE=provider_api_key needs a Google API key for the optional direct Gemini path. Set SHROUD_PROVIDER_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY, or vault api-keys/google with ONECLAW_VAULT_ID. For token billing only, use SHROUD_BILLING_MODE=token_billing so chat calls Shroud without a Google key in this app.",
  });
}

async function shroudChatCompletionNonStream(
  openaiMessages: Array<{ role: string; content: string }>,
  shroudHeaders: Record<string, string>,
): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string }> {
  const base = shroudBaseURL.replace(/\\/$/, "");
  const url = base + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...shroudHeaders,
    },
    body: JSON.stringify({
      model: defaultModel,
      messages: openaiMessages,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: raw };
  }
  try {
    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const c = data.choices?.[0]?.message?.content;
    const text = typeof c === "string" ? c : c == null ? "" : String(c);
    return { ok: true, text };
  } catch {
    return { ok: false, status: 502, body: "Invalid JSON from Shroud" };
  }
}

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing messages" });
    return;
  }

  const creds = validateShroudEnvExpress(res);
  if (!creds) return;
  const { agentId, agentKey } = creds;

  const providerLC = shroudProvider.toLowerCase();
  if (
    (providerLC === "google" || providerLC === "gemini") &&
    process.env.SHROUD_DISABLE_GEMINI_DIRECT !== "1"
  ) {
    const geminiKey = await resolveGoogleGeminiApiKey(agentId, agentKey);
    if (geminiKey) {
      const google = createGoogleGenerativeAI({ apiKey: geminiKey });
      const result = streamText({
        model: google(geminiDirectModel),
        system: CHAT_SYSTEM,
        messages: convertToCoreMessages(messages),
        onError({ error }) {
          const msg = error instanceof Error ? error.message : String(error);
          if (
            /quota|429|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(msg)
          ) {
            console.error(
              "[api/chat] Gemini quota/rate limit — set GOOGLE_GENERATIVE_AI_MODEL (e.g. gemini-2.5-flash) or SHROUD_DEFAULT_MODEL, enable billing: https://ai.google.dev/gemini-api/docs/rate-limits",
            );
          }
          console.error("[api/chat] Gemini (direct) error:", error);
        },
      });
      result.pipeDataStreamToResponse(res);
      return;
    }
    if (billingMode === "provider_api_key") {
      sendGemini503(res);
      return;
    }
  }

  const shroudHeaders: Record<string, string> = {
    "X-Shroud-Agent-Key": agentId + ":" + agentKey,
    "X-Shroud-Provider": shroudProvider,
    "X-Shroud-Model": defaultModel,
  };

  if (billingMode === "provider_api_key") {
    const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
    const vaultPath = (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim();
    const inlineKey = (process.env.SHROUD_PROVIDER_API_KEY || "").trim();
    if (vaultId && vaultPath) {
      shroudHeaders["X-Shroud-Api-Key"] = "vault://" + vaultId + "/" + vaultPath;
    } else if (inlineKey) {
      shroudHeaders["X-Shroud-Api-Key"] = inlineKey;
    }
  }

  const openaiMessages = buildShroudOpenAIMessages(
    convertToCoreMessages(messages),
  );

  pipeDataStreamToResponse(res, {
    async execute(dataStream) {
      const r = await shroudChatCompletionNonStream(
        openaiMessages,
        shroudHeaders,
      );
      if (!r.ok) {
        let msg = r.body;
        try {
          const j = JSON.parse(r.body) as { error?: { message?: string } };
          if (j?.error?.message) msg = j.error.message;
        } catch {
          /* keep raw */
        }
        throw new Error(
          "Shroud " +
            r.status +
            ": " +
            msg.slice(0, 2000) +
            (r.body.length > 2000 ? "…" : ""),
        );
      }
      const text = r.text;
      for (let i = 0; i < text.length; i += STREAM_CHUNK) {
        dataStream.write(
          formatDataStreamPart("text", text.slice(i, i + STREAM_CHUNK)),
        );
      }
      dataStream.write(
        formatDataStreamPart("finish_message", {
          finishReason: "stop",
          usage: undefined,
        }),
      );
    },
    onError(error) {
      console.error("[api/chat] Shroud stream error:", error);
      return error instanceof Error ? error.message : String(error);
    },
  });
});
${viteAgent0AndBalancesExpressBlock()}
app.listen(3001, () => console.log("API server on http://localhost:3001"));
`;
}

function viteApiRouteVaultThirdParty(llm: ThirdPartyLlm): string {
  const geminiModelBlock =
    llm === "gemini"
      ? `const geminiModelId =
  (process.env.GOOGLE_GENERATIVE_AI_MODEL || "").trim() || "${GEMINI_GOOGLE_AI_MODEL_DEFAULT}";

`
      : "";
  const modelArg =
    llm === "gemini" ? "geminiModelId" : llmDefaultModel(llm);

  return `import express from "express";
import { convertToCoreMessages, streamText } from "ai";
${llmFactoryImport(llm)}
import { createClient } from "@1claw/sdk";
import "dotenv/config";
import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import { getActiveNetwork } from "../../network-definitions.js";
import { viemChainForNetwork } from "../../viem-chain.js";

${geminiModelBlock}const client = createClient({
  baseUrl: "https://api.1claw.xyz",
  apiKey: process.env.ONECLAW_API_KEY,
});

let cachedKey = null;

async function getLlmKey() {
  if (cachedKey) return cachedKey;
  const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error(
      "ONECLAW_API_KEY is missing. Set it in .env so the server can read the vault.",
    );
  }
  if (!vaultId) {
    throw new Error(
      "ONECLAW_VAULT_ID is missing. Copy your vault id from 1claw.xyz into .env.",
    );
  }
  const res = await client.secrets.get(vaultId, "llm-api-key");
  if (res.error) {
    throw new Error(
      "1Claw vault read failed: " +
        res.error.message +
        ". Check ONECLAW_API_KEY and ONECLAW_VAULT_ID.",
    );
  }
  const value = res.data?.value;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      'No secret at vault path "llm-api-key". Add your LLM API key in the 1Claw dashboard, then restart the API server.',
    );
  }
  cachedKey = value.trim();
  return cachedKey;
}

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing messages" });
    return;
  }
  let key;
  try {
    key = await getLlmKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/chat] getLlmKey:", msg);
    res.status(502).json({ error: msg });
    return;
  }
  const provider = ${llmFactoryCall(llm)};

  const result = streamText({
    model: provider(${modelArg}),
    system:
      "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages: convertToCoreMessages(messages),
    onError({ error }) {
      console.error("[api/chat] streamText error:", error);
    },
  });

  result.pipeDataStreamToResponse(res);
});
${viteAgent0AndBalancesExpressBlock()}
app.listen(3001, () => console.log("API server on http://localhost:3001"));
`;
}

function viteApiRouteDirectThirdParty(llm: ThirdPartyLlm): string {
  const envKey = llmEnvKey(llm);
  const geminiModelBlock =
    llm === "gemini"
      ? `const geminiModelId =
  (process.env.GOOGLE_GENERATIVE_AI_MODEL || "").trim() || "${GEMINI_GOOGLE_AI_MODEL_DEFAULT}";

`
      : "";
  const modelExpr =
    llm === "gemini" ? "google(geminiModelId)" : llmModelCall(llm);

  return `import express from "express";
import { convertToCoreMessages, streamText } from "ai";
${llmModelImport(llm)}
import "dotenv/config";
import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import { getActiveNetwork } from "../../network-definitions.js";
import { viemChainForNetwork } from "../../viem-chain.js";

${geminiModelBlock}const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing messages" });
    return;
  }

  const result = streamText({
    model: ${modelExpr},
    system:
      "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages: convertToCoreMessages(messages),
    onError({ error }) {
      console.error("[api/chat] streamText error:", error);
    },
  });

  result.pipeDataStreamToResponse(res);
});
${viteAgent0AndBalancesExpressBlock()}
app.listen(3001, () => console.log("API server on http://localhost:3001${envKey ? ` (needs ${envKey})` : ""}"));
`;
}

function viteApiRoute(
  llm: LlmProvider,
  secretsMode: SecretsMode,
  shroudUpstream?: ShroudUpstreamProvider,
  shroudBillingMode?: ShroudBillingMode,
): string {
  if (llm === "oneclaw") {
    return viteApiRouteOneClawShroud(
      shroudUpstream ?? "openai",
      shroudBillingMode ?? "token_billing",
    );
  }
  if (useVaultForSecrets(secretsMode)) {
    return viteApiRouteVaultThirdParty(llm);
  }
  return viteApiRouteDirectThirdParty(llm);
}

function scaffoldVite(root: string, config: ScaffoldConfig) {
  const pkg = dir(root, "packages", "vite");
  dir(pkg, "src", "components", "ui");
  dir(pkg, "src", "lib");
  dir(pkg, "src", "contracts");
  dir(pkg, "public");

  const deps: Record<string, string> = {
    react: "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    ai: "^4.0.0",
    [llmSdkPackage(config.llm)]: "^1.0.0",
    "class-variance-authority": "^0.7.0",
    clsx: "^2.1.0",
    "tailwind-merge": "^2.5.0",
    "lucide-react": "^0.460.0",
    "@radix-ui/react-slot": "^1.1.0",
    "agent0-sdk": "^1.7.1",
    viem: "^2.21.0",
    wagmi: "^2.14.0",
    "@tanstack/react-query": "^5.62.0",
    "@rainbow-me/rainbowkit": "^2.2.0",
    "burner-connector": "^0.0.20",
  };

  if (config.llm === "oneclaw" || config.secrets.mode === "oneclaw") {
    deps["@1claw/sdk"] = "latest";
  }
  if (config.llm === "oneclaw") {
    deps["@ai-sdk/google"] = "^1.0.0";
  }
  if (config.installAmpersendSdk) {
    deps["@ampersend_ai/ampersend-sdk"] = AMPERSEND_SDK_VERSION;
  }

  file(
    pkg,
    "package.json",
    JSON.stringify(
      {
        name: "vite-app",
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          dev: 'concurrently "npx tsx server.ts" "vite"',
          build: "tsc && vite build",
          preview: "vite preview",
        },
        dependencies: deps,
        devDependencies: {
          typescript: "^5.6.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          "@vitejs/plugin-react": "^4.3.0",
          vite: "^6.0.0",
          tailwindcss: "^3.4.0",
          postcss: "^8.4.0",
          autoprefixer: "^10.4.0",
          express: "^4.21.0",
          dotenv: "^16.4.0",
          concurrently: "^9.1.0",
          tsx: "^4.19.0",
        },
      },
      null,
      2,
    ) + "\n",
  );

  file(
    pkg,
    "vite.config.ts",
    `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  envDir: resolve(__dirname, "../.."),
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
`,
  );

  file(
    pkg,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          resolveJsonModule: true,
          isolatedModules: true,
          paths: { "@/*": ["./src/*"] },
        },
        include: [
          "src",
          "vite-env.d.ts",
          "server.ts",
          "../../network-definitions.ts",
          "../../scaffold.config.ts",
          "../../viem-chain.ts",
        ],
      },
      null,
      2,
    ) + "\n",
  );

  file(
    pkg,
    "vite-env.d.ts",
    `/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_ADDRESS?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
`,
  );

  file(pkg, "tailwind.config.ts", TAILWIND_CONFIG);
  file(pkg, "postcss.config.mjs", POSTCSS_CONFIG);

  const viteComponentsJson = JSON.parse(COMPONENTS_JSON);
  viteComponentsJson.tailwind.css = "src/index.css";
  viteComponentsJson.aliases.components = "@/components";
  viteComponentsJson.aliases.utils = "@/lib/utils";
  file(pkg, "components.json", JSON.stringify(viteComponentsJson, null, 2));

  file(pkg, "src/lib/utils.ts", UTILS_TS);
  file(pkg, "src/lib/networks.ts", viteNetworksReexportSource());
  file(pkg, "src/lib/burner-auto-connect.tsx", burnerAutoConnectSource());
  file(pkg, "src/lib/wagmi-config.ts", wagmiConfigSource(config.projectName, "vite"));
  file(pkg, "src/lib/web3-providers.tsx", web3ProvidersSource("vite"));
  file(pkg, "src/components/ConnectWalletButton.tsx", connectWalletButtonSource());
  file(pkg, "src/components/PageLoading.tsx", vitePageLoadingSource());
  file(pkg, "src/components/ui/button.tsx", BUTTON_TSX);
  file(pkg, "src/components/ui/input.tsx", INPUT_TSX);
  file(pkg, "src/index.css", SHADCN_CSS);

  file(
    pkg,
    "index.html",
    `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${config.projectName}</title>
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  );

  file(
    pkg,
    "src/main.tsx",
    `import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Web3Providers } from "./lib/web3-providers";
import { PageLoading } from "./components/PageLoading";
import { Chat } from "./Chat";
import "./index.css";

const IdentityPage = lazy(() => import("./IdentityPage"));
const EnsPage = lazy(() => import("./EnsPage"));
const BalancesPage = lazy(() => import("./BalancesPage"));

createRoot(document.getElementById("root")!).render(
  <Web3Providers>
    <BrowserRouter>
      <a
        href="#site-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <div id="site-main" className="min-h-screen">
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Chat />} />
            <Route path="/identity" element={<IdentityPage />} />
            <Route path="/ens" element={<EnsPage />} />
            <Route path="/balances" element={<BalancesPage />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  </Web3Providers>,
);
`,
  );

  const viteChatPage = chatPageContent(config.projectName, {
    debugLink: false,
    linkFramework: "react-router",
  }).replace('"use client";\n\n', "");
  const viteChat = viteChatPage
    .replace("export default function Home()", "export function Chat()")
    .replace(/@\/components/g, "@/components")
    .replace(/@\/lib/g, "@/lib");

  file(pkg, "src/Chat.tsx", viteChat);
  file(
    pkg,
    "src/IdentityPage.tsx",
    identityPageSource(config.projectName, "vite"),
  );
  file(pkg, "src/EnsPage.tsx", ensPageSource(config.projectName, "vite"));
  file(pkg, "src/BalancesPage.tsx", balancesPageSource("vite"));
  file(
    pkg,
    "server.ts",
    viteApiRoute(
      config.llm,
      config.secrets.mode,
      config.shroudUpstream,
      config.shroudBillingMode,
    ),
  );

  file(
    pkg,
    "src/contracts/deployedContracts.ts",
    `// Auto-generated by scaffold-agent — do not edit manually
// Re-generate with: just deploy

const deployedContracts = {} as const;

export default deployedContracts;
`,
  );
}

// ── Python (Google A2A) ─────────────────────────────────────────────────────

function scaffoldPython(root: string, config: ScaffoldConfig) {
  const pkg = dir(root, "packages", "python");
  dir(pkg, "agent");
  dir(pkg, "tests");

  const llmDep =
    config.llm === "gemini"
      ? "google-genai>=1.0.0"
      : config.llm === "anthropic"
        ? "anthropic>=0.40.0"
        : "openai>=1.50.0";

  file(
    pkg,
    "pyproject.toml",
    `[project]
name = "${config.projectName}-agent"
version = "0.1.0"
description = "Onchain AI agent (Google A2A)"
requires-python = ">=3.11"
dependencies = [
    "python-a2a>=0.3.0",
    "web3>=7.0.0",
    "python-dotenv>=1.0.0",
    "${llmDep}",
]

[project.optional-dependencies]
dev = ["pytest>=8.0.0", "ruff>=0.6.0"]

[build-system]
requires = ["setuptools>=75.0"]
build-backend = "setuptools.build_meta"
`,
  );

  file(
    pkg,
    "requirements.txt",
    `python-a2a>=0.3.0
web3>=7.0.0
python-dotenv>=1.0.0
${llmDep}
`,
  );

  file(
    pkg,
    "agent/__init__.py",
    `"""${config.projectName} — onchain AI agent."""\n`,
  );

  file(
    pkg,
    "agent/__main__.py",
    `"""Entry point: python -m agent"""
from dotenv import load_dotenv

load_dotenv()


def main():
    print("${config.projectName} agent running...")


if __name__ == "__main__":
    main()
`,
  );

  gitkeep(join(pkg, "tests"));
}

// ── Public entry ────────────────────────────────────────────────────────────

export async function scaffoldProject(config: ScaffoldConfig) {
  const root = join(process.cwd(), config.projectName);
  dir(root, "packages");

  writeRootFiles(root, config);
  writeJustfile(root, config);
  writeScripts(root, config);

  if (config.chain === "foundry") scaffoldFoundry(root);
  if (config.chain === "hardhat") scaffoldHardhat(root);

  if (config.framework === "nextjs") scaffoldNextJS(root, config);
  if (config.framework === "vite") scaffoldVite(root, config);
  if (config.framework === "python") scaffoldPython(root, config);
}
