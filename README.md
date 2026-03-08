# rex

`rex` is a resource-first persistent knowledge CLI.

It lets you save local or remote resources into a persistent local knowledge base, refresh that knowledge incrementally, and ask grounded questions against it later.

## Team Alpha

The first teammate rollout is:

- package: `@denguinho/rex`
- install channel: npm with the `alpha` dist-tag
- platform: macOS first
- default answer provider: Claude Code
- default embedding backend: local `node-llama-cpp` with `nomic-ai/nomic-embed-text-v1.5-GGUF`

The supported public CLI surface for this rollout is:

- `rex connect <provider>`
- `rex add <source>`
- `rex remove <name>`
- `rex resources`
- `rex sync [name...]`
- `rex ask <question>`

## Install For Teammates

### Prerequisites

- macOS
- Node.js 20+
- npm

For the default path, teammates also need Claude Code installed and authenticated.

For alternative answer-provider paths, teammates can use Codex CLI instead of Claude Code, or Ollama itself for a fully local setup.
The embedding model downloads automatically to the local `node-llama-cpp` cache on first use.

### Optional Preflight

If you cloned this repository locally, you can run the onboarding check script:

```bash
bun run preflight:macos
```

If you are installing from npm instead, use this checklist:

- `node --version` reports Node.js 20 or newer
- `npm --version` succeeds
- `REX_HOME` is either unset or points to a writable directory
- for the default path, `claude --version` succeeds
- for the Codex path, `codex --version` succeeds
- for the Ollama answer-provider path, `ollama --version` succeeds

### Install The CLI

```bash
npm install -g @denguinho/rex@alpha
```

### First Run

`rex` uses Claude with the `haiku` model by default, so teammates do not need to run a separate connect step for the standard onboarding path.

If you want to override that default later, you can still run:

```bash
rex connect claude --model <name>
```

Add and index a local resource:

```bash
rex add ./some-project
```

Ask a grounded question:

```bash
rex ask "How does the sync pipeline work?"
```

### Alternative Provider Setups

Use Codex instead of Claude:

```bash
rex connect codex
rex add ./some-project
rex ask "How does the sync pipeline work?"
```

Use Ollama for a fully local answer path:

```bash
rex connect ollama --model llama3
rex add ./some-project
rex ask "How does the sync pipeline work?"
```

Useful follow-up commands:

```bash
rex resources
rex sync
rex remove some-project
```

## Runtime Notes

`rex` stores its registry, snapshots, and LanceDB data under `~/.rex` by default.

You can override runtime locations and embedding settings with:

- `REX_HOME`
- `REX_EMBED_MODEL`
- `REX_GGUF_SOURCE`
- `REX_OLLAMA_ENDPOINT` for the Ollama answer-provider path

For the team alpha path, `rex` uses Claude with the default `haiku` model for answer generation, while local GGUF inference via `node-llama-cpp` powers embeddings during indexing and retrieval. Codex is available as an alternative CLI-backed provider, and Ollama can also be used as the answer provider for a fully local setup.

## Contributor Setup

Repository contributors still use Bun for local development:

```bash
bun install
bun run dev -- --help
bun run build
bun run test
```

## Release Notes

Maintainers can publish the alpha package through the GitHub Actions release workflow described in [docs/releasing.md](docs/releasing.md).
