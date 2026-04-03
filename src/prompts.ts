import { select, input, password } from "@inquirer/prompts";
import type {
  SecretsConfig,
  SecretsMode,
  ChainFramework,
  AppFramework,
  LlmProvider,
  PQScheme,
  ShroudBillingMode,
  ShroudUpstreamProvider,
} from "./types.js";
import {
  availableNetworks,
  availableSchemesForNetwork,
  getBundlerHint,
  NETWORK_LABELS,
  SCHEME_LABELS,
  type PQNetworkKey,
  type PQSchemeKey,
} from "./pq-deployments.js";
import {
  isValidEthAddress,
  isValidPrivateKey,
  normalize0xHex,
} from "./actions/keys.js";
import { shroudProviderVaultKeyPath } from "./shroud-paths.js";

/** Inquirer flows for `scaffold-agent` CLI. Some exports are legacy / unused by the current wizard but kept for reuse or scripts — search for references before deleting. */

function llmVendorLabel(llm: Exclude<LlmProvider, "oneclaw">): string {
  switch (llm) {
    case "gemini":
      return "Google Gemini";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
  }
}

export async function promptProjectName(): Promise<string> {
  return input({
    message: "Project name:",
    default: "my-agent",
    validate: (val) => {
      if (!val.trim()) return "Project name is required";
      if (!/^[a-zA-Z0-9_-]+$/.test(val))
        return "Use letters, numbers, hyphens, or underscores only";
      return true;
    },
  });
}

export async function promptSecrets(): Promise<SecretsConfig> {
  const mode = await select<SecretsMode>({
    message: "Secrets management?",
    choices: [
      {
        value: "oneclaw" as const,
        name: "1Claw (1claw.xyz) [Recommended]",
        description: "HSM-backed vault — keys never stored on disk",
      },
      {
        value: "encrypted" as const,
        name: "Basic .env (Encrypted)",
        description: "AES-256-GCM encrypted .env file",
      },
      {
        value: "none" as const,
        name: "None",
        description: "Plain .env file (not recommended for production)",
      },
    ],
  });

  const config: SecretsConfig = { mode };

  if (mode === "oneclaw") {
    const addKeyNow = await select<"now" | "later">({
      message: "Add your ONECLAW_API_KEY now?",
      choices: [
        { value: "now" as const, name: "Enter key now" },
        { value: "later" as const, name: "Add later" },
      ],
    });

    if (addKeyNow === "now") {
      config.apiKey = await password({
        message: "ONECLAW_API_KEY (1ck_...):",
        mask: "*",
        validate: (val) => {
          if (!val.trim()) return "API key is required";
          return true;
        },
      });
    }
  }

  if (mode === "oneclaw" || mode === "encrypted") {
    config.envPassword = await password({
      message:
        "Set a password to encrypt secrets (API keys & private keys → .env.secrets.encrypted):",
      mask: "*",
      validate: (val) => {
        if (val.length < 6) return "Password must be at least 6 characters";
        return true;
      },
    });

    const confirmPw = await password({
      message: "Confirm password:",
      mask: "*",
    });

    if (config.envPassword !== confirmPw) {
      throw new Error("Passwords do not match. Please run again.");
    }
  }

  return config;
}

export type AgentIdentityMode = "standard" | "pq" | "none";

export async function promptIdentity(useOneClaw: boolean): Promise<AgentIdentityMode> {
  return select<AgentIdentityMode>({
    message: "Generate Agent Identity?",
    choices: [
      {
        value: "standard" as const,
        name: useOneClaw
          ? "Yes — standard ECDSA wallet (via 1Claw)"
          : "Yes — standard ECDSA wallet",
        description: "secp256k1 keypair; AGENT_ADDRESS + AGENT_PRIVATE_KEY",
      },
      {
        value: "pq" as const,
        name: "Yes — post-quantum smart account (ERC-4337 + ML-DSA-44)",
        description:
          "ZKNOX hybrid: ECDSA secp256k1 + ML-DSA-44. Both signatures required on every tx.",
      },
      { value: "none" as const, name: "No" },
    ],
  });
}

/** Optional [ampersend](https://docs.ampersend.ai/) SDK for x402 / A2A / MCP payment tooling. */
export async function promptInstallAmpersendSdk(): Promise<boolean> {
  return select<boolean>({
    message: "Install ampersend SDK?",
    choices: [
      {
        value: true,
        name: "Yes",
        description:
          "Add @ampersend_ai/ampersend-sdk + AMPERSEND.md (x402 payments, A2A, MCP)",
      },
      { value: false, name: "No" },
    ],
  });
}

/**
 * After `ampersend setup start` / approval / `setup finish` — smart account + session key.
 * Returns undefined if user defers.
 */
export async function promptAmpersendAgentCredentials(): Promise<
  { smartAccountAddress: string; sessionKeyPrivateKey: string } | undefined
> {
  const when = await select<"now" | "later">({
    message:
      "Add Ampersend smart account address + session key private key now?",
    choices: [
      {
        value: "now" as const,
        name: "Enter now (from ampersend setup finish)",
      },
      {
        value: "later" as const,
        name: "Add later to .env / vault",
      },
    ],
  });
  if (when !== "now") return undefined;

  const smartAccountAddress = await input({
    message: "Smart account address (AGENT_ADDRESS, 0x...):",
    validate: (val) => {
      if (!isValidEthAddress(val)) {
        return "Must be a 40-hex-character Ethereum address (0x…)";
      }
      return true;
    },
  });

  const sessionKeyPrivateKey = await password({
    message: "Session key private key (0x..., for AGENT_PRIVATE_KEY):",
    mask: "*",
    validate: (val) => {
      if (!isValidPrivateKey(val)) {
        return "Must be a 32-byte hex private key (0x + 64 hex chars)";
      }
      return true;
    },
  });

  return {
    smartAccountAddress: normalize0xHex(smartAccountAddress),
    sessionKeyPrivateKey: normalize0xHex(sessionKeyPrivateKey),
  };
}

export async function promptGenerateDeployerAccount(): Promise<boolean> {
  return select<boolean>({
    message: "Generate a Deployer Account?",
    choices: [
      { value: true, name: "Yes" },
      {
        value: false,
        name: "No (paste an existing key, or run `just generate` later)",
      },
    ],
  });
}

export async function promptExistingDeployerPrivateKey(): Promise<string> {
  return password({
    message: "Deployer private key (0x...) — required for 1Claw vault:",
    mask: "*",
    validate: (val) => {
      if (!isValidPrivateKey(val)) {
        return "Must be a 32-byte hex private key (0x + 64 hex chars)";
      }
      return true;
    },
  });
}

export async function promptDeployerWhenNotGenerated(): Promise<
  "enter_now" | "skip"
> {
  return select<"enter_now" | "skip">({
    message: "How do you want to set the deployer?",
    choices: [
      {
        value: "enter_now" as const,
        name: "Enter existing deployer private key now",
      },
      {
        value: "skip" as const,
        name: "Skip — run `just generate` before `just deploy`",
      },
    ],
  });
}

export async function promptOptionalExistingDeployerPrivateKey(): Promise<
  string | undefined
> {
  const pk = await password({
    message: "Deployer private key (0x...):",
    mask: "*",
    validate: (val) => {
      if (!isValidPrivateKey(val)) {
        return "Must be a 32-byte hex private key (0x + 64 hex chars)";
      }
      return true;
    },
  });
  return normalize0xHex(pk);
}

export async function promptLlmProvider(
  useOneClaw: boolean,
): Promise<LlmProvider> {
  return select<LlmProvider>({
    message: "Which LLM Provider?",
    choices: [
      {
        value: "oneclaw" as const,
        name: "1Claw (Shroud) [Recommended]",
        description: useOneClaw
          ? "1Claw Shroud LLM proxy — any upstream provider; billing or vault keys"
          : "Shroud at shroud.1claw.xyz — set agent credentials in .env",
      },
      {
        value: "gemini" as const,
        name: "Gemini",
        description: "Google Gemini (GOOGLE_GENERATIVE_AI_API_KEY)",
      },
      {
        value: "openai" as const,
        name: "OpenAI",
        description: "OpenAI GPT models (OPENAI_API_KEY)",
      },
      {
        value: "anthropic" as const,
        name: "Anthropic",
        description: "Claude models (ANTHROPIC_API_KEY)",
      },
    ],
  });
}

/** Gemini / OpenAI / Anthropic only. Skipped when LLM is 1Claw. */
export async function promptThirdPartyLlmApiKey(
  llm: LlmProvider,
  secretsMode: SecretsMode,
): Promise<string | undefined> {
  if (llm === "oneclaw") return undefined;

  const label = llmVendorLabel(llm);

  const addNow = await select<"now" | "later">({
    message:
      secretsMode === "oneclaw"
        ? `Add your ${label} API key now? (saved in 1Claw vault as llm-api-key)`
        : `Add your ${label} API key to .env now?`,
    choices: [
      { value: "now" as const, name: "Enter key now" },
      { value: "later" as const, name: "Add later" },
    ],
  });

  if (addNow !== "now") return undefined;

  return password({
    message: `${label} API key:`,
    mask: "*",
    validate: (val) => {
      if (!val.trim()) return "API key cannot be empty";
      return true;
    },
  });
}

/**
 * Shroud requires ONECLAW_AGENT_ID + ONECLAW_AGENT_API_KEY (agent_id:api_key).
 * When not using 1Claw vault, prompt to add them to .env.
 */
export async function promptShroudAgentCredentialsWhenNeeded(
  llm: LlmProvider,
  secretsMode: SecretsMode,
): Promise<{ agentId?: string; agentApiKey?: string }> {
  if (llm !== "oneclaw" || secretsMode === "oneclaw") return {};

  const addNow = await select<"now" | "later">({
    message:
      "Add Shroud agent credentials to .env now? (ONECLAW_AGENT_ID + ONECLAW_AGENT_API_KEY)",
    choices: [
      { value: "now" as const, name: "Enter now" },
      { value: "later" as const, name: "Add later" },
    ],
  });

  if (addNow !== "now") return {};

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const agentId = await input({
    message:
      "ONECLAW_AGENT_ID (1Claw agent UUID with dashes — NOT your AGENT_ADDRESS / 0x wallet):",
    validate: (val) => {
      const t = val.trim();
      if (!t) return "Required";
      if (/^0x[0-9a-fA-F]{40}$/.test(t) || /^0x[0-9a-fA-F]{64}$/.test(t)) {
        return "That looks like an Ethereum address — use the 1Claw agent UUID from the dashboard";
      }
      if (!uuidRe.test(t)) {
        return "Must be a UUID like 550e8400-e29b-41d4-a716-446655440000";
      }
      return true;
    },
  });

  const agentApiKey = await password({
    message: "ONECLAW_AGENT_API_KEY (ocv_...):",
    mask: "*",
    validate: (val) => (val.trim() ? true : "Required"),
  });

  return { agentId: agentId.trim(), agentApiKey };
}

/**
 * User must know whether LLM Token Billing is enabled on 1claw.xyz for this agent.
 * We cannot detect it via API here — this is an explicit choice.
 */
export async function promptShroudBillingMode(): Promise<ShroudBillingMode> {
  return select<ShroudBillingMode>({
    message: "How will Shroud pay the upstream LLM?",
    choices: [
      {
        value: "token_billing" as const,
        name: "1Claw LLM Token Billing",
        description:
          "Billing on 1claw.xyz — no provider API key in vault or .env",
      },
      {
        value: "provider_api_key" as const,
        name: "My own provider API key",
        description:
          "Store in 1Claw vault (api-keys/…) or .env — required if Token Billing is off",
      },
    ],
  });
}

/** After BYOK + 1Claw vault: prompt to save key at api-keys/{upstream}. */
export async function promptShroudVaultProviderApiKey(
  upstream: ShroudUpstreamProvider,
): Promise<string | undefined> {
  const path = shroudProviderVaultKeyPath(upstream);
  const addNow = await select<"now" | "later">({
    message: `Store your ${upstream} API key in 1Claw now? (vault path: ${path})`,
    choices: [
      { value: "now" as const, name: "Enter key now" },
      { value: "later" as const, name: "Add later in dashboard" },
    ],
  });
  if (addNow !== "now") return undefined;
  return password({
    message: `${upstream} API key (for Shroud upstream):`,
    mask: "*",
    validate: (val) => (val.trim() ? true : "API key cannot be empty"),
  });
}

/** BYOK without 1Claw vault: key goes in .env for X-Shroud-Api-Key. */
export async function promptShroudProviderApiKeyForEnv(): Promise<
  string | undefined
> {
  const addNow = await select<"now" | "later">({
    message:
      "Add provider API key to .env now? (sent as X-Shroud-Api-Key to Shroud)",
    choices: [
      { value: "now" as const, name: "Enter key now" },
      { value: "later" as const, name: "Add later" },
    ],
  });
  if (addNow !== "now") return undefined;
  return password({
    message: "Provider API key (SHROUD_PROVIDER_API_KEY):",
    mask: "*",
    validate: (val) => (val.trim() ? true : "API key cannot be empty"),
  });
}

/** Which upstream LLM Shroud forwards to — see https://docs.1claw.xyz/docs/guides/shroud */
export async function promptShroudUpstreamProvider(): Promise<ShroudUpstreamProvider> {
  return select<ShroudUpstreamProvider>({
    message: "Shroud upstream provider? (1Claw proxies to this LLM)",
    choices: [
      {
        value: "openai" as const,
        name: "OpenAI",
        description: "GPT models — BYOK vault path api-keys/openai or Token Billing",
      },
      {
        value: "google" as const,
        name: "Google (Gemini)",
        description: "Gemini — use X-Shroud-Provider: google or gemini",
      },
      {
        value: "gemini" as const,
        name: "Gemini (alias)",
        description: "Same as Google per 1Claw docs",
      },
      {
        value: "anthropic" as const,
        name: "Anthropic",
        description: "Claude — BYOK vault path api-keys/anthropic or Token Billing",
      },
      {
        value: "mistral" as const,
        name: "Mistral",
      },
      {
        value: "cohere" as const,
        name: "Cohere",
      },
      {
        value: "openrouter" as const,
        name: "OpenRouter",
        description: "Many models with one key",
      },
    ],
  });
}

export async function promptChain(): Promise<ChainFramework> {
  return select<ChainFramework>({
    message: "What chain framework?",
    choices: [
      { value: "foundry" as const, name: "Foundry [Recommended]" },
      { value: "hardhat" as const, name: "Hardhat" },
      { value: "none" as const, name: "None" },
    ],
  });
}

export async function promptPQAccount(): Promise<boolean> {
  return select<boolean>({
    message: "Enable post-quantum smart account (ERC-4337 + ML-DSA-44 hybrid)?",
    choices: [
      {
        value: false,
        name: "No",
      },
      {
        value: true,
        name: "Yes — ZKNOX ERC-4337 hybrid (ECDSA + ML-DSA-44)",
        description:
          "Requires a ZKNOX factory address and ERC-4337 bundler URL. Adds @noble/post-quantum + ethers to the app.",
      },
    ],
  });
}

export async function promptPQNetwork(): Promise<PQNetworkKey> {
  const networks = availableNetworks();
  return select<PQNetworkKey>({
    message: "Which network for the PQ smart account?",
    choices: networks.map((n) => ({
      value: n,
      name: NETWORK_LABELS[n],
    })),
  });
}

export async function promptPQScheme(network: PQNetworkKey): Promise<PQSchemeKey> {
  const schemes = availableSchemesForNetwork(network);
  return select<PQSchemeKey>({
    message: "Post-quantum signature scheme?",
    choices: schemes.map((s, i) => ({
      value: s,
      name: SCHEME_LABELS[s] + (i === 0 ? " [Recommended]" : ""),
    })),
  });
}

export async function promptBundlerUrl(network: PQNetworkKey): Promise<string> {
  const hint = getBundlerHint(network);
  return input({
    message: "ERC-4337 bundler URL:",
    default: hint,
    validate: (val) => (val.trim() ? true : "Bundler URL is required"),
  });
}

export async function promptFramework(): Promise<AppFramework> {
  return select<AppFramework>({
    message: "What framework?",
    choices: [
      { value: "nextjs" as const, name: "NextJS [Recommended]" },
      { value: "vite" as const, name: "Vite" },
      { value: "python" as const, name: "Python (Google A2A)" },
    ],
  });
}
