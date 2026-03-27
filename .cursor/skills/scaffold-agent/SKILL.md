---
name: scaffold-agent
description: >-
  Maintains and extends the scaffold-agent npm CLI that generates onchain AI agent
  monorepos (Foundry/Hardhat + Next.js/Vite/Python), including -y flags, agent.json
  --from-config, --dump-config, --swarm, Shroud/1claw, and embedded Next/Vite templates.
  Use when editing this repository, changing CLI behavior or templates, running or
  documenting npx scaffold-agent, or answering questions about generated repos vs this
  generator codebase.
---

# scaffold-agent (generator repo)

## Scope

This workspace is the **npm package** that **writes** new project directories. It is **not** a Scaffold-ETH / Next app inside `packages/`—those only exist **after** someone runs the CLI. Treat **`src/`** as the source of truth for behavior; **`dist/cli.js`** is build output.

## Before editing

1. Read **`AGENTS.md`** (root) for the full code map, security rules, and Shroud notes.
2. After any change under **`src/`**, run **`npm run build`** before validating **`node dist/cli.js`** or **`npx scaffold-agent`**.

Files that always warrant a rebuild when touched:

| Path | Role |
|------|------|
| `src/cli.ts` | Entry, env write, 1Claw setup, dump-config path |
| `src/cli-argv.ts` | `parseArgs`, flag definitions, `-y` defaults |
| `src/cli-wizard.ts` | `gatherWizardInputs`, swarm / config validation |
| `src/agent-project-config.ts` | `agent.json` load/merge, swarm plan, dump JSON builder |
| `src/actions/scaffold.ts` | Monorepo layout, justfile, large embedded templates |
| `src/scaffold-templates/*.ts` | Reusable generated UI/network/wallet/swarm snippets |
| `src/actions/project-scripts.mjs` templates | `fund-deployer`, `swarm-agents`, etc. |

## Local CLI

```bash
npm install && npm run build
node dist/cli.js --help
node dist/cli.js my-dir          # interactive
```

Strict parsing: unknown flags **error**.

## Config file (`agent.json`)

- **`--from-config <file>`** — Merge JSON into flags; **CLI overrides file** for any flag passed on the command line.
- Shape: top-level or **`options`** object for CLI-like keys; **`project`** / **`name`**, **`swarm`**, **`agents`** (id → preset string), **`extra`** (written to generated **`agent.config.extra.json`** when present).
- Loader / merge / dump logic: **`src/agent-project-config.ts`**.

## Dump config

- **`--dump-config`** — Print merged **`agent.json`**-shaped JSON to stdout (no scaffold, no banner).
- **`--dump-config-out <path>`** — Write the same JSON to a file (implies dump if used alone).
- Fills unset fields with the same defaults as **`-y`**; **omits** secret flags from output (passwords, API keys) so the file is safe to share.

## Swarm

- **`--swarm <n>`** (1–64): multiple generated agent wallets; first remains **`AGENT_ADDRESS`** / **`AGENT_PRIVATE_KEY`**; extras in encrypted **`SWARM_AGENT_KEYS_JSON`**. Public roster: **`packages/*/public/agents.json`**.
- Generated UI: **`lib/agent-swarm.tsx`**, header picker, **`/swarm`** page, balances/identity use selected agent.
- Post-scaffold: **`just swarm agents=N`** (see generated justfile).

## Non-interactive (`-y`)

Use **`-y`** for CI/agents. **`--env-password`** (≥ 6 chars) is required when **`--secrets`** is **`oneclaw`** or **`encrypted`**, unless **`--secrets none`**. Shroud edge cases: see **`AGENTS.md`** and [reference.md](reference.md).

## Editing templates

**`src/actions/scaffold.ts`** holds very large template strings—prefer **small diffs**, preserve escaping, match existing style. For UI pieces, prefer **`src/scaffold-templates/`** when a module already exists there.

## Security

- Never commit real keys or deployer private keys.
- **`ONECLAW_AGENT_ID`** is a **UUID**, not an Ethereum **`0x…`** address (Shroud rejects addresses there).

## Terminology

- **1claw** — [1claw.xyz](https://1claw.xyz), vault + Shroud. **OpenClaw** ([openclaw.ai](https://openclaw.ai)) is a different product.

## More detail

- **[reference.md](reference.md)** — Flag table and links.
- **`AGENTS.md`** — Authoritative repo instructions for humans and agents.
