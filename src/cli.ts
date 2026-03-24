import { join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import {
  promptProjectName,
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
} from "./prompts.js";
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

Options:
  -h, --help       Show this help message
  -V, --version    Print the package version

Arguments:
  project-name     Create the project in this folder (skips the "Project name" prompt).
                   Example: npx scaffold-agent@latest my-agent

With no arguments (except optional project-name), starts the interactive wizard.

Environment:
  SCAFFOLD_SKIP_NPM_INSTALL=1   Skip automatic npm install at the end
  SCAFFOLD_SKIP_AUTO_FUND=1     Skip auto-fund script after scaffold
`);
}

/**
 * Parse argv: flags, optional project name, reject unknown options.
 * Returns the first positional argument as the project directory name, if any.
 */
function parseCli(argv: string[]): { projectNameFromCli?: string } {
  const positionals: string[] = [];
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "-V" || arg === "--version") {
      printVersion();
      process.exit(0);
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}\nRun scaffold-agent --help for usage.`);
      process.exit(1);
    }
    positionals.push(arg);
  }
  const first = positionals[0]?.trim();
  return { projectNameFromCli: first || undefined };
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
  const { projectNameFromCli } = parseCli(process.argv.slice(2));

  showBanner();

  // ── Project name ──────────────────────────────────────────────────────
  let projectName: string;
  if (projectNameFromCli !== undefined) {
    const t = projectNameFromCli.trim();
    if (!t) {
      console.log(chalk.red('\n  Project name cannot be empty.\n'));
      process.exit(1);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(t)) {
      console.log(
        chalk.red(
          `\n  Invalid project name "${t}". Use letters, numbers, hyphens, or underscores only.\n`,
        ),
      );
      process.exit(1);
    }
    projectName = t;
  } else {
    projectName = await promptProjectName();
  }
  const projectDir = join(process.cwd(), projectName);

  if (existsSync(projectDir)) {
    console.log(
      chalk.red(
        `\n  Directory "${projectName}" already exists. Pick another name.\n`,
      ),
    );
    process.exit(1);
  }

  // ── Secrets ───────────────────────────────────────────────────────────
  section("Secrets Management");
  const secrets = await promptSecrets();

  // ── Identity ──────────────────────────────────────────────────────────
  section("Agent Identity");
  const generateAgent = await promptIdentity(secrets.mode === "oneclaw");

  section("Ampersend (x402 / payments)");
  const installAmpersendSdk = await promptInstallAmpersendSdk();
  if (installAmpersendSdk) {
    info("Docs:     https://docs.ampersend.ai/");
    info("npm:      https://www.npmjs.com/package/@ampersend_ai/ampersend-sdk");
    info("GitHub:   https://github.com/edgeandnode/ampersend-sdk");
  }

  // ── LLM Provider ──────────────────────────────────────────────────────
  section("LLM Provider");
  const llm = await promptLlmProvider(secrets.mode === "oneclaw");

  let shroudUpstream: ShroudUpstreamProvider | undefined;
  let shroudBillingMode: ShroudBillingMode | undefined;
  let shroudProviderKeyForVault: string | undefined;
  let shroudProviderKeyForEnv: string | undefined;

  if (llm === "oneclaw") {
    section("Shroud (1Claw LLM proxy)");
    shroudUpstream = await promptShroudUpstreamProvider();
    info("Docs: https://docs.1claw.xyz/docs/guides/shroud");

    shroudBillingMode = await promptShroudBillingMode();
    if (shroudBillingMode === "token_billing") {
      info(
        "You chose Token Billing — enable it under Billing on 1claw.xyz for this agent if needed",
      );
    } else if (secrets.mode === "oneclaw") {
      shroudProviderKeyForVault = await promptShroudVaultProviderApiKey(
        shroudUpstream,
      );
    } else {
      shroudProviderKeyForEnv = await promptShroudProviderApiKeyForEnv();
    }

    if (secrets.mode === "oneclaw" && !generateAgent && llm === "oneclaw") {
      info(
        "No Ethereum agent wallet — a 1Claw Shroud agent will still be registered during vault setup (for chat). Generate an agent wallet if you need AGENT_ADDRESS on-chain.",
      );
    }
  }

  section("LLM API Key");
  const thirdPartyLlmApiKey = await promptThirdPartyLlmApiKey(
    llm,
    secrets.mode,
  );
  const shroudAgentManual = await promptShroudAgentCredentialsWhenNeeded(
    llm,
    secrets.mode,
  );

  if (llm === "oneclaw" && shroudBillingMode === "token_billing") {
    info("No provider API key stored — Shroud uses 1Claw LLM Token Billing");
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

  // ── Chain ─────────────────────────────────────────────────────────────
  section("Chain Framework");
  const chain = await promptChain();

  // ── Framework ─────────────────────────────────────────────────────────
  section("Framework");
  const framework = await promptFramework();

  // ── Key generation ────────────────────────────────────────────────────
  section("Generating Keys");

  const deployer = generateWallet();
  success("Generated deployer wallet");
  keyValue("Address", deployer.address);

  let agent: { address: string; privateKey: string } | undefined;
  if (generateAgent) {
    agent = generateWallet();
    success("Generated agent wallet");
    keyValue("Address", agent.address);
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
    },
    installAmpersendSdk,
    deployer: { address: deployer.address, privateKey: deployer.privateKey },
    chain,
    framework,
    llm,
    shroudUpstream,
    shroudBillingMode,
    oneClawVaultId: vaultId,
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
  if (process.env.SCAFFOLD_SKIP_NPM_INSTALL === "1") {
    info("Skipping npm install (SCAFFOLD_SKIP_NPM_INSTALL=1)");
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

  if (chain !== "none" && process.env.SCAFFOLD_SKIP_AUTO_FUND !== "1") {
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
  if (agent) {
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
      "  Requires: just (https://just.systems/man/en/installation.html)",
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
