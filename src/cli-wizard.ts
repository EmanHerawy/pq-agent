import { select, password } from "@inquirer/prompts";
import type { PQScheme, SecretsConfig } from "./types.js";
import {
  promptSecrets,
  promptIdentity,
  promptInstallAmpersendSdk,
  promptLlmProvider,
  promptThirdPartyLlmApiKey,
  promptShroudUpstreamProvider,
  promptShroudBillingMode,
  promptShroudVaultProviderApiKey,
  promptShroudProviderApiKeyForEnv,
  promptShroudAgentCredentialsWhenNeeded,
  promptChain,
  promptFramework,
  promptProjectName,
  promptPQNetwork,
  promptPQScheme,
  promptBundlerUrl,
  promptGenerateDeployerAccount,
  promptDeployerWhenNotGenerated,
  promptExistingDeployerPrivateKey,
} from "./prompts.js";
import type { AgentIdentityMode } from "./prompts.js";
import {
  availableSchemesForNetwork,
  getChainId,
  getFactoryAddress,
  getBundlerHint,
  type PQNetworkKey,
  type PQSchemeKey,
} from "./pq-deployments.js";
import { shroudProviderVaultKeyPath } from "./shroud-paths.js";
import type {
  AppFramework,
  ChainFramework,
  LlmProvider,
  ShroudBillingMode,
  ShroudUpstreamProvider,
} from "./types.js";
import type { CliFlagValues } from "./cli-argv.js";
import {
  NON_INTERACTIVE_DEFAULTS,
  parseAgentFlag,
  parseAmpersendFlag,
  parseChain,
  parseFramework,
  parseLlm,
  parseSecretsMode,
  parseShroudBilling,
  parseShroudUpstream,
  resolveProjectName,
} from "./cli-argv.js";
import {
  type AgentFileExtras,
  type SwarmPlanEntry,
  resolveSwarmPlan,
} from "./agent-project-config.js";

export type GatheredWizard = {
  projectName: string;
  secrets: SecretsConfig;
  generateAgent: boolean;
  installAmpersendSdk: boolean;
  llm: LlmProvider;
  shroudUpstream: ShroudUpstreamProvider | undefined;
  shroudBillingMode: ShroudBillingMode | undefined;
  shroudProviderKeyForVault: string | undefined;
  shroudProviderKeyForEnv: string | undefined;
  thirdPartyLlmApiKey: string | undefined;
  shroudAgentManual: { agentId?: string; agentApiKey?: string };
  chain: ChainFramework;
  framework: AppFramework;
  skipNpmInstall: boolean;
  skipAutoFund: boolean;
  /** Wallets to generate when generateAgent (ids + optional presets). */
  swarmEntries: SwarmPlanEntry[];
  agentFileExtras: AgentFileExtras | null;
  pqAccount: boolean;
  pqNetwork: string | undefined;
  pqChainId: number | undefined;
  pqScheme: PQScheme | undefined;
  pqFactoryAddress: string | undefined;
  bundlerUrl: string | undefined;
  /** Undefined = generate a new wallet. Set = reuse this private key as deployer. */
  deployerPrivateKey: string | undefined;
};

function niErr(msg: string): never {
  throw new Error(`--non-interactive: ${msg}`);
}

async function secretsFromFlagsInteractive(v: CliFlagValues): Promise<SecretsConfig> {
  if (v.secrets === undefined) return promptSecrets();

  const mode = parseSecretsMode(v.secrets, false);
  const config: SecretsConfig = { mode };

  if (mode === "oneclaw") {
    if (v["defer-oneclaw-api-key"]) {
      /* defer */
    } else if (v["oneclaw-api-key"] !== undefined) {
      config.apiKey = v["oneclaw-api-key"];
    } else {
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
          validate: (val) => (val.trim() ? true : "API key is required"),
        });
      }
    }
  }

  if (mode === "oneclaw" || mode === "encrypted") {
    if (v["env-password"] !== undefined) {
      if (v["env-password"].length < 6) {
        throw new Error("CLI: --env-password must be at least 6 characters");
      }
      config.envPassword = v["env-password"];
    } else {
      config.envPassword = await password({
        message:
          "Set a password to encrypt secrets (API keys & private keys → .env.secrets.encrypted):",
        mask: "*",
        validate: (val) =>
          val.length < 6 ? "Password must be at least 6 characters" : true,
      });
      const confirmPw = await password({
        message: "Confirm password:",
        mask: "*",
      });
      if (config.envPassword !== confirmPw) {
        throw new Error("Passwords do not match. Please run again.");
      }
    }
  }

  return config;
}

function secretsNonInteractive(v: CliFlagValues): SecretsConfig {
  const mode = parseSecretsMode(v.secrets, true);
  const config: SecretsConfig = { mode };

  if (mode === "oneclaw" || mode === "encrypted") {
    const pw = v["env-password"];
    if (pw === undefined || pw === "") {
      niErr(
        "set --env-password (min 6 characters) when --secrets is oneclaw or encrypted",
      );
    }
    if (pw.length < 6) niErr("--env-password must be at least 6 characters");
    config.envPassword = pw;
  }

  if (mode === "oneclaw") {
    if (v["defer-oneclaw-api-key"] && v["oneclaw-api-key"] !== undefined) {
      niErr("use only one of --oneclaw-api-key or --defer-oneclaw-api-key");
    }
    if (v["oneclaw-api-key"] !== undefined) {
      config.apiKey = v["oneclaw-api-key"];
    }
  }

  return config;
}

export async function gatherWizardInputs(
  v: CliFlagValues,
  positionals: string[],
  nonInteractive: boolean,
  fileExtras?: AgentFileExtras | null,
): Promise<GatheredWizard> {
  const skipNpm = Boolean(v["skip-npm-install"]);
  const skipAutoFund = Boolean(v["skip-auto-fund"]);

  let projectName: string;
  if (nonInteractive) {
    projectName = resolveProjectName(positionals, v, true);
  } else if (positionals[0]?.trim() || v.project?.trim()) {
    projectName = resolveProjectName(positionals, v, false);
  } else {
    projectName = await promptProjectName();
  }

  const secrets = nonInteractive
    ? secretsNonInteractive(v)
    : await secretsFromFlagsInteractive(v);

  let generateAgent: boolean;
  // identityFromPrompt tracks whether the interactive promptIdentity already
  // captured the PQ choice so we can skip the separate promptPQAccount later.
  let identityFromPrompt: AgentIdentityMode | undefined;

  if (nonInteractive) {
    generateAgent = parseAgentFlag(v.agent, true);
  } else if (v.agent !== undefined && v.agent !== "") {
    generateAgent = parseAgentFlag(v.agent, false);
  } else {
    identityFromPrompt = await promptIdentity(secrets.mode === "oneclaw");
    generateAgent = identityFromPrompt !== "none";
  }

  const extras = fileExtras ?? null;
  const presetMap = extras?.agentPresets ?? {};
  if (!generateAgent) {
    const badSwarm =
      (v.swarm !== undefined && v.swarm !== "") ||
      (extras?.swarmFromFile !== undefined && extras.swarmFromFile > 1) ||
      Object.keys(presetMap).length > 0;
    if (badSwarm) {
      const msg =
        "Swarm / named agents require an Ethereum agent wallet — use --agent generate (or omit swarm / agents from config).";
      if (nonInteractive) niErr(msg);
      throw new Error(msg);
    }
  }

  const { entries: swarmEntries } = resolveSwarmPlan({
    generateAgent,
    swarmFlag: v.swarm,
    swarmFromFile: extras?.swarmFromFile,
    agentPresets: presetMap,
  });

  let installAmpersendSdk: boolean;
  if (nonInteractive) {
    installAmpersendSdk = parseAmpersendFlag(v.ampersend, true);
  } else if (v.ampersend !== undefined && v.ampersend !== "") {
    installAmpersendSdk = parseAmpersendFlag(v.ampersend, false);
  } else {
    installAmpersendSdk = await promptInstallAmpersendSdk();
  }

  let llm: LlmProvider;
  if (nonInteractive) {
    llm = parseLlm(v.llm, true);
  } else if (v.llm !== undefined && v.llm !== "") {
    llm = parseLlm(v.llm, false);
  } else {
    llm = await promptLlmProvider(secrets.mode === "oneclaw");
  }

  let shroudUpstream: ShroudUpstreamProvider | undefined;
  let shroudBillingMode: ShroudBillingMode | undefined;
  let shroudProviderKeyForVault: string | undefined;
  let shroudProviderKeyForEnv: string | undefined;

  if (llm === "oneclaw") {
    if (nonInteractive) {
      shroudUpstream = parseShroudUpstream(v["shroud-upstream"], true);
      shroudBillingMode = parseShroudBilling(v["shroud-billing"], true);
      if (shroudBillingMode === "provider_api_key") {
        const key = v["shroud-provider-api-key"];
        if (key !== undefined && key !== "") {
          if (secrets.mode === "oneclaw") shroudProviderKeyForVault = key;
          else shroudProviderKeyForEnv = key;
        }
      }
    } else {
      shroudUpstream =
        v["shroud-upstream"] !== undefined && v["shroud-upstream"] !== ""
          ? parseShroudUpstream(v["shroud-upstream"], false)
          : await promptShroudUpstreamProvider();

      shroudBillingMode =
        v["shroud-billing"] !== undefined && v["shroud-billing"] !== ""
          ? parseShroudBilling(v["shroud-billing"], false)
          : await promptShroudBillingMode();

      if (shroudBillingMode === "token_billing") {
        /* no key */
      } else if (secrets.mode === "oneclaw") {
        shroudProviderKeyForVault =
          v["shroud-provider-api-key"] !== undefined &&
          v["shroud-provider-api-key"] !== ""
            ? v["shroud-provider-api-key"]
            : await promptShroudVaultProviderApiKey(shroudUpstream);
      } else {
        shroudProviderKeyForEnv =
          v["shroud-provider-api-key"] !== undefined &&
          v["shroud-provider-api-key"] !== ""
            ? v["shroud-provider-api-key"]
            : await promptShroudProviderApiKeyForEnv();
      }
    }
  }

  let thirdPartyLlmApiKey: string | undefined;
  if (nonInteractive) {
    if (llm !== "oneclaw") {
      const k = v["llm-api-key"];
      thirdPartyLlmApiKey = k !== undefined && k !== "" ? k : undefined;
    }
  } else if (llm !== "oneclaw") {
    if (v["llm-api-key"] !== undefined && v["llm-api-key"] !== "") {
      thirdPartyLlmApiKey = v["llm-api-key"];
    } else {
      thirdPartyLlmApiKey = await promptThirdPartyLlmApiKey(llm, secrets.mode);
    }
  }

  let shroudAgentManual: { agentId?: string; agentApiKey?: string };
  if (nonInteractive) {
    shroudAgentManual = {
      agentId: v["oneclaw-agent-id"]?.trim() || undefined,
      agentApiKey: v["oneclaw-agent-api-key"]?.trim() || undefined,
    };
  } else if (
    llm === "oneclaw" &&
    secrets.mode !== "oneclaw" &&
    (v["oneclaw-agent-id"] ?? "").trim() !== "" &&
    (v["oneclaw-agent-api-key"] ?? "").trim() !== ""
  ) {
    shroudAgentManual = {
      agentId: v["oneclaw-agent-id"]!.trim(),
      agentApiKey: v["oneclaw-agent-api-key"]!.trim(),
    };
  } else {
    shroudAgentManual = await promptShroudAgentCredentialsWhenNeeded(
      llm,
      secrets.mode,
    );
  }

  if (
    nonInteractive &&
    llm === "oneclaw" &&
    secrets.mode !== "oneclaw" &&
    (!shroudAgentManual.agentId || !shroudAgentManual.agentApiKey)
  ) {
    niErr(
      "set --oneclaw-agent-id and --oneclaw-agent-api-key when --llm oneclaw and --secrets is not oneclaw",
    );
  }

  if (
    nonInteractive &&
    llm === "oneclaw" &&
    shroudBillingMode === "provider_api_key" &&
    !shroudProviderKeyForVault &&
    !shroudProviderKeyForEnv
  ) {
    niErr(
      `set --shroud-provider-api-key for --shroud-billing provider_api_key (stored at ${shroudProviderVaultKeyPath(shroudUpstream!)} in vault mode or .env for plain secrets)`,
    );
  }

  let chain: ChainFramework;
  if (nonInteractive) {
    chain = parseChain(v.chain, true);
  } else if (v.chain !== undefined && v.chain !== "") {
    chain = parseChain(v.chain, false);
  } else {
    chain = await promptChain();
  }

  let framework: AppFramework;
  if (nonInteractive) {
    framework = parseFramework(v.framework, true);
  } else if (v.framework !== undefined && v.framework !== "") {
    framework = parseFramework(v.framework, false);
  } else {
    framework = await promptFramework();
  }

  // ── Post-quantum smart account ───────────────────────────────────────────
  let pqAccount: boolean;
  let pqScheme: PQScheme | undefined;
  let pqFactoryAddress: string | undefined;
  let bundlerUrl: string | undefined;

  if (nonInteractive) {
    pqAccount = Boolean(v["pq-account"]);
  } else if (v["pq-account"] !== undefined) {
    pqAccount = Boolean(v["pq-account"]);
  } else if (identityFromPrompt !== undefined) {
    // Identity was already chosen via promptIdentity — no separate PQ prompt needed.
    pqAccount = identityFromPrompt === "pq";
  } else {
    // --agent flag was provided interactively but no --pq-account flag — default off.
    pqAccount = false;
  }

  let pqNetwork: string | undefined;
  let pqChainId: number | undefined;

  if (pqAccount) {
    if (nonInteractive) {
      const net = (v["pq-network"] ?? "sepolia") as PQNetworkKey;
      pqNetwork = net;
      pqChainId = getChainId(net);
      pqScheme = (v["pq-scheme"] as PQScheme | undefined) ?? "mldsa";
      // Factory auto-resolved; --pq-factory-address overrides
      pqFactoryAddress =
        v["pq-factory-address"] ??
        getFactoryAddress(net, pqScheme as PQSchemeKey) ??
        "";
      bundlerUrl = v["bundler-url"] ?? getBundlerHint(net);
    } else {
      // Network selection
      const net: PQNetworkKey =
        v["pq-network"] !== undefined && v["pq-network"] !== ""
          ? (v["pq-network"] as PQNetworkKey)
          : await promptPQNetwork();
      pqNetwork = net;
      pqChainId = getChainId(net);

      // Scheme — filtered to what's deployed on the chosen network
      const availableSchemes = availableSchemesForNetwork(net);
      const rawScheme = v["pq-scheme"];
      pqScheme =
        rawScheme !== undefined && rawScheme !== ""
          ? (rawScheme as PQScheme)
          : (await promptPQScheme(net)) as PQScheme;

      // Validate scheme is available on this network
      if (!availableSchemes.includes(pqScheme as PQSchemeKey)) {
        throw new Error(
          `Scheme "${pqScheme}" is not deployed on ${pqNetwork}. Available: ${availableSchemes.join(", ")}`,
        );
      }

      // Factory address — auto from deployments, --pq-factory-address overrides
      pqFactoryAddress =
        v["pq-factory-address"] !== undefined && v["pq-factory-address"] !== ""
          ? v["pq-factory-address"]
          : (getFactoryAddress(net, pqScheme as PQSchemeKey) ?? "");

      // Bundler URL — default hint for selected network
      bundlerUrl =
        v["bundler-url"] !== undefined && v["bundler-url"] !== ""
          ? v["bundler-url"]
          : await promptBundlerUrl(net);
    }
  }

  // ── Deployer wallet ──────────────────────────────────────────────────────
  let deployerPrivateKey: string | undefined = v["deployer-private-key"]?.trim() || undefined;
  if (!deployerPrivateKey && !nonInteractive) {
    const generate = await promptGenerateDeployerAccount();
    if (!generate) {
      const choice = await promptDeployerWhenNotGenerated();
      if (choice === "enter_now") {
        deployerPrivateKey = await promptExistingDeployerPrivateKey();
      }
      // "skip" → deployerPrivateKey stays undefined → cli.ts generates a temporary wallet
    }
  }

  return {
    projectName,
    secrets,
    generateAgent,
    installAmpersendSdk,
    llm,
    shroudUpstream,
    shroudBillingMode,
    shroudProviderKeyForVault,
    shroudProviderKeyForEnv,
    thirdPartyLlmApiKey,
    shroudAgentManual,
    chain,
    framework,
    skipNpmInstall: skipNpm,
    skipAutoFund,
    swarmEntries,
    agentFileExtras: extras,
    pqAccount,
    pqNetwork,
    pqChainId,
    pqScheme,
    pqFactoryAddress,
    bundlerUrl,
    deployerPrivateKey,
  };
}
