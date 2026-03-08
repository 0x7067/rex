# rex

`rex` is a resource-first persistent knowledge CLI.

It lets you save local or remote resources into a persistent local knowledge base, refresh that knowledge incrementally, and ask grounded questions against it later.

## Team Alpha

The first teammate rollout is:

- package: `@denguinho/rex`
- install channel: npm with the `alpha` dist-tag
- platform: macOS first
- default answer provider: Claude Code
- default embedding backend: local Ollama with `nomic-embed-text`

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
- Claude Code installed and authenticated
- Ollama installed
- Ollama embedding model pulled locally:

```bash
ollama pull nomic-embed-text
```

### Optional Preflight

If you cloned this repository locally, you can run the onboarding check script:

```bash
bun run preflight:macos
```

If you are installing from npm instead, use this checklist:

- `node --version` reports Node.js 20 or newer
- `npm --version` succeeds
- `claude --version` succeeds
- `ollama --version` succeeds
- the Ollama app or local service is running
- `ollama list` includes `nomic-embed-text`
- `REX_HOME` is either unset or points to a writable directory

### Install The CLI

```bash
npm install -g @denguinho/rex@alpha
```

### First Run

Configure the default answer provider:

```bash
rex connect claude
```

Add and index a local resource:

```bash
rex add ./some-project
```

Ask a grounded question:

```bash
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
- `REX_OLLAMA_ENDPOINT`
- `REX_EMBED_MODEL`

For the team alpha path, `rex connect claude` configures answer generation, while Ollama still powers local embeddings during indexing.

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
