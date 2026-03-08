# Provider Boundary

**Version:** v1

---

## Overview

A provider is any CLI or HTTP service that accepts a text prompt and returns a text response. The provider boundary is deliberately narrow: the provider is responsible only for generating text. It is not responsible for indexing, retrieval, state, or resource management.

---

## Provider Responsibilities

A provider must:

- Accept a prompt string (via stdin or HTTP body)
- Return a text response (via stdout or HTTP response)

A provider must not:

- Store or retrieve chunks
- Manage summary blocks
- Know about resources or the registry
- Control sync behavior
- Define output formats for rex commands

---

## Provider Interface

The internal provider abstraction is:

```ts
interface Provider {
  name: string;
  call(prompt: string): Promise<string>;
}
```

`execProvider(providerName: string, prompt: string): Promise<string>` is the single entry point from the rest of the system. The provider layer translates this into the appropriate transport (HTTP or shell-out).

---

## Built-in Providers

### `ollama`

- Transport: HTTP POST to `http://localhost:11434/api/generate` (or custom endpoint)
- Prompt delivery: JSON body `{ model, prompt }`
- Response parsing: streamed JSON response, collect and concatenate `response` fields
- Configuration: `model` (required), `endpoint` (optional, defaults to `http://localhost:11434`)

### `claude`

- Transport: shell out to the `claude` CLI
- Prompt delivery: stdin pipe
- Response: stdout
- Required: `claude` binary must be on `PATH`
- Configuration: no additional config needed; Claude Code handles auth

### `codex`

- Transport: shell out to the `codex` CLI
- Prompt delivery: stdin pipe or `-p` flag
- Response: stdout
- Required: `codex` binary must be on `PATH`
- Configuration: no additional config needed; Codex handles auth

---

## Replaceability Rules

Changing the active provider must not change:

- CLI command semantics (`connect`, `add`, `remove`, `resources`, `sync`, `ask`)
- Resource model or registry schema
- Sync behavior or fingerprint logic
- Chunk format or embedding model (embeddings are always local, not provider-generated)
- `--json` output shapes for any command
- Answer grounding guarantees (the prompt construction always includes summary blocks and retrieved chunks regardless of provider)

**Embeddings are always local.** `rex` uses `node-llama-cpp` with a local GGUF build of `nomic-ai/nomic-embed-text-v1.5` for both indexing and query embedding. Provider selection has no effect on the embedding model.

---

## Provider Configuration

Provider config is stored in `registry.json` under the `provider` key. It is set via `rex connect`.

```ts
{
  name: "ollama" | "claude" | "codex",
  model: string | null,
  endpoint: string | null
}
```

- `model` is provider-specific. For `ollama`, it names the model to use (e.g., `"llama3"`). For `claude` and `codex`, it is passed as a flag if specified.
- `endpoint` is only used by `ollama`. Ignored for shell-out providers.

---

## Error Handling

- If the provider binary is not found on PATH, `ask` exits with code 3 and a clear message.
- If the provider returns a non-zero exit code, the error is surfaced in `ask` output.
- If the Ollama HTTP call fails (connection refused, timeout), `ask` exits with code 3 and the HTTP error.
- Provider errors never corrupt registry state.
