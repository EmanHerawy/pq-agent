import type { ShroudUpstreamProvider } from "./types.js";

/**
 * Vault path for Shroud upstream API keys (BYOK).
 * Use with X-Shroud-Api-Key: vault://VAULT_ID/{path} when not using Token Billing.
 */
export function shroudProviderVaultKeyPath(
  upstream: ShroudUpstreamProvider,
): string {
  return `api-keys/${upstream}`;
}
