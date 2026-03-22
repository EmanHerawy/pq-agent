import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScaffoldConfig, LlmProvider, SecretsMode } from "../types.js";

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

// Direct-env helpers (used when secrets are NOT managed by 1Claw)
function llmModelImport(llm: LlmProvider): string {
  switch (llm) {
    case "openai":
      return 'import { openai } from "@ai-sdk/openai";';
    case "oneclaw":
      return 'import { createOpenAI } from "@ai-sdk/openai";\nimport { createClient } from "@1claw/sdk";';
    case "gemini":
      return 'import { google } from "@ai-sdk/google";';
    case "anthropic":
      return 'import { anthropic } from "@ai-sdk/anthropic";';
  }
}

function llmModelCall(llm: LlmProvider): string {
  switch (llm) {
    case "openai":
      return 'openai("gpt-4o")';
    case "oneclaw":
      return 'provider("gpt-4o")';
    case "gemini":
      return 'google("gemini-2.0-flash")';
    case "anthropic":
      return 'anthropic("claude-sonnet-4-20250514")';
  }
}

// Vault-backed helpers (used when 1Claw is the secrets manager for ANY LLM)
function llmFactoryImport(llm: LlmProvider): string {
  switch (llm) {
    case "oneclaw":
    case "openai":
      return 'import { createOpenAI } from "@ai-sdk/openai";';
    case "gemini":
      return 'import { createGoogleGenerativeAI } from "@ai-sdk/google";';
    case "anthropic":
      return 'import { createAnthropic } from "@ai-sdk/anthropic";';
  }
}

function llmFactoryCall(llm: LlmProvider): string {
  switch (llm) {
    case "oneclaw":
    case "openai":
      return "createOpenAI({ apiKey: key })";
    case "gemini":
      return "createGoogleGenerativeAI({ apiKey: key })";
    case "anthropic":
      return "createAnthropic({ apiKey: key })";
  }
}

function llmDefaultModel(llm: LlmProvider): string {
  switch (llm) {
    case "oneclaw":
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
  file(root, ".gitignore", gitignoreLines.join("\n") + "\n");

  const readme = `# ${config.projectName}

Onchain AI agent monorepo — scaffolded with \`scaffold-agent\`.

## Prerequisites

- [Node.js](https://nodejs.org) >= 18
- [just](https://just.systems/man/en/) command runner
${config.chain === "foundry" ? "- [Foundry](https://book.getfoundry.sh/getting-started/installation)\n" : ""}${config.chain === "hardhat" ? "- [Hardhat](https://hardhat.org)\n" : ""}
## Quick Start

\`\`\`bash
npm install
${config.chain !== "none" ? "just chain        # start local blockchain (in a separate terminal)\njust deploy       # deploy contracts + generate ABI types\n" : ""}just start        # start the app
\`\`\`

## Commands

| Command | Description |
|---|---|
${config.chain !== "none" ? "| \`just chain\` | Start local blockchain |\n| \`just deploy\` | Deploy contracts & auto-generate ABI types |\n" : ""}| \`just start\` | Start the frontend / agent |
| \`just generate\` | Generate a deployer wallet (if none exists) |

## Secrets

${
  config.secrets.mode === "oneclaw"
    ? `This project uses [1Claw](https://1claw.xyz) for secrets management.
Private keys are stored in your 1Claw vault — they are **not** on disk.`
    : config.secrets.mode === "encrypted"
      ? "Your \\`.env\\` is encrypted with AES-256-GCM. Decrypt with the password you set during setup."
      : "Secrets are stored in a plain \\`.env\\` file. **Do not commit it.**"
}
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
      "# Compile contracts",
      "compile:",
      "    cd packages/foundry && forge build",
      "",
      "# Deploy contracts and generate ABI types",
      "deploy network='localhost':",
      "    #!/usr/bin/env bash",
      "    set -euo pipefail",
      "    cd packages/foundry",
      "    forge build",
      '    forge script script/Deploy.s.sol:Deploy --broadcast --rpc-url http://127.0.0.1:8545',
      "    cd ../..",
      "    node scripts/generate-abi-types.mjs",
      "",
      "# Run contract tests",
      "test:",
      "    cd packages/foundry && forge test",
      "",
    );
  } else if (config.chain === "hardhat") {
    lines.push(
      "# Start local Hardhat chain",
      "chain:",
      "    cd packages/hardhat && npx hardhat node",
      "",
      "# Compile contracts",
      "compile:",
      "    cd packages/hardhat && npx hardhat compile",
      "",
      "# Deploy contracts and generate ABI types",
      "deploy network='localhost':",
      "    #!/usr/bin/env bash",
      "    set -euo pipefail",
      "    cd packages/hardhat",
      "    npx hardhat deploy --network {{network}}",
      "    cd ../..",
      "    node scripts/generate-abi-types.mjs",
      "",
      "# Run contract tests",
      "test:",
      "    cd packages/hardhat && npx hardhat test",
      "",
    );
  }

  if (config.framework === "nextjs") {
    lines.push(
      "# Start NextJS frontend",
      "start:",
      "    cd packages/nextjs && npm run dev",
      "",
    );
  } else if (config.framework === "vite") {
    lines.push(
      "# Start Vite frontend + API server",
      "start:",
      "    cd packages/vite && npm run dev",
      "",
    );
  } else if (config.framework === "python") {
    lines.push(
      "# Start Python agent",
      "start:",
      "    cd packages/python && python -m agent",
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

  // ── generate-deployer.mjs ───────────────────────────────────────────────
  const deployerScript = `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ENV_PATH = join(process.cwd(), ".env");

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

const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
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
  // qrcode-terminal not available
}
`;

  file(scripts, "generate-deployer.mjs", deployerScript);
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
        require(msg.sender == owner || msg.sender == agent, "unauthorized");
        _;
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

import "forge-std/Script.sol";
import "../src/AgentWallet.sol";

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

import "forge-std/Test.sol";
import "../src/AgentWallet.sol";

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
        require(msg.sender == owner || msg.sender == agent, "unauthorized");
        _;
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

function chatPageContent(projectName: string): string {
  return `"use client";

import { useChat } from "ai/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SendHorizontal, Bot, User } from "lucide-react";

export default function Home() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();
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
        <div>
          <h1 className="text-sm font-semibold">${projectName}</h1>
          <p className="text-xs text-muted-foreground">Onchain AI Agent</p>
        </div>
      </header>

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

function nextApiRoute(llm: LlmProvider, secretsMode: SecretsMode): string {
  if (useVaultForSecrets(secretsMode)) {
    return `import { streamText } from "ai";
${llmFactoryImport(llm)}
import { createClient } from "@1claw/sdk";

const client = createClient({
  baseUrl: "https://api.1claw.xyz",
  apiKey: process.env.ONECLAW_API_KEY!,
});

let cachedKey: string | null = null;

async function getLlmKey() {
  if (!cachedKey) {
    const { data } = await client.secrets.get(
      process.env.ONECLAW_VAULT_ID!,
      "llm-api-key",
    );
    cachedKey = data.value;
  }
  return cachedKey;
}

export async function POST(req: Request) {
  const { messages } = await req.json();
  const key = await getLlmKey();
  const provider = ${llmFactoryCall(llm)};

  const result = streamText({
    model: provider(${llmDefaultModel(llm)}),
    system: "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages,
  });

  return result.toDataStreamResponse();
}
`;
  }

  return `import { streamText } from "ai";
${llmModelImport(llm)}

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: ${llmModelCall(llm)},
    system: "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages,
  });

  return result.toDataStreamResponse();
}
`;
}

// ── NextJS ──────────────────────────────────────────────────────────────────

function scaffoldNextJS(root: string, config: ScaffoldConfig) {
  const pkg = dir(root, "packages", "nextjs");
  dir(pkg, "app", "api", "chat");
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
    `/** @type {import('next').NextConfig} */
const nextConfig = {};
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

  file(pkg, "app/page.tsx", chatPageContent(config.projectName));
  file(pkg, "app/api/chat/route.ts", nextApiRoute(config.llm, config.secrets.mode));

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

function viteApiRoute(llm: LlmProvider, secretsMode: SecretsMode): string {
  if (useVaultForSecrets(secretsMode)) {
    return `import express from "express";
import { streamText } from "ai";
${llmFactoryImport(llm)}
import { createClient } from "@1claw/sdk";
import "dotenv/config";

const client = createClient({
  baseUrl: "https://api.1claw.xyz",
  apiKey: process.env.ONECLAW_API_KEY,
});

let cachedKey = null;

async function getLlmKey() {
  if (!cachedKey) {
    const { data } = await client.secrets.get(process.env.ONECLAW_VAULT_ID, "llm-api-key");
    cachedKey = data.value;
  }
  return cachedKey;
}

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  const key = await getLlmKey();
  const provider = ${llmFactoryCall(llm)};

  const result = streamText({
    model: provider(${llmDefaultModel(llm)}),
    system: "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages,
  });

  result.pipeDataStreamToResponse(res);
});

app.listen(3001, () => console.log("API server on http://localhost:3001"));
`;
  }

  const envKey = llmEnvKey(llm);
  return `import express from "express";
import { streamText } from "ai";
${llmModelImport(llm)}
import "dotenv/config";

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  const result = streamText({
    model: ${llmModelCall(llm)},
    system: "You are an onchain AI agent assistant. Help users interact with smart contracts and manage their wallets.",
    messages,
  });

  result.pipeDataStreamToResponse(res);
});

app.listen(3001, () => console.log("API server on http://localhost:3001${envKey ? ` (needs ${envKey})` : ""}"));
`;
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

  // Vite chat page (no "use client" directive, same UI)
  const viteChatPage = chatPageContent(config.projectName).replace('"use client";\n\n', "");
  const viteApp = viteChatPage
    .replace("export default function Home()", "export function App()")
    .replace(/@\/components/g, "@/components")
    .replace(/@\/lib/g, "@/lib");

  file(pkg, "src/App.tsx", viteApp);
  file(pkg, "server.mjs", viteApiRoute(config.llm, config.secrets.mode));

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
