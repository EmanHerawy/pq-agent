# Agent instructions — scaffold-agent

This repository is the **npm CLI** that **generates** onchain-agent monorepos (Foundry/Hardhat + Next.js/Vite/Python). It is **not** a generated app; consumer projects live in folders created by the CLI.

## Terminology

- **1claw / 1Claw** — [1claw.xyz](https://1claw.xyz): vault, agents, **Shroud** LLM proxy ([Shroud docs](https://docs.1claw.xyz/docs/guides/shroud)).
- **OpenClaw** — separate product ([openclaw.ai](https://openclaw.ai)); do not confuse with 1claw.

## Build and verify

```bash
npm install
npm run build          # tsup → dist/cli.js
node dist/cli.js --version
```

After changing **`src/cli.ts`**, **`src/cli-argv.ts`**, **`src/cli-wizard.ts`**, or **`src/actions/scaffold.ts`** (templates), **always run `npm run build`** before treating the CLI as up to date.

## Run the CLI locally

```bash
node dist/cli.js --help
node dist/cli.js my-project   # interactive; creates ./my-project under cwd
```

## Non-interactive / automation (`-y`)

Use **`-y`** / **`--non-interactive`** so no stdin prompts run (CI, scripts, other agents).

- **Required** when default **`--secrets`** is **`oneclaw`**: **`--env-password`** (≥ 6 chars), unless you set **`--secrets none`**.
- **`--defer-oneclaw-api-key`**: omit **`ONECLAW_API_KEY`** at scaffold time (vault not created until key exists).
- **`--skip-npm-install`** / **`--skip-auto-fund`**: avoid install and fund script in automation.

Minimal example (creates `./my-app` in current directory):

```bash
node dist/cli.js -y my-app \
  --env-password 'your-password-here' \
  --defer-oneclaw-api-key \
  --skip-npm-install \
  --skip-auto-fund
```

Full flag list: **`scaffold-agent --help`**.

### Shroud + `-y` validation

- **`--llm oneclaw`** with **`--secrets none`** (or non-oneclaw): set **`--oneclaw-agent-id`** and **`--oneclaw-agent-api-key`**.
- **`--shroud-billing provider_api_key`**: set **`--shroud-provider-api-key`** (vault path vs `.env` depends on **`--secrets`**).

Defaults under **`-y`** (see **`--help`**): e.g. Foundry, Next.js, 1Claw Shroud, **`token_billing`**, **`gemini-2.0-flash`** style Shroud defaults in generated env where applicable.

## Code map

| Area | Path |
|------|------|
| CLI entry | `src/cli.ts` |
| Arg parsing, enums, defaults | `src/cli-argv.ts` |
| Wizard / `-y` resolution | `src/cli-wizard.ts` |
| File generation + template strings | `src/actions/scaffold.ts` |
| Inquirer prompts | `src/prompts.ts` |
| Shared types | `src/types.ts` |
| Reusable page/route templates | `src/scaffold-templates/*.ts` |
| Bundled output | `dist/cli.js` (do not hand-edit) |

## Editing templates

Generated apps embed large template literals (e.g. Next **`app/api/chat/route.ts`**). Prefer **small, focused diffs**; match existing string style and escaping. Regenerate **`dist/`** with **`npm run build`**.

## Security

- Never commit real API keys, agent keys, or deployer private keys.
- Do not suggest pasting **Ethereum addresses** into **`ONECLAW_AGENT_ID`** (UUID only).

## Generated repos: `just reset` (1Claw)

When **`secrets`** or **`llm`** is 1Claw, scaffolds include **`just reset`** to create a **new** vault + agent after install if initial setup hit limits. It prints a **backup warning** — see the generated **`README.md`** and **`scripts/reset-1claw-setup.mjs`**.

## Further reading

- Human-oriented overview: **`README.md`**
- Cursor skill (when to load): **`.cursor/skills/scaffold-agent/SKILL.md`**
- Extra CLI / flag notes: **`.cursor/skills/scaffold-agent/reference.md`**
