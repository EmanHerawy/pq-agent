export type SecretsMode = "oneclaw" | "encrypted" | "none";
export type ChainFramework = "foundry" | "hardhat" | "none";
export type AppFramework = "nextjs" | "vite" | "python";
export type LlmProvider = "oneclaw" | "gemini" | "openai" | "anthropic";

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
  deployer: DeployerConfig;
  chain: ChainFramework;
  framework: AppFramework;
  llm: LlmProvider;
  oneClawVaultId?: string;
}
