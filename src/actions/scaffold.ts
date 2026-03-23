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
  getFundDeployerScript,
  getGenerateDeployerScript,
  getList1clawIdsScript,
  getSecretsCryptoScript,
  getWithSecretsScript,
} from "./project-scripts.js";

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
      return 'google("gemini-2.0-flash")';
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
      return '"gemini-2.0-flash"';
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
      return "gemini-2.0-flash";
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

  const gitignoreLines = [
    "node_modules/",
    "dist/",
    "out/",
    "cache/",
    ".env",
    ".env.secrets.encrypted",
    ".env.local",
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

  const readme = `# ${config.projectName}

Onchain AI agent monorepo — scaffolded with \`scaffold-agent\`.

## Prerequisites

- [Node.js](https://nodejs.org) >= 18
- [just](https://just.systems/man/en/) command runner
${config.chain === "foundry" ? "- [Foundry](https://book.getfoundry.sh/getting-started/installation)\n- First `just compile` or `just deploy` runs `forge install` for **forge-std** into `packages/foundry/lib/` (gitignored).\n" : ""}${config.chain === "hardhat" ? "- [Hardhat](https://hardhat.org)\n" : ""}
## Quick Start

\`\`\`bash
npm install
${config.chain !== "none" ? "just chain        # start local blockchain (in a separate terminal)\njust fund         # 100 ETH each: local account #0 → DEPLOYER (+ AGENT if set)\njust deploy       # deploy contracts + generate ABI types\n" : ""}just start        # start the app
\`\`\`
${config.chain !== "none" ? "\n**Local deploy:** **\`just generate\`** tries to auto-fund when the RPC answers. The **scaffold CLI** runs funding **immediately** after creating the project — that only works if **\`just chain\`** (or another node) is **already** on \`http://127.0.0.1:8545\` (or \`RPC_URL\`). Otherwise run **\`just fund\`** after starting the chain, then **\`just deploy\`**. Set **\`SCAFFOLD_SKIP_AUTO_FUND=1\`** to skip. You will be prompted for your secrets password if you use 1Claw / encrypted mode.\n" : ""}${config.chain === "foundry" ? "\n**Foundry:** \`just deploy\` uses **\`DEPLOYER_PRIVATE_KEY\`** from **\`.env.secrets.encrypted\`** (password prompt). Run **\`just generate\`** if missing. **Plain** secrets mode keeps keys in \`.env\` only.\n" : ""}${config.framework === "nextjs" ? "\n**Next.js:** Chat at \`/\`. The **bug icon** in the header opens **\`/debug\`** — deployed addresses and ABI from \`deployedContracts.ts\` (read-only, [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2)–style Debug Contracts). **\`next.config.js\`** loads **repo-root \`.env\`** so \`ONECLAW_VAULT_ID\` and other root vars work when you run \`next dev\` from \`packages/nextjs\`.\n" : ""}

## Commands

| Command | Description |
|---|---|
${config.chain !== "none" ? "| \`just chain\` | Start local blockchain |\n| \`just fund\` | Fund \`DEPLOYER_ADDRESS\` + optional \`AGENT_ADDRESS\` (100 ETH each from account #0) |\n| \`just deploy\` | Deploy contracts & auto-generate ABI types |\n" : ""}${config.secrets.mode === "oneclaw" || config.llm === "oneclaw" ? "| \`just list-1claw\` | Print vault IDs + agent UUIDs from API (\`ONECLAW_API_KEY\`) |\n" : ""}| \`just start\` | Start the frontend / agent (may prompt for secrets password) |
| \`just generate\` | Generate a deployer wallet (password prompt if \`.env.secrets.encrypted\` exists) |

## Secrets

${
  config.secrets.mode === "oneclaw"
    ? `This project uses [1Claw](https://1claw.xyz) for secrets management.
The vault holds deployer and agent keys for app runtime. **Private keys and API keys** are stored in **\`.env.secrets.encrypted\`** (AES-256-GCM). Plain \`.env\` only has non-sensitive values (addresses, vault id, model names). **\`just deploy\`**, **\`just start\`**, etc. prompt for your password and load secrets into the process environment (nothing sensitive written to disk). CI: set **\`SCAFFOLD_ENV_PASSWORD\`**.

**Programmatic IDs:** With your user **\`ONECLAW_API_KEY\`**, run **\`just list-1claw\`** (or \`node scripts/list-1claw-ids.mjs\`) to call \`GET /v1/vaults\` and \`GET /v1/agents\` — you get **vault UUIDs** and **agent UUIDs** for \`ONECLAW_VAULT_ID\` / \`ONECLAW_AGENT_ID\`. Agent **API keys** are not listable; they are only returned when you **create** an agent (\`POST /v1/agents\`, as in scaffold setup) or **rotate** (\`@1claw/sdk\` \`client.agents.rotateKey(id)\`).`
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
      "deploy network='localhost':",
      "    node scripts/with-secrets.mjs -- node scripts/deploy-foundry.mjs",
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
      "deploy network='localhost':",
      "    #!/usr/bin/env bash",
      "    export HARDHAT_NETWORK={{network}}",
      "    node scripts/with-secrets.mjs -- node scripts/deploy-hardhat.mjs",
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
    );
  }

  lines.push(
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
  if (config.secrets.mode === "oneclaw" || config.llm === "oneclaw") {
    file(scripts, "list-1claw-ids.mjs", getList1clawIdsScript());
  }
  if (config.chain === "foundry") {
    file(scripts, "deploy-foundry.mjs", getDeployFoundryScript());
  }
  if (config.chain === "hardhat") {
    file(scripts, "deploy-hardhat.mjs", getDeployHardhatScript());
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

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  defaultNetwork: "localhost",
  namedAccounts: {
    deployer: { default: 0 },
  },
  networks: {
    localhost: { url: "http://127.0.0.1:8545" },
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
    @apply bg-background text-foreground;
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
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
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
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
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

function chatPageContent(
  projectName: string,
  options?: { debugLink?: boolean },
): string {
  const debugLink = options?.debugLink !== false;
  const linkImports = debugLink
    ? `import Link from "next/link";
`
    : "";
  const cnImport = debugLink
    ? `import { cn } from "@/lib/utils";
`
    : "";
  const lucideIcons = debugLink
    ? `import { SendHorizontal, Bot, User, Bug } from "lucide-react";`
    : `import { SendHorizontal, Bot, User } from "lucide-react";`;
  const headerBug = debugLink
    ? `
        <Link
          href="/debug"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          )}
          title="Debug contracts"
        >
          <Bug className="h-4 w-4" />
        </Link>`
    : "";

  return `"use client";

${linkImports}import { useChat } from "ai/react";
import { useEffect, useRef } from "react";
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
  }, [messages]);

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">${projectName}</h1>
          <p className="text-xs text-muted-foreground">Onchain AI Agent</p>
        </div>${headerBug}
      </header>

      {error && (
        <div className="px-6 py-2 text-sm text-destructive bg-destructive/10 border-b border-border space-y-1">
          <p className="whitespace-pre-wrap font-medium">
            {(() => {
              const raw = error.message;
              const i = raw.indexOf("{");
              if (i >= 0) {
                try {
                  const j = JSON.parse(raw.slice(i));
                  if (j && typeof j.error === "string") return j.error;
                } catch {
                  /* ignore */
                }
              }
              return raw;
            })()}
          </p>
          <p className="text-xs text-muted-foreground">
            Fix .env (or .env.secrets.encrypted), then restart{" "}
            <code className="rounded bg-muted px-1">next dev</code>.{" "}
            <code className="rounded bg-muted px-1">ONECLAW_AGENT_ID</code> is the
            1Claw agent UUID — not{" "}
            <code className="rounded bg-muted px-1">AGENT_ADDRESS</code>.
          </p>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
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
          <div className="flex gap-3 justify-start">
            <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="bg-muted rounded-2xl px-4 py-3">
              <div className="flex space-x-1.5">
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border p-4 flex gap-3">
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="Send a message..."
          className="flex-1"
          disabled={isLoading}
          autoFocus
        />
        <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
          <SendHorizontal className="h-4 w-4" />
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
import { ArrowLeft, Bug, Copy, Check } from "lucide-react";
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
        <div>
          <h1 className="text-sm font-semibold">Debug contracts</h1>
          <p className="text-xs text-muted-foreground">
            Deployed addresses &amp; ABI from{" "}
            <code className="text-xs bg-muted px-1 rounded">deployedContracts.ts</code>
          </p>
        </div>
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
          . This page is read-only; add wagmi/viem + wallet to call functions like the SE-2 Debug tab.
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
 * SHROUD_BILLING_MODE=token_billing → no X-Shroud-Api-Key (enable billing on 1claw.xyz).
 * SHROUD_BILLING_MODE=provider_api_key → vault://… from api-keys/{provider} or SHROUD_PROVIDER_API_KEY.
 */
function nextApiRouteOneClawShroud(
  upstream: ShroudUpstreamProvider,
  billingModeDefault: ShroudBillingMode,
): string {
  const modelFallback = shroudDefaultModel(upstream);
  return `import { convertToCoreMessages, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const shroudBaseURL =
  process.env.SHROUD_BASE_URL || "https://shroud.1claw.xyz/v1";

const shroudProvider =
  process.env.SHROUD_LLM_PROVIDER || "${upstream}";

const defaultModel =
  process.env.SHROUD_DEFAULT_MODEL || "${modelFallback}";

const billingMode =
  (process.env.SHROUD_BILLING_MODE as "token_billing" | "provider_api_key") ||
  "${billingModeDefault}";

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

  const headers: Record<string, string> = {
    "X-Shroud-Agent-Key": \`\${agentId}:\${agentKey}\`,
    "X-Shroud-Provider": shroudProvider,
  };

  if (billingMode === "provider_api_key") {
    const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
    const vaultPath = (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim();
    const inlineKey = (process.env.SHROUD_PROVIDER_API_KEY || "").trim();
    if (vaultId && vaultPath) {
      headers["X-Shroud-Api-Key"] = \`vault://\${vaultId}/\${vaultPath}\`;
    } else if (inlineKey) {
      headers["X-Shroud-Api-Key"] = inlineKey;
    }
  }

  const openai = createOpenAI({
    apiKey: agentKey || "shroud",
    baseURL: shroudBaseURL,
    headers,
  });

  const result = streamText({
    model: openai(defaultModel),
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

function nextApiRouteVaultThirdParty(llm: ThirdPartyLlm): string {
  return `import { convertToCoreMessages, streamText } from "ai";
${llmFactoryImport(llm)}
import { createClient } from "@1claw/sdk";

const client = createClient({
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
    model: provider(${llmDefaultModel(llm)}),
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
  return `import { convertToCoreMessages, streamText } from "ai";
${llmModelImport(llm)}

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

  const result = streamText({
    model: ${llmModelCall(llm)},
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
  dir(pkg, "app", "debug");
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
  };

  if (config.llm === "oneclaw" || config.secrets.mode === "oneclaw") {
    deps["@1claw/sdk"] = "latest";
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
          dev: "next dev",
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

// Load repo-root .env (ONECLAW_VAULT_ID, RPC_URL, …). Next only auto-loads env from packages/nextjs/ otherwise.
loadEnvConfig(path.join(__dirname, "..", ".."));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
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
  file(pkg, "components/ui/button.tsx", BUTTON_TSX);
  file(pkg, "components/ui/input.tsx", INPUT_TSX);

  file(
    pkg,
    "app/globals.css",
    SHADCN_CSS,
  );

  file(
    pkg,
    "app/layout.tsx",
    `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "${config.projectName}",
  description: "Onchain AI Agent",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
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
  return `import express from "express";
import { convertToCoreMessages, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import "dotenv/config";

const shroudBaseURL =
  process.env.SHROUD_BASE_URL || "https://shroud.1claw.xyz/v1";

const shroudProvider =
  process.env.SHROUD_LLM_PROVIDER || "${upstream}";

const defaultModel =
  process.env.SHROUD_DEFAULT_MODEL || "${modelFallback}";

const billingMode =
  (process.env.SHROUD_BILLING_MODE as "token_billing" | "provider_api_key") ||
  "${billingModeDefault}";

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

  const headers: Record<string, string> = {
    "X-Shroud-Agent-Key": \`\${agentId}:\${agentKey}\`,
    "X-Shroud-Provider": shroudProvider,
  };

  if (billingMode === "provider_api_key") {
    const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
    const vaultPath = (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim();
    const inlineKey = (process.env.SHROUD_PROVIDER_API_KEY || "").trim();
    if (vaultId && vaultPath) {
      headers["X-Shroud-Api-Key"] = \`vault://\${vaultId}/\${vaultPath}\`;
    } else if (inlineKey) {
      headers["X-Shroud-Api-Key"] = inlineKey;
    }
  }

  const openai = createOpenAI({
    apiKey: agentKey || "shroud",
    baseURL: shroudBaseURL,
    headers,
  });

  const result = streamText({
    model: openai(defaultModel),
    system:
      "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages: convertToCoreMessages(messages),
    onError({ error }) {
      console.error("[api/chat] streamText error:", error);
    },
  });

  result.pipeDataStreamToResponse(res);
});

app.listen(3001, () => console.log("API server on http://localhost:3001"));
`;
}

function viteApiRouteVaultThirdParty(llm: ThirdPartyLlm): string {
  return `import express from "express";
import { convertToCoreMessages, streamText } from "ai";
${llmFactoryImport(llm)}
import { createClient } from "@1claw/sdk";
import "dotenv/config";

const client = createClient({
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
    model: provider(${llmDefaultModel(llm)}),
    system:
      "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages: convertToCoreMessages(messages),
    onError({ error }) {
      console.error("[api/chat] streamText error:", error);
    },
  });

  result.pipeDataStreamToResponse(res);
});

app.listen(3001, () => console.log("API server on http://localhost:3001"));
`;
}

function viteApiRouteDirectThirdParty(llm: ThirdPartyLlm): string {
  const envKey = llmEnvKey(llm);
  return `import express from "express";
import { convertToCoreMessages, streamText } from "ai";
${llmModelImport(llm)}
import "dotenv/config";

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing messages" });
    return;
  }

  const result = streamText({
    model: ${llmModelCall(llm)},
    system:
      "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages: convertToCoreMessages(messages),
    onError({ error }) {
      console.error("[api/chat] streamText error:", error);
    },
  });

  result.pipeDataStreamToResponse(res);
});

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
    ai: "^4.0.0",
    [llmSdkPackage(config.llm)]: "^1.0.0",
    "class-variance-authority": "^0.7.0",
    clsx: "^2.1.0",
    "tailwind-merge": "^2.5.0",
    "lucide-react": "^0.460.0",
  };

  if (config.llm === "oneclaw" || config.secrets.mode === "oneclaw") {
    deps["@1claw/sdk"] = "latest";
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
          dev: 'concurrently "node server.mjs" "vite"',
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
        include: ["src"],
      },
      null,
      2,
    ) + "\n",
  );

  file(pkg, "tailwind.config.ts", TAILWIND_CONFIG);
  file(pkg, "postcss.config.mjs", POSTCSS_CONFIG);

  const viteComponentsJson = JSON.parse(COMPONENTS_JSON);
  viteComponentsJson.tailwind.css = "src/index.css";
  viteComponentsJson.aliases.components = "@/components";
  viteComponentsJson.aliases.utils = "@/lib/utils";
  file(pkg, "components.json", JSON.stringify(viteComponentsJson, null, 2));

  file(pkg, "src/lib/utils.ts", UTILS_TS);
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
    `import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
`,
  );

  // Vite chat page (no "use client" or Next-only /debug link)
  const viteChatPage = chatPageContent(config.projectName, {
    debugLink: false,
  }).replace('"use client";\n\n', "");
  const viteApp = viteChatPage
    .replace("export default function Home()", "export function App()")
    .replace(/@\/components/g, "@/components")
    .replace(/@\/lib/g, "@/lib");

  file(pkg, "src/App.tsx", viteApp);
  file(
    pkg,
    "server.mjs",
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
