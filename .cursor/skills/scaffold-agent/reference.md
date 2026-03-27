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

## Generated monorepo (after scaffold)

- **`just reset`** — re-bootstrap 1Claw vault + agent (only when project uses 1Claw); backup `.env` / encrypted secrets first.

## Links

- [1claw Shroud](https://docs.1claw.xyz/docs/guides/shroud)
- [README](../../../README.md) (repo root)
