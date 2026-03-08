# Stack Mapping: rex

**Date:** 2026-03-08
**Status:** Approved

---

## Chosen Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | TypeScript (Node.js 20+) | Fast iteration, strong CLI ecosystem, existing team familiarity |
| CLI framework | Commander.js | Simple, popular, good help/JSON output |
| CLI binary | `rex` | Short, memorable CLI name |
| Vector store | LanceDB (`vectordb`) | Embedded, file-based, TypeScript SDK, no server required |
| Embeddings | `@huggingface/transformers` + `nomic-embed-text-v1.5` | Local inference, 8K context window (good for code), no API key |
| LLM provider | Shell out to Ollama / Claude Code / Codex CLI | No SDK lock-in, unix-philosophy, provider-agnostic |
| Git operations | `simple-git` | Thin wrapper over git binary, easy to test |
| Process execution | `execa` | Typed shell-out, good error handling |
| Runtime validation | `zod` | Schema validation at system boundaries |
| Testing | `vitest` | Fast, TypeScript-native, compatible with ESM |

---

## Directory Layout

```
rex/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bin/
│   └── rex.ts              # CLI entry point (shebang, Commander root)
├── src/
│   ├── cli/                # Commander.js command definitions (thin shells)
│   │   ├── connect.ts
│   │   ├── add.ts
│   │   ├── remove.ts
│   │   ├── resources.ts
│   │   ├── sync.ts
│   │   └── ask.ts
│   ├── core/
│   │   ├── registry.ts     # Resource CRUD over registry.json
│   │   ├── resource.ts     # Resource types, zod schemas, UUID generation
│   │   └── config.ts       # Rex home dir (~/.rex), path resolution
│   ├── adapters/
│   │   ├── adapter.ts      # Adapter interface definition
│   │   ├── local.ts        # Local folder adapter
│   │   ├── git.ts          # Git clone/pull adapter (uses simple-git)
│   │   ├── package.ts      # Registry-backed package download/extract adapter
│   │   └── shared.ts       # enumerate, fingerprint, reference (shared)
│   ├── indexing/
│   │   ├── chunker.ts      # File text → chunks (fixed-size, 512 tokens, 50 overlap)
│   │   ├── embedder.ts     # Chunks → float32 vectors (transformers.js pipeline)
│   │   └── store.ts        # LanceDB read/write (chunks + summaries tables)
│   ├── query/
│   │   ├── retriever.ts    # ANN search in LanceDB, filtered by resource_id[]
│   │   └── answerer.ts     # Prompt assembly: summaries + chunks → provider → answer
│   └── provider/
│       ├── interface.ts    # Provider type + execProvider()
│       ├── ollama.ts       # Ollama HTTP provider
│       ├── claude.ts       # Shell out to `claude` CLI
│       └── codex.ts        # Shell out to `codex` CLI
├── test/
│   ├── core/
│   ├── adapters/
│   ├── indexing/
│   ├── query/
│   └── provider/
└── docs/
    ├── specs/              # Contract documents (Tasks 1-6)
    └── plans/              # This file and others
```

---

## Module Responsibilities

### `src/core/resource.ts`

- Zod schemas for `Resource`, `ProviderConfig`, `SnapshotMetadata` (per type)
- UUID generation for new resources (`crypto.randomUUID()`)
- Type exports for use across all modules

### `src/core/registry.ts`

- Read/write `~/.rex/registry.json` with atomic writes (write to tmp, rename)
- `addResource(resource)`, `removeResource(id)`, `getResource(nameOrId)`, `listResources()`
- Enforces name uniqueness at add time
- Throws typed errors (`RegistryError`) on conflict or not-found

### `src/core/config.ts`

- `rexHome()` → `~/.rex` (respects `REX_HOME` env var for testing)
- `snapshotsDir()` → `~/.rex/snapshots/`
- `lanceDir()` → `~/.rex/lance/`
- `registryPath()` → `~/.rex/registry.json`

### `src/adapters/adapter.ts`

- TypeScript interface `ResourceAdapter`
- Methods: `detect`, `normalize`, `materialize`, `reference`
- `shared.ts` provides `enumerate` and `fingerprint` (used by all adapters)

### `src/indexing/store.ts`

- `openChunksTable()` and `openSummariesTable()` — open or create LanceDB tables
- `writeChunks(chunks[])` — bulk insert
- `deleteChunks(resourceId)` — delete all chunks for a resource by `resource_id`
- `searchChunks(vector, resourceIds[], topK)` — ANN search with resource filter
- `writeSummaries(summaries[])` — bulk insert/replace
- `deleteSummaries(resourceId)` — delete all summaries for a resource
- `getSummaries(resourceIds[])` — fetch summaries for query context

### `src/provider/interface.ts`

```ts
type ProviderName = "ollama" | "claude" | "codex";

interface Provider {
  name: ProviderName;
  call(prompt: string): Promise<string>;
}

function getProvider(config: ProviderConfig): Provider;
```

---

## Data Flow

### `rex add <source>`

```
CLI (add.ts)
  → detectAdapter(source)
  → adapter.normalize(source)
  → adapter.materialize(normalizedSource, snapshotDir)
  → shared.enumerate(materializedDir, include, exclude)  [async iterable]
  → shared.fingerprint(entry)                            [per file]
  → chunker.chunkFile(entry)                             [per file → chunks[]]
  → embedder.embed(chunks[])                             [chunks[] → ChunkRow[]]
  → store.writeChunks(chunkRows[])
  → answerer.generateSummaries(resource, chunkRows[])    [LLM call]
  → store.writeSummaries(summaryRows[])
  → registry.addResource(resource)
```

### `rex ask -q <question>`

```
CLI (ask.ts)
  → registry.listResources() / getResource(name)
  → store.getSummaries(resourceIds[])
  → embedder.embed([question])                           [1 vector]
  → store.searchChunks(vector, resourceIds[], topK)
  → answerer.buildPrompt(summaries, chunks, question)
  → provider.call(prompt)
  → format output
```

---

## State File Locations

| File | Path |
|------|------|
| Registry | `~/.rex/registry.json` |
| LanceDB data | `~/.rex/lance/` |
| Managed snapshots | `~/.rex/snapshots/<resource-name>/` |

All paths respect the `REX_HOME` env var for test isolation.

---

## Contract Compliance

This stack satisfies all frozen contracts:

- **CLI contract:** Commander.js implements all 6 commands with `--json` support.
- **Resource model:** Zod schemas enforce the full field set including UUID `id`.
- **State schema:** LanceDB tables match column specs; registry.json matches schema.
- **Sync semantics:** Fingerprint comparison via SHA-256, incremental by default.
- **Query behavior:** ANN search filtered by `resource_id[]`, context isolated per resource.
- **Provider boundary:** `interface.ts` + per-provider impls; embeddings always local.
