# scaffold-agent

Interactive CLI to scaffold monorepo projects for onchain AI agents.

## Usage

```bash
npx scaffold-agent@latest
```

The wizard walks through:

1. **Project name** — directory to create
2. **Secrets management** — 1Claw (HSM-backed vault), encrypted secrets file, or plain `.env`
3. **Agent identity** — generate an Ethereum wallet for your agent
4. **LLM Provider** — 1Claw, Gemini, OpenAI, or Anthropic
5. **Chain framework** — Foundry, Hardhat, or none
6. **App framework** — Next.js, Vite, or Python (Google A2A)

At the end it displays QR codes for the Deployer and Agent addresses. If you picked a chain, the CLI also runs **`scripts/fund-deployer.mjs`** (same as **`just fund`**). **Order matters:** auto-fund only succeeds if a node is **already** listening on **`RPC_URL`** (default **`http://127.0.0.1:8545`**). Most people run **`just chain` first**, then scaffold in another terminal—or run **`just fund`** after **`cd` into the project**. Set **`SCAFFOLD_SKIP_AUTO_FUND=1`** to skip. **`just generate`** tries the same auto-fund when you create a deployer.

## What gets created

```
my-agent/
├── justfile                      # just chain / deploy / start / generate
├── scripts/
│   ├── secrets-crypto.mjs        # encrypt/decrypt .env.secrets.encrypted
│   ├── with-secrets.mjs          # prompt password, run deploy/start with env
│   ├── deploy-foundry.mjs        # or deploy-hardhat.mjs
│   ├── generate-abi-types.mjs    # auto-gen TypeScript from contract ABIs
│   ├── generate-deployer.mjs     # create deployer wallet if missing (+ auto-fund if RPC up)
│   └── fund-deployer.mjs         # fund DEPLOYER + optional AGENT from local acct #0
├── packages/
│   ├── foundry/                  # or hardhat/ (Solidity contracts)
│   └── nextjs/                   # or vite/ or python/ (frontend / agent)
│       ├── app/
│       │   ├── page.tsx          # shadcn chat UI
│       │   └── api/chat/route.ts # LLM streaming API
│       ├── components/ui/        # shadcn Button, Input
│       ├── contracts/            # auto-generated ABI types
│       └── ...
├── .env                          # non-sensitive config (gitignored)
├── .env.secrets.encrypted        # AES-256-GCM encrypted API keys & private keys (gitignored)
├── .gitignore
├── package.json                  # monorepo root
└── README.md
```

### Commands (via [just](https://just.systems))

| Command         | Description                                                                       |
| --------------- | --------------------------------------------------------------------------------- |
| `just chain`    | Start local blockchain (Foundry/Hardhat)                                          |
| `just fund`     | Fund `DEPLOYER_ADDRESS` + optional `AGENT_ADDRESS` (100 ETH each from account #0) |
| `just deploy`   | Deploy contracts & auto-gen ABIs (prompts for secrets password if encrypted)      |
| `just start`    | Start frontend or agent (same)                                                    |
| `just generate` | Generate deployer wallet (password prompt if encrypted)                           |

### ABI type generation

`just deploy` automatically parses compiled contract artifacts and generates
`deployedContracts.ts` — the same pattern used by
[Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2). This gives you
type-safe contract addresses and ABIs in your frontend code.

**Next.js apps** also get **`/debug`** (bug icon in the header): read-only view of deployed addresses and ABI, similar to [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2) Debug Contracts.

### 1Claw IDs programmatically

With your **user** `ONECLAW_API_KEY` you can call the same REST API the CLI uses:

- `POST /v1/auth/api-key-token` → Bearer token
- `GET /v1/vaults` → vault UUIDs (`ONECLAW_VAULT_ID`)
- `GET /v1/agents` → agent UUIDs (`ONECLAW_AGENT_ID`)

Scaffolded 1Claw projects include **`just list-1claw`** (runs `scripts/list-1claw-ids.mjs` under `with-secrets` when needed).

Agent **API keys** (`ONECLAW_AGENT_API_KEY` / `ocv_…`) are **not** returned by list endpoints — only when you **create** an agent (`POST /v1/agents`, as in `setupOneClaw`) or **rotate** via [`@1claw/sdk`](https://github.com/1clawAI/1claw-sdk) `client.agents.rotateKey(id)`.

## 1Claw integration

When you choose **1Claw (1claw.xyz)**, the CLI:

- Authenticates with your `ONECLAW_API_KEY`
- Creates a vault for the project and writes **`ONECLAW_VAULT_ID`** into `.env` **when** you enter the API key during setup **and** vault creation succeeds. If you skip the key (“add later”) or setup fails, **`ONECLAW_VAULT_ID` stays blank** — then run **`just list-1claw`** (with your key loaded) and paste a vault id from the output (or from the dashboard).
- Stores the deployer private key at `private-keys/deployer` in the vault (**not** on disk)
- If agent identity is generated, stores it at `private-keys/agent` and registers the agent
- If you pick **Gemini, OpenAI, or Anthropic** as the LLM, the CLI can store that
  provider’s API key in the vault as **`llm-api-key`** (optional — you can add it later in the dashboard)
- If you pick **1Claw** as the LLM, chat uses **[Shroud](https://docs.1claw.xyz/docs/guides/shroud)**. During setup the CLI **registers a 1Claw agent** (unless you already get one from generating an on-chain agent wallet) and writes **`ONECLAW_AGENT_ID`** + **`ONECLAW_AGENT_API_KEY`** to your env when vault creation succeeds — you don’t need to paste them manually. The Shroud agent **UUID is not** your Ethereum **`AGENT_ADDRESS`**. With vault BYOK, set **`ONECLAW_VAULT_ID`** too or Shroud’s `vault://…` header is invalid.
  You choose an **upstream** provider (OpenAI, Google/Gemini, Anthropic, …); Shroud proxies to it.
  The CLI asks how upstream LLM usage is paid:
    - **LLM Token Billing** on [1claw.xyz](https://1claw.xyz) — set **`SHROUD_BILLING_MODE=token_billing`**; no provider key.
    - **Your own API key** — set **`SHROUD_BILLING_MODE=provider_api_key`**. With 1Claw secrets, the key can live in the vault
      at **`api-keys/openai`**, **`api-keys/gemini`**, etc. (the chat route sends **`vault://…`** as **`X-Shroud-Api-Key`**).
      Without 1Claw vault, use **`SHROUD_PROVIDER_API_KEY`** in `.env`.

## LLM providers

| Choice                                                 | Auth / keys                                                  | Notes                                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1Claw** (LLM)                                        | `.env`: agent + `SHROUD_LLM_PROVIDER`, `SHROUD_BILLING_MODE` | [Shroud](https://docs.1claw.xyz/docs/guides/shroud); optional `SHROUD_BASE_URL`, `SHROUD_DEFAULT_MODEL`. If BYOK + vault: `SHROUD_PROVIDER_VAULT_PATH` / `api-keys/…`; if BYOK + no vault: `SHROUD_PROVIDER_API_KEY` |
| **Gemini / OpenAI / Anthropic** + **1Claw secrets**    | Vault: `llm-api-key`                                         | Fetched by the app’s chat route (not Shroud path)                                                                                                                                                                    |
| **Gemini / OpenAI / Anthropic** + **no 1Claw secrets** | `.env` provider env vars                                     | CLI can prompt to fill `.env`                                                                                                                                                                                        |

All chat routes use the [Vercel AI SDK](https://sdk.vercel.ai/) for streaming.

## Development

```bash
npm install
npm run build       # compile with tsup
npm run dev         # watch mode
npm start           # run locally
```

## License

[MIT](LICENSE) — see `LICENSE` in the repo.
