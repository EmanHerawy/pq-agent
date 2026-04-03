export type SecretsMode = "oneclaw" | "encrypted" | "none";
export type ChainFramework = "foundry" | "hardhat" | "none";
export type AppFramework = "nextjs" | "vite" | "python";
export type LlmProvider = "oneclaw" | "gemini" | "openai" | "anthropic";

/** Upstream LLM Shroud proxies to — see https://docs.1claw.xyz/docs/guides/shroud */
export type ShroudUpstreamProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "gemini"
  | "mistral"
  | "cohere"
  | "openrouter";

/** How Shroud pays upstream LLM providers — user-declared during setup */
export type ShroudBillingMode = "token_billing" | "provider_api_key";

export interface SecretsConfig {
  mode: SecretsMode;
  apiKey?: string;
  envPassword?: string;
}

export interface WalletInfo {
  address: string;
  privateKey: string;
}

/** One generated swarm wallet (index 0 is primary AGENT_ADDRESS / AGENT_PRIVATE_KEY). */
export interface SwarmAgentDef {
  id: string;
  address: string;
  privateKey: string;
  /** Optional tag from `agent.json` `agents` map (e.g. preset label). */
  preset?: string;
}

export type PQScheme = "mldsa" | "falcon" | "mldsaeth" | "ethfalcon";

export interface PQAccountConfig {
  scheme: PQScheme;
  /** Network key from PQ_DEPLOYMENTS (e.g. "sepolia") */
  network: string;
  /** Chain ID of the selected network */
  chainId: number;
  /** 32-byte hex seed (0x + 64 hex) — secret, stored in POST_QUANTUM_SEED */
  postQuantumSeed: string;
  /** ZKNOX factory contract address (auto-resolved from deployments) */
  factoryAddress: string;
  /** ERC-4337 bundler URL (e.g. Pimlico) */
  bundlerUrl: string;
}

export interface IdentityConfig {
  generateAgent: boolean;
  agentAddress?: string;
  agentPrivateKey?: string;
  /** When length > 1, extras beyond [0] live in SWARM_AGENT_KEYS_JSON. */
  swarmAgents?: SwarmAgentDef[];
}

export interface DeployerConfig {
  address: string;
  privateKey: string;
}

export interface OneClawResult {
  vaultId: string;
  agentInfo?: { id: string; apiKey: string };
}

export interface ScaffoldConfig {
  projectName: string;
  secrets: SecretsConfig;
  identity: IdentityConfig;
  /** Add @ampersend_ai/ampersend-sdk (Next/Vite) + AMPERSEND.md; see https://docs.ampersend.ai */
  installAmpersendSdk: boolean;
  deployer: DeployerConfig;
  chain: ChainFramework;
  framework: AppFramework;
  llm: LlmProvider;
  /** Set when llm === "oneclaw" — Shroud X-Shroud-Provider header */
  shroudUpstream?: ShroudUpstreamProvider;
  /** Set when llm === "oneclaw" — Token Billing vs own key in vault / .env */
  shroudBillingMode?: ShroudBillingMode;
  oneClawVaultId?: string;
  /** Opaque blob from `agent.json` `extra` (passed to templates / future use). */
  agentConfigExtra?: unknown;
  /** ERC-4337 smart account with post-quantum hybrid signatures (ML-DSA-44 + ECDSA). */
  pqAccount?: PQAccountConfig;
}
