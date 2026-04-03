import { parseArgs } from "node:util";
import type {
  AppFramework,
  ChainFramework,
  LlmProvider,
  SecretsMode,
  ShroudBillingMode,
  ShroudUpstreamProvider,
} from "./types.js";

const SECRETS: readonly SecretsMode[] = ["oneclaw", "encrypted", "none"];
const LLM: readonly LlmProvider[] = ["oneclaw", "gemini", "openai", "anthropic"];
const SHROUD_UPSTREAM: readonly ShroudUpstreamProvider[] = [
  "openai",
  "anthropic",
  "google",
  "gemini",
  "mistral",
  "cohere",
  "openrouter",
];
const SHROUD_BILLING: readonly ShroudBillingMode[] = [
  "token_billing",
  "provider_api_key",
];
const CHAIN: readonly ChainFramework[] = ["foundry", "hardhat", "none"];
const FRAMEWORK: readonly AppFramework[] = ["nextjs", "vite", "python"];

/** Defaults when `--non-interactive` omits optional choices */
export const NON_INTERACTIVE_DEFAULTS = {
  secrets: "oneclaw" as const,
  generateAgent: true,
  installAmpersendSdk: false,
  llm: "oneclaw" as const,
  shroudUpstream: "openai" as const,
  shroudBilling: "token_billing" as const,
  chain: "foundry" as const,
  framework: "nextjs" as const,
};

export type CliFlagValues = {
  help?: boolean;
  version?: boolean;
  "non-interactive"?: boolean;
  project?: string;
  secrets?: string;
  "oneclaw-api-key"?: string;
  "defer-oneclaw-api-key"?: boolean;
  "env-password"?: string;
  /** `generate` | `none` */
  agent?: string;
  /** `yes` | `no` */
  ampersend?: string;
  llm?: string;
  "shroud-upstream"?: string;
  "shroud-billing"?: string;
  "shroud-provider-api-key"?: string;
  "llm-api-key"?: string;
  "oneclaw-agent-id"?: string;
  "oneclaw-agent-api-key"?: string;
  chain?: string;
  framework?: string;
  "skip-npm-install"?: boolean;
  "skip-auto-fund"?: boolean;
  /** Total agent wallets when generating (1–64). */
  swarm?: string;
  /** Load defaults from agent.json (merged; CLI overrides). */
  "from-config"?: string;
  /** Print merged agent.json to stdout (no scaffold; secrets redacted). */
  "dump-config"?: boolean;
  /** Write --dump-config output to this file instead of stdout. */
  "dump-config-out"?: string;
  /** Enable ERC-4337 post-quantum smart account (ML-DSA-44 hybrid). */
  "pq-account"?: boolean;
  /** Network for PQ account: sepolia | arbitrumSepolia | baseSepolia. */
  "pq-network"?: string;
  /** Post-quantum scheme: mldsa | falcon | mldsaeth | ethfalcon (default: mldsa). */
  "pq-scheme"?: string;
  /** Override ZKNOX factory address (auto-resolved from deployments if omitted). */
  "pq-factory-address"?: string;
  /** ERC-4337 bundler URL (e.g. Pimlico). */
  "bundler-url"?: string;
};

export type ParsedScaffoldArgv = {
  values: CliFlagValues;
  positionals: string[];
};

export function printNonInteractiveExample(): void {
  console.log(`
Example (non-interactive, minimal — 1Claw vault deferred, token billing, Foundry + Next):

  npx scaffold-agent@latest -y my-agent \\
    --env-password 'your-secure-password' \\
    --defer-oneclaw-api-key

Example (BYOK OpenAI via Shroud, keys in .env):

  npx scaffold-agent@latest -y my-agent \\
    --secrets none \\
    --llm oneclaw \\
    --shroud-upstream openai \\
    --shroud-billing provider_api_key \\
    --shroud-provider-api-key sk-... \\
    --oneclaw-agent-id '<uuid>' \\
    --oneclaw-agent-api-key ocv_...
`);
}

function parseEnum<T extends string>(
  label: string,
  raw: string | undefined,
  allowed: readonly T[],
): T {
  if (raw === undefined || raw === "") {
    throw new Error(`CLI: ${label} is required (one of: ${allowed.join(", ")})`);
  }
  const n = raw.trim().toLowerCase().replace(/-/g, "_");
  if ((allowed as readonly string[]).includes(n)) return n as T;
  throw new Error(
    `CLI: invalid ${label} "${raw}". Use one of: ${allowed.join(", ")}`,
  );
}

export function parseScaffoldArgv(argv: string[]): ParsedScaffoldArgv {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "V" },
      "non-interactive": { type: "boolean", short: "y" },
      project: { type: "string" },
      secrets: { type: "string" },
      "oneclaw-api-key": { type: "string" },
      "defer-oneclaw-api-key": { type: "boolean" },
      "env-password": { type: "string" },
      agent: { type: "string" },
      ampersend: { type: "string" },
      llm: { type: "string" },
      "shroud-upstream": { type: "string" },
      "shroud-billing": { type: "string" },
      "shroud-provider-api-key": { type: "string" },
      "llm-api-key": { type: "string" },
      "oneclaw-agent-id": { type: "string" },
      "oneclaw-agent-api-key": { type: "string" },
      chain: { type: "string" },
      framework: { type: "string" },
      "skip-npm-install": { type: "boolean" },
      "skip-auto-fund": { type: "boolean" },
      swarm: { type: "string" },
      "from-config": { type: "string" },
      "dump-config": { type: "boolean" },
      "dump-config-out": { type: "string" },
      "pq-account": { type: "boolean" },
      "pq-network": { type: "string" },
      "pq-scheme": { type: "string" },
      "pq-factory-address": { type: "string" },
      "bundler-url": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });

  return { values: values as CliFlagValues, positionals };
}

export function validateProjectName(t: string): string {
  const name = t.trim();
  if (!name) throw new Error("CLI: project name cannot be empty");
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `CLI: invalid project name "${name}". Use letters, numbers, hyphens, or underscores only.`,
    );
  }
  return name;
}

export function resolveProjectName(
  positionals: string[],
  values: CliFlagValues,
  nonInteractive: boolean,
): string {
  const fromPos = positionals[0]?.trim();
  const fromFlag = values.project?.trim();
  if (fromPos && fromFlag && fromPos !== fromFlag) {
    throw new Error(
      "CLI: project name given both as argument and --project; use only one.",
    );
  }
  const raw = fromPos || fromFlag;
  if (!raw) {
    if (nonInteractive) {
      throw new Error(
        "CLI: project name required (positional) or --project <name> when using --non-interactive",
      );
    }
    throw new Error("CLI: internal — project name missing");
  }
  if (positionals.length > 1) {
    throw new Error(
      "CLI: too many positional arguments. Pass a single project name, or use --project.",
    );
  }
  return validateProjectName(raw);
}

export function parseAgentFlag(raw: string | undefined, nonInteractive: boolean): boolean {
  if (raw === undefined || raw === "") {
    if (nonInteractive) return NON_INTERACTIVE_DEFAULTS.generateAgent;
    throw new Error("CLI: internal — agent");
  }
  const x = raw.trim().toLowerCase();
  if (x === "generate" || x === "yes" || x === "true" || x === "1") return true;
  if (x === "none" || x === "no" || x === "false" || x === "0" || x === "skip") return false;
  throw new Error(
    `CLI: invalid --agent "${raw}". Use generate | none (or yes | no).`,
  );
}

export function parseAmpersendFlag(
  raw: string | undefined,
  nonInteractive: boolean,
): boolean {
  if (raw === undefined || raw === "") {
    if (nonInteractive) return NON_INTERACTIVE_DEFAULTS.installAmpersendSdk;
    throw new Error("CLI: internal — ampersend");
  }
  const x = raw.trim().toLowerCase();
  if (x === "yes" || x === "true" || x === "1") return true;
  if (x === "no" || x === "false" || x === "0") return false;
  throw new Error(`CLI: invalid --ampersend "${raw}". Use yes | no.`);
}

export function parseSecretsMode(
  raw: string | undefined,
  nonInteractive: boolean,
): SecretsMode {
  if (raw === undefined || raw === "") {
    if (nonInteractive) return NON_INTERACTIVE_DEFAULTS.secrets;
    throw new Error("CLI: internal — secrets");
  }
  return parseEnum("secrets", raw, SECRETS);
}

export function parseLlm(
  raw: string | undefined,
  nonInteractive: boolean,
): LlmProvider {
  if (raw === undefined || raw === "") {
    if (nonInteractive) return NON_INTERACTIVE_DEFAULTS.llm;
    throw new Error("CLI: internal — llm");
  }
  return parseEnum("llm", raw, LLM);
}

export function parseShroudUpstream(
  raw: string | undefined,
  nonInteractive: boolean,
): ShroudUpstreamProvider {
  if (raw === undefined || raw === "") {
    if (nonInteractive) return NON_INTERACTIVE_DEFAULTS.shroudUpstream;
    throw new Error("CLI: internal — shroud-upstream");
  }
  return parseEnum("shroud-upstream", raw, SHROUD_UPSTREAM);
}

export function parseShroudBilling(
  raw: string | undefined,
  nonInteractive: boolean,
): ShroudBillingMode {
  if (raw === undefined || raw === "") {
    if (nonInteractive) return NON_INTERACTIVE_DEFAULTS.shroudBilling;
    throw new Error("CLI: internal — shroud-billing");
  }
  return parseEnum("shroud-billing", raw, SHROUD_BILLING);
}

export function parseChain(
  raw: string | undefined,
  nonInteractive: boolean,
): ChainFramework {
  if (raw === undefined || raw === "") {
    if (nonInteractive) return NON_INTERACTIVE_DEFAULTS.chain;
    throw new Error("CLI: internal — chain");
  }
  return parseEnum("chain", raw, CHAIN);
}

export function parseFramework(
  raw: string | undefined,
  nonInteractive: boolean,
): AppFramework {
  if (raw === undefined || raw === "") {
    if (nonInteractive) return NON_INTERACTIVE_DEFAULTS.framework;
    throw new Error("CLI: internal — framework");
  }
  return parseEnum("framework", raw, FRAMEWORK);
}
