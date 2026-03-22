# scaffold-agent

Interactive CLI to scaffold monorepo projects for onchain AI agents.

## Usage

```bash
npx scaffold-agent
```

The wizard walks through:

1. **Project name** — directory to create
2. **Secrets management** — 1Claw (HSM-backed vault), encrypted `.env`, or plain
3. **Agent identity** — generate an Ethereum wallet for your agent
4. **LLM Provider** — 1Claw, Gemini, OpenAI, or Anthropic
5. **Chain framework** — Foundry, Hardhat, or none
6. **App framework** — Next.js, Vite, or Python (Google A2A)

At the end it displays QR codes for the Deployer and Agent addresses so you can fund them.

## What gets created

```
my-agent/
├── justfile                      # just chain / deploy / start / generate
├── scripts/
│   ├── generate-abi-types.mjs    # auto-gen TypeScript from contract ABIs
│   └── generate-deployer.mjs     # create deployer wallet if missing
├── packages/
│   ├── foundry/                  # or hardhat/ (Solidity contracts)
│   └── nextjs/                   # or vite/ or python/ (frontend / agent)
│       ├── app/
│       │   ├── page.tsx          # shadcn chat UI
│       │   └── api/chat/route.ts # LLM streaming API
│       ├── components/ui/        # shadcn Button, Input
│       ├── contracts/            # auto-generated ABI types
│       └── ...
├── .env                          # secrets (gitignored)
├── .env.encrypted                # AES-256-GCM encrypted copy
├── .gitignore
├── package.json                  # monorepo root
└── README.md
```

### Commands (via [just](https://just.systems))

| Command | Description |
|---|---|
| `just chain` | Start local blockchain (Foundry/Hardhat) |
| `just deploy` | Deploy contracts & auto-generate ABI types |
| `just start` | Start frontend or agent |
| `just generate` | Generate a deployer wallet (if none exists) |

### ABI type generation

`just deploy` automatically parses compiled contract artifacts and generates
`deployedContracts.ts` — the same pattern used by
[Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2). This gives you
type-safe contract addresses and ABIs in your frontend code.

## 1Claw integration

When you choose **1Claw (1claw.xyz)**, the CLI:

- Authenticates with your `ONECLAW_API_KEY`
- Creates a vault for the project
- Stores the deployer private key at `private-keys/deployer` in the vault (**not** on disk)
- If agent identity is generated, stores it at `private-keys/agent` and registers the agent
- When 1Claw is also chosen as the LLM provider, the chat API route fetches the
  LLM API key from your vault at runtime — no raw credentials in code

## LLM providers

| Choice | SDK | Env var |
|---|---|---|
| 1Claw | `@ai-sdk/openai` + `@1claw/sdk` | Key stored in vault as `llm-api-key` |
| Gemini | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| OpenAI | `@ai-sdk/openai` | `OPENAI_API_KEY` |
| Anthropic | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` |

All providers use the [Vercel AI SDK](https://sdk.vercel.ai/) for streaming chat.

## Development

```bash
npm install
npm run build       # compile with tsup
npm run dev         # watch mode
npm start           # run locally
```

## License

[MIT](LICENSE) — see `LICENSE` in the repo.
