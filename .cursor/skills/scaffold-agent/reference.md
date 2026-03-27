# scaffold-agent — reference

## Help

```bash
scaffold-agent --help
# or from clone:
node dist/cli.js --help
```

## Common `-y` flags

| Flag | Notes |
|------|--------|
| `-y` / `--non-interactive` | No prompts |
| `--project <name>` | Or single positional name |
| `--secrets` | `oneclaw` \| `encrypted` \| `none` |
| `--env-password` | Required for `oneclaw` / `encrypted` with `-y` (min 6 chars) |
| `--defer-oneclaw-api-key` | Skip user API key at scaffold |
| `--llm` | `oneclaw` \| `gemini` \| `openai` \| `anthropic` |
| `--shroud-upstream` | `openai`, `google`, `gemini`, … |
| `--shroud-billing` | `token_billing` \| `provider_api_key` |
| `--shroud-provider-api-key` | Required for `provider_api_key` in `-y` |
| `--oneclaw-agent-id` / `--oneclaw-agent-api-key` | Required for `oneclaw` LLM when secrets not `oneclaw` |
| `--chain` | `foundry` \| `hardhat` \| `none` |
| `--framework` | `nextjs` \| `vite` \| `python` |
| `--agent` | `generate` \| `none` |
| `--ampersend` | `yes` \| `no` |
| `--skip-npm-install` | |
| `--skip-auto-fund` | |
| `--swarm <n>` | 1–64 agent wallets; extras in `SWARM_AGENT_KEYS_JSON` |
| `--from-config <file>` | Merge `agent.json`; CLI overrides file |
| `--dump-config` | Print merged config JSON to stdout (secrets omitted) |
| `--dump-config-out <file>` | Write that JSON to a file |

### `agent.json` (for `--from-config` / `--dump-config`)

- **`project`** or **`name`**, **`swarm`**, **`agents`**: `{ "my-agent-id": "preset-label" }`, optional **`extra`**, optional **`options`**: `{ "secrets": "encrypted", … }`.
- Top-level keys may mirror CLI flags (same names as long options).

## Generated monorepo (after scaffold)

- **`just reset`** — re-bootstrap 1Claw vault + agent (only when project uses 1Claw); backup `.env` / encrypted secrets first.
- **`just swarm agents=N`** — append swarm wallets (`public/agents.json` + `SWARM_AGENT_KEYS_JSON`) when the UI package exists.

## Links

- [1claw Shroud](https://docs.1claw.xyz/docs/guides/shroud)
- [README](../../../README.md) (repo root)
