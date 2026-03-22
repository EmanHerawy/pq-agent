import { select, input, password } from "@inquirer/prompts";
import type {
  SecretsConfig,
  SecretsMode,
  ChainFramework,
  AppFramework,
  LlmProvider,
} from "./types.js";

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
      message: "Set a password to encrypt your .env file:",
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

export async function promptIdentity(useOneClaw: boolean): Promise<boolean> {
  const result = await select({
    message: "Generate Agent Identity?",
    choices: [
      {
        value: true,
        name: useOneClaw
          ? "Yes (via 1Claw — generate agent & associate with your account)"
          : "Yes (generate locally)",
      },
      { value: false, name: "No" },
    ],
  });
  return result;
}

export async function promptLlmProvider(
  useOneClaw: boolean,
): Promise<LlmProvider> {
  return select<LlmProvider>({
    message: "Which LLM Provider?",
    choices: [
      {
        value: "oneclaw" as const,
        name: "1Claw [Recommended]",
        description: useOneClaw
          ? "LLM key stored in your 1Claw vault — never in code"
          : "HSM-backed secret proxy for LLM calls",
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
