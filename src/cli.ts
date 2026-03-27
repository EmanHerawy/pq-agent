import { join, dirname, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import {
  NON_INTERACTIVE_DEFAULTS,
  parseScaffoldArgv,
  printNonInteractiveExample,
  validateProjectName,
} from "./cli-argv.js";
import { gatherWizardInputs } from "./cli-wizard.js";
import {
  buildAgentJsonForDump,
  loadAgentProjectConfig,
  withDumpTemplateDefaults,
  type AgentFileExtras,
} from "./agent-project-config.js";
import { shroudProviderVaultKeyPath } from "./shroud-paths.js";
import { generateWallet } from "./actions/keys.js";
import { writeEnvFile } from "./actions/env.js";
import { setupOneClaw } from "./actions/oneclaw.js";
import { scaffoldProject } from "./actions/scaffold.js";
import { displayAccounts } from "./actions/qrcode.js";
import { showBanner, section, success, info, warn, keyValue } from "./ui.js";
import type {
  ScaffoldConfig,
  LlmProvider,
  ShroudBillingMode,
  ShroudUpstreamProvider,
  SwarmAgentDef,
} from "./types.js";

function readOwnPackageJson(): {
  name: string;
  version: string;
  description?: string;
} {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..");
  const raw = readFileSync(join(root, "package.json"), "utf8");
  return JSON.parse(raw) as { name: string; version: string; description?: string };
}

function printVersion(): void {
  try {
    const { name, version } = readOwnPackageJson();
    console.log(`${name} ${version}`);
  } catch {
    console.log("unknown");
  }
}

function printHelp(): void {
  let desc =
    "Interactive CLI to scaffold monorepo projects for onchain AI agents";
  try {
    desc = readOwnPackageJson().description || desc;
  } catch {
    /* use default */
  }
  console.log(`
${desc}

Usage:
  scaffold-agent [options] [project-name]

General options:
  -h, --help                  Show this help message
  -V, --version               Print the package version
  -y, --non-interactive       No prompts; use flags + defaults (for CI / AI agents)
  --project <name>            Project directory name (alternative to positional)

Secrets & encryption:
  --secrets <mode>            oneclaw | encrypted | none
  --oneclaw-api-key <key>     1Claw user API key (when --secrets oneclaw)
  --defer-oneclaw-api-key     Skip ONECLAW_API_KEY now (vault setup deferred)
  --env-password <pw>         Password for .env.secrets.encrypted (required for
                              oneclaw | encrypted in --non-interactive; min 6 chars)

Agent & extras:
  --agent <choice>            generate | none  (default with -y: generate)
  --swarm <n>                 Generate N agent wallets (1–64); primary stays AGENT_ADDRESS
  --ampersend <choice>        yes | no        (default with -y: no)
  --from-config <file>        Merge options from agent.json (CLI flags override file)
  --dump-config               Print agent.json to stdout (merged flags + optional --from-config;
                              secret flags omitted; fills unset fields with -y defaults)
  --dump-config-out <file>    Write agent.json to a file (implies --dump-config if set alone)

LLM:
  --llm <provider>            oneclaw | gemini | openai | anthropic
  --llm-api-key <key>         Third-party LLM key (when --llm is not oneclaw; optional)

Shroud (only when --llm oneclaw):
  --shroud-upstream <id>      openai | anthropic | google | gemini | mistral | cohere | openrouter
  --shroud-billing <mode>     token_billing | provider_api_key
  --shroud-provider-api-key   Upstream API key for provider_api_key mode (vault or .env)
  --oneclaw-agent-id <uuid>   Required with -y when --secrets is not oneclaw and --llm oneclaw
  --oneclaw-agent-api-key     Agent ocv_ key (same conditions)

Chain & UI:
  --chain <framework>         foundry | hardhat | none
  --framework <ui>            nextjs | vite | python

Automation:
  --skip-npm-install          Skip npm install at the end
  --skip-auto-fund            Skip scripts/fund-deployer.mjs after scaffold

Arguments:
  project-name                Same as --project (only one positional allowed)

Interactive mode: omit --non-interactive; any option above skips that prompt when set.

Non-interactive (-y): set --env-password when --secrets is oneclaw or encrypted; defaults:
  secrets=${NON_INTERACTIVE_DEFAULTS.secrets}, agent=generate, ampersend=no, llm=${NON_INTERACTIVE_DEFAULTS.llm},
  shroud-upstream=${NON_INTERACTIVE_DEFAULTS.shroudUpstream}, shroud-billing=${NON_INTERACTIVE_DEFAULTS.shroudBilling},
  chain=${NON_INTERACTIVE_DEFAULTS.chain}, framework=${NON_INTERACTIVE_DEFAULTS.framework}

Environment:
  SCAFFOLD_SKIP_NPM_INSTALL=1   Skip automatic npm install (same as --skip-npm-install)
  SCAFFOLD_SKIP_AUTO_FUND=1     Skip auto-fund (same as --skip-auto-fund)
`);
}

/** Written into generated `.env` when LLM = 1Claw (Shroud). */
const SHROUD_AGENT_ID_ENV_COMMENT =
  "# Shroud chat:\n" +
  "#   ONECLAW_AGENT_ID = 1Claw agent UUID from 1claw.xyz (dashes), or run: just list-1claw\n" +
  "#   Do NOT put AGENT_ADDRESS (0x… Ethereum wallet) here — Shroud rejects it (Invalid agent_id format).\n" +
  "#\n";

/** Prepended to `.env` when 1Claw mode but no vault id (setup skipped or failed). */
const ONECLAW_VAULT_MISSING_COMMENT =
  "# ONECLAW_VAULT_ID is empty — scaffold did not get a vault id. It IS written automatically when:\n" +
  "#   • You enter ONECLAW_API_KEY during wizard AND \"Creating vault…\" succeeds.\n" +
  "# If blank: add ONECLAW_API_KEY to .env.secrets (password: just start / just deploy), then run:\n" +
  "#   just list-1claw\n" +
  "# Copy a vault id from the output into ONECLAW_VAULT_ID above, or from https://1claw.xyz\n#\n";

function printShroudAgentIdCliReminder() {
  section("Shroud: ONECLAW_AGENT_ID vs AGENT_ADDRESS");
  info(
    `${chalk.bold("ONECLAW_AGENT_ID")} must be the 1Claw agent ${chalk.cyan("UUID")} (e.g. 550e8400-e29b-41d4-a716-446655440000), from the dashboard or API.`,
  );
  info(
    `${chalk.bold("AGENT_ADDRESS")} is your on-chain ${chalk.cyan("Ethereum wallet")} (0x…) — ${chalk.yellow("never")} paste that into ONECLAW_AGENT_ID.`,
  );
  info(
    `List agent UUIDs: ${chalk.cyan("just list-1claw")} (needs ONECLAW_API_KEY in .env).`,
  );
  console.log("");
}

function defaultShroudModel(upstream: ShroudUpstreamProvider): string {
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

function llmEnvKeyName(llm: LlmProvider): string | null {
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

async function main() {
  let parsed;
  try {
    parsed = parseScaffoldArgv(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(msg));
    console.error(chalk.gray("Run scaffold-agent --help for usage."));
    process.exit(1);
  }

  const { values, positionals } = parsed;
  if (values.help) {
    printHelp();
    printNonInteractiveExample();
    process.exit(0);
  }
  if (values.version) {
    printVersion();
    process.exit(0);
  }

  const wantsDumpConfig =
    Boolean(values["dump-config"]) ||
    Boolean(values["dump-config-out"]?.trim());

  if (wantsDumpConfig) {
    let cliValues = values;
    let configExtras: AgentFileExtras | null = null;
    if (values["from-config"]?.trim()) {
      const fromConfigPath = resolve(
        process.cwd(),
        values["from-config"].trim(),
      );
      try {
        const merged = loadAgentProjectConfig(fromConfigPath, values);
        cliValues = merged.values;
        configExtras = merged.extras;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(msg));
        process.exit(1);
      }
    }

    const filled = withDumpTemplateDefaults(cliValues);
    const fromPos = positionals[0]?.trim();
    const fromFlag = filled.project?.trim();
    let projectName: string;
    try {
      if (fromPos && fromFlag && fromPos !== fromFlag) {
        throw new Error(
          "CLI: project name given both as argument and --project; use only one for --dump-config.",
        );
      }
      const raw = fromPos || fromFlag || "my-agent";
      projectName = validateProjectName(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }

    const jsonObj = buildAgentJsonForDump(filled, configExtras, projectName);
    const text = JSON.stringify(jsonObj, null, 2) + "\n";
    const outPath = values["dump-config-out"]?.trim();
    if (outPath) {
      const absOut = resolve(process.cwd(), outPath);
      writeFileSync(absOut, text, { mode: 0o600 });
      console.error(chalk.gray(`Wrote ${absOut}`));
    } else {
      process.stdout.write(text);
    }
    process.exit(0);
  }

  showBanner();

  const nonInteractive = Boolean(values["non-interactive"]);

  let cliValues = values;
  let configExtras: AgentFileExtras | null = null;
  if (values["from-config"]?.trim()) {
    const fromConfigPath = resolve(process.cwd(), values["from-config"].trim());
    try {
      const merged = loadAgentProjectConfig(fromConfigPath, values);
      cliValues = merged.values;
      configExtras = merged.extras;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  }

  let w;
  try {
    w = await gatherWizardInputs(
      cliValues,
      positionals,
      nonInteractive,
      configExtras,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red("\n" + msg + "\n"));
    if (nonInteractive) printNonInteractiveExample();
    process.exit(1);
  }

  const { projectName, secrets, generateAgent, installAmpersendSdk, llm, swarmEntries } =
    w;
  let {
    shroudUpstream,
    shroudBillingMode,
    shroudProviderKeyForVault,
    shroudProviderKeyForEnv,
    thirdPartyLlmApiKey,
    shroudAgentManual,
    chain,
    framework,
  } = w;

  const projectDir = join(process.cwd(), projectName);

  if (existsSync(projectDir)) {
    console.log(
      chalk.red(
        `\n  Directory "${projectName}" already exists. Pick another name.\n`,
      ),
    );
    process.exit(1);
  }

  if (installAmpersendSdk) {
    section("Ampersend (x402 / payments)");
    info("Docs:     https://docs.ampersend.ai/");
    info("npm:      https://www.npmjs.com/package/@ampersend_ai/ampersend-sdk");
    info("GitHub:   https://github.com/edgeandnode/ampersend-sdk");
  }

  section("LLM Provider");
  if (llm === "oneclaw") {
    section("Shroud (1Claw LLM proxy)");
    info("Docs: https://docs.1claw.xyz/docs/guides/shroud");
    if (shroudBillingMode === "token_billing") {
      info(
        "You chose Token Billing — enable it under Billing on 1claw.xyz for this agent if needed",
      );
    }
    if (secrets.mode === "oneclaw" && !generateAgent && llm === "oneclaw") {
      info(
        "No Ethereum agent wallet — a 1Claw Shroud agent will still be registered during vault setup (for chat). Generate an agent wallet if you need AGENT_ADDRESS on-chain.",
      );
    }
  }

  section("LLM API Key");

  if (llm === "oneclaw" && shroudBillingMode === "token_billing") {
    info("No provider API key stored — Shroud uses 1Claw LLM Token Billing");
    if (shroudUpstream === "google" || shroudUpstream === "gemini") {
      info(
        "Google/Gemini + token billing: chat goes through Shroud (no GOOGLE_GENERATIVE_AI_API_KEY in this repo). Enable LLM token billing for this agent on 1claw.xyz.",
      );
      info(
        `Default Shroud model is ${chalk.cyan("gemini-2.0-flash")} (Stripe AI Gateway / Shroud allowlist). Set SHROUD_DEFAULT_MODEL if you need another id listed in the Shroud docs.`,
      );
    }
  } else if (
    llm === "oneclaw" &&
    shroudBillingMode === "provider_api_key" &&
    shroudProviderKeyForVault
  ) {
    success(
      `Provider API key will be stored in vault at ${chalk.cyan(shroudProviderVaultKeyPath(shroudUpstream!))}`,
    );
  } else if (
    llm === "oneclaw" &&
    shroudBillingMode === "provider_api_key" &&
    shroudProviderKeyForEnv
  ) {
    success("Provider API key will be written to .env (SHROUD_PROVIDER_API_KEY)");
  } else if (llm === "oneclaw" && shroudBillingMode === "provider_api_key") {
    warn(
      `Add your key in 1Claw vault (${shroudProviderVaultKeyPath(shroudUpstream!)}) or .env (SHROUD_PROVIDER_API_KEY) before chat`,
    );
  } else if (llm === "oneclaw" && shroudAgentManual.agentId) {
    success("Shroud agent credentials will be written to .env");
  } else if (llm === "oneclaw") {
    info("Add ONECLAW_AGENT_ID + ONECLAW_AGENT_API_KEY to .env for Shroud");
  } else if (thirdPartyLlmApiKey) {
    success(
      secrets.mode === "oneclaw"
        ? "API key will be stored in your 1Claw vault"
        : "API key will be written to .env",
    );
  } else {
    info(
      secrets.mode === "oneclaw"
        ? "Add llm-api-key to your vault before using chat"
        : "Add your LLM API key to .env before using chat",
    );
  }

  // ── Key generation ────────────────────────────────────────────────────
  section("Generating Keys");

  const deployer = generateWallet();
  success("Generated deployer wallet");
  keyValue("Address", deployer.address);

  let agent: { address: string; privateKey: string } | undefined;
  let swarmAgents: SwarmAgentDef[] | undefined;
  if (generateAgent && swarmEntries.length > 0) {
    swarmAgents = [];
    for (const entry of swarmEntries) {
      const wlt = generateWallet();
      swarmAgents.push({
        id: entry.id,
        address: wlt.address,
        privateKey: wlt.privateKey,
        preset: entry.preset,
      });
    }
    agent = swarmAgents[0];
    if (swarmAgents.length === 1) {
      success("Generated agent wallet");
      keyValue("Address", agent.address);
    } else {
      success(`Generated ${swarmAgents.length} swarm agent wallets`);
      for (const s of swarmAgents) {
        keyValue(s.id, s.address);
      }
    }
  }

  // ── 1Claw vault setup ────────────────────────────────────────────────
  let vaultId: string | undefined;
  let oneClawAgentInfo: { id: string; apiKey: string } | undefined;

  if (secrets.mode === "oneclaw" && secrets.apiKey) {
    section("1Claw Setup");
    const spinner = ora(
      "Creating vault and storing keys in 1Claw...",
    ).start();
    try {
      const shroudVaultPath =
        llm === "oneclaw" &&
        shroudUpstream &&
        shroudBillingMode === "provider_api_key"
          ? shroudProviderVaultKeyPath(shroudUpstream)
          : null;

      const result = await setupOneClaw(
        secrets.apiKey,
        projectName,
        deployer.privateKey,
        agent?.privateKey,
        {
          llmApiKey: thirdPartyLlmApiKey,
          registerShroudAgent: llm === "oneclaw",
          shroudProviderApiKey:
            shroudProviderKeyForVault && shroudVaultPath
              ? { path: shroudVaultPath, value: shroudProviderKeyForVault }
              : undefined,
        },
      );
      vaultId = result.vaultId;
      oneClawAgentInfo = result.agentInfo;
      spinner.succeed("Keys stored in 1Claw vault");
      keyValue("Vault ID", vaultId);
      if (oneClawAgentInfo) {
        keyValue("1Claw Agent ID", oneClawAgentInfo.id);
        if (llm === "oneclaw") {
          info(
            "This UUID is your ONECLAW_AGENT_ID for Shroud — not the same as AGENT_ADDRESS (Ethereum wallet below).",
          );
        }
      }
      info(
        "Deployer key is in your vault and in .env.secrets.encrypted for local Foundry (`just deploy` prompts for password)",
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail("1Claw setup failed: " + msg);
      warn("Falling back to local key storage");
      warn(
        "ONECLAW_VAULT_ID will be empty until you fix the error above or run just list-1claw and paste a vault id into .env",
      );
    }
  } else if (secrets.mode === "oneclaw" && !secrets.apiKey) {
    warn(
      "ONECLAW_API_KEY was deferred — no vault was created. ONECLAW_VAULT_ID will be blank until you add the key to .env.secrets.encrypted, then run just list-1claw and paste a vault id into .env",
    );
  }

  // ── Scaffold project ─────────────────────────────────────────────────
  section("Scaffolding Project");
  const spinner = ora("Creating project structure...").start();

  const config: ScaffoldConfig = {
    projectName,
    secrets,
    identity: {
      generateAgent,
      agentAddress: agent?.address,
      agentPrivateKey: agent?.privateKey,
      swarmAgents,
    },
    installAmpersendSdk,
    deployer: { address: deployer.address, privateKey: deployer.privateKey },
    chain,
    framework,
    llm,
    shroudUpstream,
    shroudBillingMode,
    oneClawVaultId: vaultId,
    agentConfigExtra: w.agentFileExtras?.extra,
  };

  try {
    await scaffoldProject(config);
    spinner.succeed("Project created");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.fail("Scaffolding failed: " + msg);
    process.exit(1);
  }

  // ── Write .env ────────────────────────────────────────────────────────
  // Deployer private key must be in .env for local Foundry (`forge script` reads
  // DEPLOYER_PRIVATE_KEY). With 1Claw, the vault still holds a copy for app runtime.
  const envVars: Record<string, string> = {};

  envVars["DEPLOYER_ADDRESS"] = deployer.address;
  envVars["DEPLOYER_PRIVATE_KEY"] = deployer.privateKey;

  if (agent) {
    envVars["AGENT_ADDRESS"] = agent.address;
    envVars["AGENT_PRIVATE_KEY"] = agent.privateKey;
    envVars["NEXT_PUBLIC_AGENT_ADDRESS"] = agent.address;
    envVars["VITE_AGENT_ADDRESS"] = agent.address;
  }
  if (swarmAgents && swarmAgents.length > 1) {
    const extraKeys = swarmAgents.slice(1).map(({ id, privateKey }) => ({
      id,
      privateKey,
    }));
    envVars["SWARM_AGENT_KEYS_JSON"] = JSON.stringify(extraKeys);
  }

  if (framework === "nextjs") {
    envVars["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"] = "";
  } else if (framework === "vite") {
    envVars["VITE_WALLETCONNECT_PROJECT_ID"] = "";
  }

  if (secrets.mode === "oneclaw") {
    envVars["ONECLAW_API_KEY"] = secrets.apiKey || "";
    envVars["ONECLAW_VAULT_ID"] = vaultId || "";
    if (oneClawAgentInfo) {
      envVars["ONECLAW_AGENT_ID"] = oneClawAgentInfo.id;
      envVars["ONECLAW_AGENT_API_KEY"] = oneClawAgentInfo.apiKey;
    } else if (llm === "oneclaw") {
      envVars["ONECLAW_AGENT_ID"] = shroudAgentManual.agentId || "";
      envVars["ONECLAW_AGENT_API_KEY"] = shroudAgentManual.agentApiKey || "";
    }
  } else if (llm === "oneclaw" && shroudUpstream) {
    envVars["ONECLAW_AGENT_ID"] = shroudAgentManual.agentId || "";
    envVars["ONECLAW_AGENT_API_KEY"] = shroudAgentManual.agentApiKey || "";
  } else {
    const llmKey = llmEnvKeyName(llm);
    if (llmKey) envVars[llmKey] = thirdPartyLlmApiKey || "";
  }

  if (llm === "oneclaw" && shroudUpstream && shroudBillingMode) {
    envVars["SHROUD_BILLING_MODE"] = shroudBillingMode;
    envVars["SHROUD_LLM_PROVIDER"] = shroudUpstream;
    envVars["SHROUD_DEFAULT_MODEL"] = defaultShroudModel(shroudUpstream);
    envVars["SHROUD_PROVIDER_VAULT_PATH"] =
      shroudBillingMode === "provider_api_key" && secrets.mode === "oneclaw"
        ? shroudProviderVaultKeyPath(shroudUpstream)
        : "";
    envVars["SHROUD_PROVIDER_API_KEY"] =
      shroudBillingMode === "provider_api_key" && secrets.mode !== "oneclaw"
        ? shroudProviderKeyForEnv || ""
        : "";
  }

  const shouldEncrypt =
    secrets.mode === "oneclaw" || secrets.mode === "encrypted";

  const dotenvCommentParts: string[] = [];
  if (llm === "oneclaw") dotenvCommentParts.push(SHROUD_AGENT_ID_ENV_COMMENT);
  if (secrets.mode === "oneclaw" && !(vaultId || "").trim()) {
    dotenvCommentParts.push(ONECLAW_VAULT_MISSING_COMMENT);
  }
  if (framework === "nextjs" || framework === "vite") {
    dotenvCommentParts.push(
      "\n# RainbowKit / WalletConnect: optional for browser-extension wallets; set for mobile QR (free) https://cloud.walletconnect.com\n",
    );
  }

  writeEnvFile(
    projectDir,
    envVars,
    shouldEncrypt ? secrets.envPassword : undefined,
    dotenvCommentParts.length > 0
      ? { dotenvComment: dotenvCommentParts.join("") }
      : undefined,
  );
  success(
    shouldEncrypt
      ? "Created .env (non-secrets) + .env.secrets.encrypted — run just deploy / just start to enter your password"
      : "Environment file created",
  );
  if (secrets.mode === "oneclaw" && !(vaultId || "").trim()) {
    warn(
      "ONECLAW_VAULT_ID is blank — vault-backed chat needs it. After ONECLAW_API_KEY works: just list-1claw → paste vault id into .env → restart next dev",
    );
  }

  let npmInstallOk = false;
  if (
    process.env.SCAFFOLD_SKIP_NPM_INSTALL === "1" ||
    w.skipNpmInstall
  ) {
    info(
      w.skipNpmInstall
        ? "Skipping npm install (--skip-npm-install)"
        : "Skipping npm install (SCAFFOLD_SKIP_NPM_INSTALL=1)",
    );
  } else {
    section("Installing dependencies");
    const npmSpinner = ora("Running npm install in project root…").start();
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn("npm", ["install"], {
        cwd: projectDir,
        stdio: "inherit",
        shell: true,
        env: process.env,
      });
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(null));
    });
    if (exitCode === 0) {
      npmSpinner.succeed("npm install finished");
      npmInstallOk = true;
    } else if (exitCode === null) {
      npmSpinner.fail("Could not run npm (is Node.js / npm on PATH?)");
      warn(`Run manually: cd ${projectName} && npm install`);
    } else {
      npmSpinner.fail("npm install exited with an error");
      warn(`Run manually when ready: cd ${projectName} && npm install`);
    }
  }

  if (
    chain !== "none" &&
    process.env.SCAFFOLD_SKIP_AUTO_FUND !== "1" &&
    !w.skipAutoFund
  ) {
    const fundScript = join(projectDir, "scripts", "fund-deployer.mjs");
    if (existsSync(fundScript)) {
      await new Promise<void>((resolve) => {
        const child = spawn(process.execPath, ["scripts/fund-deployer.mjs"], {
          cwd: projectDir,
          stdio: "inherit",
          env: process.env,
        });
        child.on("exit", (code) => {
          if (code !== 0) {
            info(
              "Auto-fund only works if a node is already running on your RPC (default http://127.0.0.1:8545). Start just chain first, then: cd " +
                projectName +
                " && just fund → just deploy",
            );
          }
          resolve();
        });
        child.on("error", () => {
          info("Run just fund after just chain when ready.");
          resolve();
        });
      });
    }
  }

  // ── Reminders ─────────────────────────────────────────────────────────
  if (secrets.mode === "oneclaw") {
    console.log("");
    if (vaultId) {
      info(
        "Secrets in 1Claw vault; deployer private key is only in .env.secrets.encrypted (just deploy prompts for password)",
      );
    } else {
      warn(
        "1Claw vault not created yet — add ONECLAW_API_KEY to .env then re-run setup",
      );
    }
    if (llm !== "oneclaw" && !thirdPartyLlmApiKey) {
      info(
        `Store your LLM API key in the vault as: ${chalk.cyan("llm-api-key")}`,
      );
    }
    if (
      secrets.mode === "oneclaw" &&
      llm === "oneclaw" &&
      !oneClawAgentInfo
    ) {
      warn(
        "Shroud needs ONECLAW_AGENT_ID (1Claw agent UUID) + ONECLAW_AGENT_API_KEY — enable agent identity in setup or create an agent in 1Claw. Do not use AGENT_ADDRESS (0x…) as ONECLAW_AGENT_ID.",
      );
    }
  }

  // ── QR codes ──────────────────────────────────────────────────────────
  section("Your Accounts");

  const accounts: Array<{ label: string; address: string }> = [
    { label: "Deployer", address: deployer.address },
  ];
  if (swarmAgents && swarmAgents.length > 1) {
    for (const s of swarmAgents) {
      accounts.push({ label: `Agent (${s.id})`, address: s.address });
    }
  } else if (agent) {
    accounts.push({ label: "Agent", address: agent.address });
  }
  await displayAccounts(accounts);

  if (!agent) {
    info(
      `Only a ${chalk.bold("Deployer")} QR is shown — you chose ${chalk.bold("No")} for ${chalk.bold("Generate Agent Identity")}, so there is no on-chain ${chalk.bold("AGENT_ADDRESS")} to fund. QR codes are for ${chalk.bold("Ethereum addresses")} (e.g. phone wallet). Your ${chalk.bold("1Claw Agent ID")} (UUID) is for ${chalk.bold("Shroud/API")}, not a second QR. Want an agent wallet + second QR later: run ${chalk.cyan("just generate")} in the project (agent path) or create a new project with ${chalk.bold("Yes")} for agent identity.`,
    );
  }

  if (chain !== "none") {
    info(
      "Local: with just chain running, we try to auto-fund deployer (+ agent). Otherwise: just fund → just deploy. For live networks, fund the addresses above.",
    );
  } else {
    info("Fund these addresses to get started!");
  }

  if (llm === "oneclaw") {
    printShroudAgentIdCliReminder();
  }

  // ── Next steps ────────────────────────────────────────────────────────
  section("Next Steps");

  console.log(chalk.white(`  cd ${projectName}`));
  if (process.env.SCAFFOLD_SKIP_NPM_INSTALL === "1") {
    console.log(
      chalk.white("  npm install          # skipped during scaffold"),
    );
  } else if (!npmInstallOk) {
    console.log(
      chalk.white("  npm install          # finish or retry if install failed"),
    );
  }
  console.log("");

  if (chain !== "none") {
    console.log(
      chalk.white("  just chain           # start local blockchain"),
    );
    console.log(
      chalk.white(
        "  just fund            # fund deployer + agent from local acct #0 (if auto-fund missed)",
      ),
    );
    console.log(
      chalk.white("  just deploy          # deploy contracts + generate ABI types"),
    );
  }
  if (framework === "python") {
    console.log(chalk.white("  just start           # start agent"));
  } else {
    console.log(chalk.white("  just start           # start frontend"));
  }
  console.log(
    chalk.white("  just generate        # generate deployer wallet (if needed)"),
  );

  if (secrets.mode === "oneclaw") {
    if (!secrets.apiKey) {
      console.log("");
      warn(
        "Add your ONECLAW_API_KEY to .env before using the app",
      );
    }
    if (llm !== "oneclaw" && !thirdPartyLlmApiKey) {
      warn(
        `Add ${chalk.bold("llm-api-key")} to your 1Claw vault before using chat`,
      );
    }
    if (
      llm === "oneclaw" &&
      shroudBillingMode === "provider_api_key" &&
      !shroudProviderKeyForVault &&
      shroudUpstream
    ) {
      warn(
        `Add ${chalk.bold(shroudProviderVaultKeyPath(shroudUpstream))} to your 1Claw vault before using chat (BYOK)`,
      );
    }
  } else {
    if (
      llm === "oneclaw" &&
      (!shroudAgentManual.agentId || !shroudAgentManual.agentApiKey)
    ) {
      console.log("");
      warn(
        `Add ${chalk.bold("ONECLAW_AGENT_ID")} (UUID from 1claw, not 0x wallet) and ${chalk.bold("ONECLAW_AGENT_API_KEY")} to .env for Shroud`,
      );
    } else {
      const envLlmKey = llmEnvKeyName(llm);
      if (envLlmKey && !thirdPartyLlmApiKey) {
        console.log("");
        warn(
          `Add your ${chalk.bold(envLlmKey)} to .env before using the chat UI`,
        );
      }
    }
  }

  console.log("");
  console.log(
    chalk.gray(
      "  Install just separately for chain/deploy/start: https://just.systems/man/en/installation.html",
    ),
  );
  console.log("");
  console.log(chalk.cyan("  Happy building!"));
  console.log("");
}

main().catch((err) => {
  if (
    err instanceof Error &&
    err.message.includes("User force closed the prompt")
  ) {
    console.log("\n" + chalk.gray("  Cancelled."));
    process.exit(0);
  }
  console.error(
    chalk.red("\nError: ") +
      (err instanceof Error ? err.message : err),
  );
  process.exit(1);
});
