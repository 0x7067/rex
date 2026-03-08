# rex

`rex` is a resource-first persistent knowledge CLI.

It lets you connect a provider, add local or remote resources, index them into a local knowledge base, and ask grounded questions against that saved context later.

## Current Status

This repository contains the TypeScript CLI implementation, supporting docs, and tests. It is organized for local development first and is now prepared to live cleanly as a standalone git repository.

## Requirements

- Node.js 20+
- Bun 1.3.6+
- Access to at least one supported provider: `ollama`, `claude`, or `codex`

## Local Development

Install dependencies:

```bash
bun install
```

Run the CLI in development:

```bash
bun run dev -- --help
```

Build the distributable CLI:

```bash
bun run build
```

Run the test suite:

```bash
bun run test
```

## Quick Start

Configure a provider:

```bash
bun run dev -- connect ollama --model llama3
```

Add and index a local resource:

```bash
bun run dev -- add ./some-project
```

List saved resources:

```bash
bun run dev -- resources
```

Refresh indexed data:

```bash
bun run dev -- sync
```

Ask a grounded question:

```bash
bun run dev -- ask -q "How does the sync pipeline work?"
```

Remove a resource:

```bash
bun run dev -- remove some-project
```

## Commands

- `rex connect <provider>` configures the active provider profile.
- `rex add <source>` registers and indexes a resource.
- `rex resources` lists saved resources and sync status.
- `rex sync [name...]` refreshes one or more resources.
- `rex ask -q <question> [-r <name...>]` runs grounded retrieval and answer generation.
- `rex remove <name>` deletes a resource and its indexed data.

## Local State

By default, `rex` stores its registry, snapshots, and LanceDB data under `~/.rex`. Set `REX_HOME` to point those files somewhere else for testing or isolated runs.

## Packaging Notes

The published package is intentionally constrained to the built CLI artifacts plus standard package docs. Repository hosting metadata will be added once the canonical remote exists.
