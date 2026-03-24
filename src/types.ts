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

export interface IdentityConfig {
  generateAgent: boolean;
  agentAddress?: string;
  agentPrivateKey?: string;
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
}
