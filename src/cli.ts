import { join } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import {
  promptProjectName,
  promptSecrets,
  promptIdentity,
  promptLlmProvider,
  promptChain,
  promptFramework,
} from "./prompts.js";
import { generateWallet } from "./actions/keys.js";
import { writeEnvFile } from "./actions/env.js";
import { setupOneClaw } from "./actions/oneclaw.js";
import { scaffoldProject } from "./actions/scaffold.js";
import { displayAccounts } from "./actions/qrcode.js";
import { showBanner, section, success, info, warn, keyValue } from "./ui.js";
import type { ScaffoldConfig, LlmProvider } from "./types.js";

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
  showBanner();

  // ── Project name ──────────────────────────────────────────────────────
  const projectName = await promptProjectName();
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

  // ── LLM Provider ──────────────────────────────────────────────────────
  section("LLM Provider");
  const llm = await promptLlmProvider(secrets.mode === "oneclaw");

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
      const result = await setupOneClaw(
        secrets.apiKey,
        projectName,
        deployer.privateKey,
        agent?.privateKey,
      );
      vaultId = result.vaultId;
      oneClawAgentInfo = result.agentInfo;
      spinner.succeed("Keys stored in 1Claw vault");
      keyValue("Vault ID", vaultId);
      if (oneClawAgentInfo) {
        keyValue("1Claw Agent ID", oneClawAgentInfo.id);
      }
      info("Deployer private key is NOT stored on disk");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail("1Claw setup failed: " + msg);
      warn("Falling back to local key storage");
    }
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
    deployer: { address: deployer.address, privateKey: deployer.privateKey },
    chain,
    framework,
    llm,
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
  // When 1Claw is the secrets manager only auth credentials go in .env —
  // every other secret lives in the vault.
  const envVars: Record<string, string> = {};

  envVars["DEPLOYER_ADDRESS"] = deployer.address;
  if (agent) envVars["AGENT_ADDRESS"] = agent.address;

  if (secrets.mode === "oneclaw") {
    envVars["ONECLAW_API_KEY"] = secrets.apiKey || "";
    envVars["ONECLAW_VAULT_ID"] = vaultId || "";
    if (oneClawAgentInfo) {
      envVars["ONECLAW_AGENT_ID"] = oneClawAgentInfo.id;
      envVars["ONECLAW_AGENT_API_KEY"] = oneClawAgentInfo.apiKey;
    }
  } else {
    envVars["DEPLOYER_PRIVATE_KEY"] = deployer.privateKey;
    if (agent) envVars["AGENT_PRIVATE_KEY"] = agent.privateKey;

    const llmKey = llmEnvKeyName(llm);
    if (llmKey) envVars[llmKey] = "";
  }

  const shouldEncrypt =
    secrets.mode === "oneclaw" || secrets.mode === "encrypted";
  writeEnvFile(
    projectDir,
    envVars,
    shouldEncrypt ? secrets.envPassword : undefined,
  );
  success(
    "Environment file created" + (shouldEncrypt ? " (encrypted)" : ""),
  );

  // ── Reminders ─────────────────────────────────────────────────────────
  if (secrets.mode === "oneclaw") {
    console.log("");
    if (vaultId) {
      info("All secrets stored in 1Claw vault — nothing sensitive on disk");
    } else {
      warn(
        "1Claw vault not created yet — add ONECLAW_API_KEY to .env then re-run setup",
      );
    }
    info(
      `Store your LLM API key in the vault as: ${chalk.cyan("llm-api-key")}`,
    );
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

  info("Fund these addresses to get started!");

  // ── Next steps ────────────────────────────────────────────────────────
  section("Next Steps");

  console.log(chalk.white(`  cd ${projectName}`));
  console.log(chalk.white("  npm install"));
  console.log("");

  if (chain !== "none") {
    console.log(
      chalk.white("  just chain           # start local blockchain"),
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
    warn(
      `Store your LLM API key in the vault as ${chalk.bold("llm-api-key")}`,
    );
  } else {
    const envLlmKey = llmEnvKeyName(llm);
    if (envLlmKey) {
      console.log("");
      warn(
        `Add your ${chalk.bold(envLlmKey)} to .env before using the chat UI`,
      );
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
